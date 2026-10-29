-- PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium). Rode no SQL Editor.
-- Aplicar ANTES de subir o frontend novo.
--
-- Permissao SEPARADA para CORRIGIR os numeros do CRM (override de leads/consultas/
-- procedimentos), distinta da permissao de editar o planejado (crm_editor). Novo papel
-- `crm_number_editor`. So admin OU esse papel podem escrever em crm_metric_overrides.
-- A leitura continua igual (aberta p/ authenticated, escopada p/ usuario-cliente).

-- 1. Novo valor no enum de papeis. Idempotente. Nao e usado como literal abaixo
--    (has_crm_number_access compara role::text), entao roda junto sem o "unsafe use of
--    new enum value".
alter type public.app_role add value if not exists 'crm_number_editor';

-- 2. Helper: pode corrigir os numeros do CRM? = admin OU papel crm_number_editor.
create or replace function public.has_crm_number_access(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role(_user_id, 'admin')
      or exists (
        select 1 from public.user_roles
        where user_id = _user_id and role::text = 'crm_number_editor'
      )
$$;

revoke execute on function public.has_crm_number_access(uuid) from public, anon;
grant execute on function public.has_crm_number_access(uuid) to authenticated;

-- 3. Religa a ESCRITA de crm_metric_overrides no novo helper (antes usava has_crm_access).
--    Leitura (crm_overrides_read + crm_overrides_client_scope) fica intacta.
drop policy if exists crm_overrides_insert on public.crm_metric_overrides;
drop policy if exists crm_overrides_update on public.crm_metric_overrides;
drop policy if exists crm_overrides_delete on public.crm_metric_overrides;

create policy crm_overrides_insert on public.crm_metric_overrides
  for insert to authenticated with check (public.has_crm_number_access(auth.uid()));
create policy crm_overrides_update on public.crm_metric_overrides
  for update to authenticated
  using (public.has_crm_number_access(auth.uid())) with check (public.has_crm_number_access(auth.uid()));
create policy crm_overrides_delete on public.crm_metric_overrides
  for delete to authenticated using (public.has_crm_number_access(auth.uid()));

notify pgrst, 'reload schema';
