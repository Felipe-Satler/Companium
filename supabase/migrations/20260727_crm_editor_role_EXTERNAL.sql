-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium). Rode no SQL Editor
-- desse projeto. Aplicar ANTES de subir o frontend novo.
--
-- CONTROLE DE ACESSO ÀS AÇÕES DO CRM (planejado + escolha da base de faturamento).
-- Só ADMIN ou usuários marcados com o novo papel `crm_editor` (na tela de Administração)
-- podem ESCREVER em clientes_meta (planejado de leads/consultas/procedimentos/faturamento/
-- ROAS) e em crm_faturamento_config (tipo de ganho: consulta/procedimento agendado/realizado).
-- A LEITURA continua liberada p/ todo authenticated (todo mundo vê, só marcados editam).

-- 1. Novo valor no enum de papéis. `ADD VALUE IF NOT EXISTS` é idempotente. Não é usado como
--    literal em nenhum statement abaixo (has_crm_access compara role::text), então roda junto
--    sem esbarrar no "unsafe use of new enum value" da mesma transação.
alter type public.app_role add value if not exists 'crm_editor';

-- 2. Helper: tem acesso de escrita ao CRM? = admin OU papel crm_editor. SECURITY DEFINER para
--    ler user_roles sem depender da RLS do chamador (igual has_role/is_approved).
create or replace function public.has_crm_access(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role(_user_id, 'admin')
      or exists (
        select 1 from public.user_roles
        where user_id = _user_id and role::text = 'crm_editor'
      )
$$;

revoke execute on function public.has_crm_access(uuid) from public, anon;
grant execute on function public.has_crm_access(uuid) to authenticated;

-- 3. clientes_meta — escrita só p/ quem tem acesso ao CRM (leitura segue aberta).
drop policy if exists clientes_meta_insert on public.clientes_meta;
drop policy if exists clientes_meta_update on public.clientes_meta;

create policy clientes_meta_insert on public.clientes_meta
  for insert to authenticated with check (public.has_crm_access(auth.uid()));
create policy clientes_meta_update on public.clientes_meta
  for update to authenticated using (public.has_crm_access(auth.uid())) with check (public.has_crm_access(auth.uid()));

-- 4. crm_faturamento_config — idem (escolha do tipo de ganho da base de faturamento).
drop policy if exists "crm_fat_config_insert" on public.crm_faturamento_config;
drop policy if exists "crm_fat_config_update" on public.crm_faturamento_config;

create policy "crm_fat_config_insert" on public.crm_faturamento_config
  for insert to authenticated with check (public.has_crm_access(auth.uid()));
create policy "crm_fat_config_update" on public.crm_faturamento_config
  for update to authenticated using (public.has_crm_access(auth.uid())) with check (public.has_crm_access(auth.uid()));

notify pgrst, 'reload schema';
