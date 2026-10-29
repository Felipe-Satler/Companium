-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium). Rode no SQL Editor
-- desse projeto. Aplicar ANTES de subir o frontend novo.
--
-- SEÇÃO CAPTAÇÃO (mídia própria da Groohub):
--   (1) Novo papel `captacao_viewer` — quem pode VER a seção Captação no Companium. A
--       visibilidade é controlada no frontend (AuthContext.canViewCaptacao = admin OU
--       captacao_viewer); os dados de Ads (v_meta_google_ads) seguem legíveis por todo
--       authenticated, então isto esconde a SEÇÃO, não restringe a view.
--   (2) Tabela `captacao_config` — meta mensal de investimento do card "Pacing mensal".
--       Vazia até ser preenchida por dentro do sistema (igual ao planejado do CRM).
--       LEITURA aberta a authenticated; ESCRITA só p/ quem edita o CRM (has_crm_access =
--       admin OU crm_editor), reusando o helper já existente.

-- 1. Novo valor no enum de papéis. Idempotente. has_captacao_access compara role::text, então
--    o novo valor não é usado como literal em statement da mesma transação (sem "unsafe use").
alter type public.app_role add value if not exists 'captacao_viewer';

-- 2. Helper: pode ver a Captação? = admin OU papel captacao_viewer. SECURITY DEFINER p/ ler
--    user_roles sem depender da RLS do chamador (igual has_role/has_crm_access). Não é usado
--    por nenhuma policy hoje (visibilidade é no front), mas fica pronto p/ gating futuro.
create or replace function public.has_captacao_access(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role(_user_id, 'admin')
      or exists (
        select 1 from public.user_roles
        where user_id = _user_id and role::text = 'captacao_viewer'
      )
$$;

revoke execute on function public.has_captacao_access(uuid) from public, anon;
grant execute on function public.has_captacao_access(uuid) to authenticated;

-- 3. captacao_config — meta mensal de investimento da captação, por mês (1º dia do mês).
--    Sem linha p/ o mês → meta indefinida (card fica pronto p/ preencher).
create table if not exists public.captacao_config (
  mes               date primary key,
  investimento_meta numeric not null default 0,
  updated_at        timestamptz not null default now()
);

alter table public.captacao_config enable row level security;

drop policy if exists "captacao_config_read"   on public.captacao_config;
drop policy if exists "captacao_config_insert" on public.captacao_config;
drop policy if exists "captacao_config_update" on public.captacao_config;

-- Leitura p/ todo authenticated (todo mundo que vê a Captação lê a meta).
create policy "captacao_config_read" on public.captacao_config
  for select to authenticated using (true);
-- Escrita só p/ admin OU crm_editor (mesma trava do planejado do CRM).
create policy "captacao_config_insert" on public.captacao_config
  for insert to authenticated with check (public.has_crm_access(auth.uid()));
create policy "captacao_config_update" on public.captacao_config
  for update to authenticated using (public.has_crm_access(auth.uid())) with check (public.has_crm_access(auth.uid()));

notify pgrst, 'reload schema';
