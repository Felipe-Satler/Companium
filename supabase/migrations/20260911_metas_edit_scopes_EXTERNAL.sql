-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium). Rode no SQL Editor
-- desse projeto. Aplicar ANTES de subir o frontend novo.
--
-- EDIÇÃO DAS METAS DA CAPTAÇÃO (página Metas › aba Captação) POR INTERVALO DE MÊS:
--   Substitui a antiga regra fixa (só o Bernardo Leme editava meses passados) por 3 papéis
--   configuráveis na Administração ("Edição Metas"):
--     - metas_edit_past    → pode editar metas de meses ANTERIORES ao atual
--     - metas_edit_present → pode editar metas do mês ATUAL
--     - metas_edit_future  → pode editar metas de meses POSTERIORES ao atual
--   admin sempre pode os três. O gate por MÊS é aplicado no frontend (MetaEditDialog/MetaPage);
--   aqui liberamos a ESCRITA em captacao_metas p/ admin, crm_editor OU qualquer papel
--   metas_edit_* (a leitura já é aberta a todo authenticated).

-- 1. Novos valores no enum de papéis. Idempotente. As funções abaixo comparam role::text, então
--    os novos valores NÃO são usados como literal-enum em statement da mesma transação (sem
--    "unsafe use of new value").
alter type public.app_role add value if not exists 'metas_edit_past';
alter type public.app_role add value if not exists 'metas_edit_present';
alter type public.app_role add value if not exists 'metas_edit_future';

-- 2. Helper: usuário tem ALGUM escopo de edição de metas? = admin OU qualquer metas_edit_*.
--    SECURITY DEFINER p/ ler user_roles sem depender da RLS do chamador (igual has_role/
--    has_metas_access). Usado na policy de escrita de captacao_metas.
create or replace function public.has_any_metas_edit(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role(_user_id, 'admin')
      or exists (
        select 1 from public.user_roles
        where user_id = _user_id
          and role::text in ('metas_edit_past', 'metas_edit_present', 'metas_edit_future')
      )
$$;

revoke execute on function public.has_any_metas_edit(uuid) from public, anon;
grant execute on function public.has_any_metas_edit(uuid) to authenticated;

-- 3. Escrita em captacao_metas: admin/crm_editor (has_crm_access) OU qualquer metas_edit_*.
--    (A leitura permanece aberta a todo authenticated — policy captacao_metas_read intacta.)
drop policy if exists "captacao_metas_insert" on public.captacao_metas;
drop policy if exists "captacao_metas_update" on public.captacao_metas;
drop policy if exists "captacao_metas_delete" on public.captacao_metas;

create policy "captacao_metas_insert" on public.captacao_metas
  for insert to authenticated
  with check (public.has_crm_access(auth.uid()) or public.has_any_metas_edit(auth.uid()));
create policy "captacao_metas_update" on public.captacao_metas
  for update to authenticated
  using (public.has_crm_access(auth.uid()) or public.has_any_metas_edit(auth.uid()))
  with check (public.has_crm_access(auth.uid()) or public.has_any_metas_edit(auth.uid()));
create policy "captacao_metas_delete" on public.captacao_metas
  for delete to authenticated
  using (public.has_crm_access(auth.uid()) or public.has_any_metas_edit(auth.uid()));

notify pgrst, 'reload schema';
