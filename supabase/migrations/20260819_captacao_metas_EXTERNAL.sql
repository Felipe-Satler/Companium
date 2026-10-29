-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium). Rode no SQL Editor
-- desse projeto. Aplicar ANTES de subir o frontend novo.
--
-- SEÇÃO CAPTAÇÃO › META (Real x Planejado da mídia própria da Groohub):
--   Tabela `captacao_metas` — metas mensais (planejado x real) de captação, preenchidas
--   MANUALMENTE pelo diálogo "Editar metas" da tela /captacao/meta. Uma linha por mês
--   (chave `mes` no formato 'AAAA-MM'). Sem linha p/ o mês → indicadores zerados.
--   LEITURA aberta a todo authenticated; ESCRITA só p/ admin OU crm_editor
--   (has_crm_access), reusando o helper já existente — mesma trava do `captacao_config`
--   e do planejado do CRM.
--
--   Indicadores (cada um com PLAN = planejado e REAL = realizado):
--     - investimento (moeda)         → investimento_plan / investimento_real
--     - leads_inbound (número)        → leads_inbound_plan / leads_inbound_real
--     - cpl (moeda)                   → cpl_plan / cpl_real
--     - leads (número)                → leads_plan / leads_real
--   Indicadores com variante Total / Inbound:
--     - agendamentos (número)         → agendamentos_total_* / agendamentos_inbound_*
--     - reunioes (número)             → reunioes_total_* / reunioes_inbound_*
--     - vendas (número)               → vendas_total_* / vendas_inbound_*
--     - novo_mrr / nMRR (moeda)       → novo_mrr_total_* / novo_mrr_inbound_*

create table if not exists public.captacao_metas (
  mes                        text primary key,   -- 'AAAA-MM'

  -- Indicadores simples
  investimento_plan          numeric not null default 0,
  investimento_real          numeric not null default 0,
  leads_inbound_plan         numeric not null default 0,
  leads_inbound_real         numeric not null default 0,
  cpl_plan                   numeric not null default 0,
  cpl_real                   numeric not null default 0,
  leads_plan                 numeric not null default 0,
  leads_real                 numeric not null default 0,

  -- Indicadores com variante Total / Inbound
  agendamentos_total_plan    numeric not null default 0,
  agendamentos_total_real    numeric not null default 0,
  agendamentos_inbound_plan  numeric not null default 0,
  agendamentos_inbound_real  numeric not null default 0,
  reunioes_total_plan        numeric not null default 0,
  reunioes_total_real        numeric not null default 0,
  reunioes_inbound_plan      numeric not null default 0,
  reunioes_inbound_real      numeric not null default 0,
  vendas_total_plan          numeric not null default 0,
  vendas_total_real          numeric not null default 0,
  vendas_inbound_plan        numeric not null default 0,
  vendas_inbound_real        numeric not null default 0,
  novo_mrr_total_plan        numeric not null default 0,
  novo_mrr_total_real        numeric not null default 0,
  novo_mrr_inbound_plan      numeric not null default 0,
  novo_mrr_inbound_real      numeric not null default 0,

  atualizado_por             text,
  atualizado_em              timestamptz not null default now(),

  -- Garante o formato 'AAAA-MM' na chave do mês.
  constraint captacao_metas_mes_fmt check (mes ~ '^\d{4}-\d{2}$')
);

alter table public.captacao_metas enable row level security;

drop policy if exists "captacao_metas_read"   on public.captacao_metas;
drop policy if exists "captacao_metas_insert" on public.captacao_metas;
drop policy if exists "captacao_metas_update" on public.captacao_metas;
drop policy if exists "captacao_metas_delete" on public.captacao_metas;

-- Leitura p/ todo authenticated (todo mundo que vê a Captação lê as metas).
create policy "captacao_metas_read" on public.captacao_metas
  for select to authenticated using (true);
-- Escrita só p/ admin OU crm_editor (mesma trava do planejado do CRM / captacao_config).
create policy "captacao_metas_insert" on public.captacao_metas
  for insert to authenticated with check (public.has_crm_access(auth.uid()));
create policy "captacao_metas_update" on public.captacao_metas
  for update to authenticated using (public.has_crm_access(auth.uid())) with check (public.has_crm_access(auth.uid()));
create policy "captacao_metas_delete" on public.captacao_metas
  for delete to authenticated using (public.has_crm_access(auth.uid()));

notify pgrst, 'reload schema';
