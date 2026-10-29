-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium). Rode no SQL Editor
-- desse projeto. Aplicar ANTES (ou logo após) subir o frontend novo — o front tem fallback
-- que salva só as colunas legadas enquanto estas não existem, então nada quebra no intervalo.
--
-- SEÇÃO CAPTAÇÃO › METAS — detalhamento do Inbound por CANAL (Meta / Google):
--   Os cards Leads Inbound, Reuniões, Agendamentos, Vendas e nMRR passam a exibir, logo
--   abaixo da linha "Inbound", duas subdivisões: "Meta" e "Google" (conceitualmente
--   "Inbound Meta" e "Inbound Google"). São APENAS valores (Real x Planejado); os
--   indicadores de Atingimento continuam só em Total e Inbound.
--
--   Convenção de coluna: <indicador>_meta_<plan|real> e <indicador>_google_<plan|real>.
--   O card "Leads Inbound" mantém a coluna legada leads_inbound_plan/real como a linha
--   "Inbound" (não é recriada aqui) e ganha só as colunas de canal.

alter table public.captacao_metas
  add column if not exists leads_inbound_meta_plan     numeric not null default 0,
  add column if not exists leads_inbound_meta_real     numeric not null default 0,
  add column if not exists leads_inbound_google_plan   numeric not null default 0,
  add column if not exists leads_inbound_google_real   numeric not null default 0,

  add column if not exists agendamentos_meta_plan      numeric not null default 0,
  add column if not exists agendamentos_meta_real      numeric not null default 0,
  add column if not exists agendamentos_google_plan    numeric not null default 0,
  add column if not exists agendamentos_google_real    numeric not null default 0,

  add column if not exists reunioes_meta_plan          numeric not null default 0,
  add column if not exists reunioes_meta_real          numeric not null default 0,
  add column if not exists reunioes_google_plan        numeric not null default 0,
  add column if not exists reunioes_google_real        numeric not null default 0,

  add column if not exists vendas_meta_plan            numeric not null default 0,
  add column if not exists vendas_meta_real            numeric not null default 0,
  add column if not exists vendas_google_plan          numeric not null default 0,
  add column if not exists vendas_google_real          numeric not null default 0,

  add column if not exists novo_mrr_meta_plan          numeric not null default 0,
  add column if not exists novo_mrr_meta_real          numeric not null default 0,
  add column if not exists novo_mrr_google_plan        numeric not null default 0,
  add column if not exists novo_mrr_google_real        numeric not null default 0;

-- RLS e políticas já vêm da tabela (20260819_captacao_metas). Só recarrega o schema cache.
notify pgrst, 'reload schema';
