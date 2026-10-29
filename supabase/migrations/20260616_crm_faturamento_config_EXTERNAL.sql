-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium), NÃO o projeto
-- primário do config.toml. É onde vivem v_kommo_completa / v_meta_google_ads e onde o
-- frontend (externalSupabase) lê/escreve. Rode este SQL no SQL Editor desse projeto.
--
-- Persiste, POR CLIENTE, qual base compõe o Faturamento Bruto do CRM:
--   - consulta_basis: 'agendadas' | 'realizadas'  (valor da consulta)
--   - procedimento_basis: 'agendados' | 'realizados'  (valor do procedimento)
-- A escrita acontece como usuário autenticado (RLS p/ `authenticated`), então a escolha
-- vale para TODAS as contas: qualquer pessoa que puxar o cliente recebe a base salva dele.
-- Sem linha salva → default 'realizadas' + 'realizados' (comportamento histórico).
--
-- client_key = clientMatchKey(client): stripAccents+lower+[\s_]→_  (tolerante a variações).

create table if not exists public.crm_faturamento_config (
  client_key         text primary key,
  client             text not null,
  consulta_basis     text not null default 'realizadas' check (consulta_basis in ('agendadas','realizadas')),
  procedimento_basis text not null default 'realizados' check (procedimento_basis in ('agendados','realizados')),
  updated_at         timestamptz not null default now()
);

alter table public.crm_faturamento_config enable row level security;

-- Leitura + escrita liberadas para usuários autenticados (a app loga no Supabase).
drop policy if exists "crm_fat_config_read"   on public.crm_faturamento_config;
drop policy if exists "crm_fat_config_insert" on public.crm_faturamento_config;
drop policy if exists "crm_fat_config_update" on public.crm_faturamento_config;

create policy "crm_fat_config_read"   on public.crm_faturamento_config
  for select to authenticated using (true);
create policy "crm_fat_config_insert" on public.crm_faturamento_config
  for insert to authenticated with check (true);
create policy "crm_fat_config_update" on public.crm_faturamento_config
  for update to authenticated using (true) with check (true);
