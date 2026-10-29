-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium), NÃO o projeto
-- primário do config.toml. Rode este SQL no SQL Editor DESSE projeto (o PAT é read-only, então DDL
-- só passa pelo SQL Editor). IDEMPOTENTE.
--
-- ⚠️ RODAR ANTES DO RESTART DO WORKER: o worker novo começa toda composição em `conceitos`, e a
-- orquestração para em `conceitos` esperando aprovação. Sem esta migração, o CHECK de status recusa
-- a gravação e nenhuma composição começa.
--
-- ----------------------------------------------------------------------------------------------
-- AD COMPOSER — CONCEITOS ESTRATÉGICOS antes de escrever.
--
-- Cada anúncio passa a nascer de um Conceito Estratégico (Avatar + Nível de consciência + Ângulo +
-- Formato), feito do Estudo de Copy do cliente e de uma análise de criativo. O agente sugere um
-- conceito por anúncio, quem pediu aprova ou rejeita (e o agente sugere outro), e só com todos
-- aprovados a composição é escrita. Meta Ads trata conceito idêntico como o mesmo anúncio: a
-- unicidade é conferida pelo worker, pelos ids do catálogo abaixo.
--
-- Composições e orquestrações antigas ficam como estão: `conceitos` vazio é "composta antes disto".
-- ----------------------------------------------------------------------------------------------

-- 1. O estado novo nas duas tabelas.
alter table public.marketing_compositions
  drop constraint if exists marketing_compositions_status_check;
alter table public.marketing_compositions
  add constraint marketing_compositions_status_check
  check (status in ('conceitos', 'running', 'revisao', 'ok', 'error'));

alter table public.marketing_orquestracoes
  drop constraint if exists marketing_orquestracoes_status_check;
alter table public.marketing_orquestracoes
  add constraint marketing_orquestracoes_status_check
  check (status in ('conceitos', 'running', 'revisao', 'ok', 'error'));

-- 2. Os conceitos, o catálogo de onde eles saem, e o aviso de insumo insuficiente.
alter table public.marketing_compositions
  add column if not exists conceitos jsonb not null default '[]'::jsonb;

alter table public.marketing_compositions
  add column if not exists catalogo_copy jsonb;

alter table public.marketing_compositions
  add column if not exists insumos_insuficientes jsonb;

comment on column public.marketing_compositions.conceitos is
  'Um Conceito Estratégico por anúncio: ids de avatar e ângulo (de catalogo_copy), nível, a análise '
  'de criativo que dá o formato, o formato de saída, e o estado (sugerido, gerando, aprovado). Os '
  'rejeitados ficam no histórico do conceito, com o motivo. Vazio em composição antiga.';
comment on column public.marketing_compositions.catalogo_copy is
  'O que foi lido do Estudo de Copy: a identificação do médico e os avatares (pelo código), e os '
  'ângulos (pelo agente, com os trechos que os sustentam). É a referência dos ids de `conceitos`.';
comment on column public.marketing_compositions.insumos_insuficientes is
  'Quando o agente acha que o material não dá conceitos distintos para todos os anúncios: o motivo, '
  'a sugestão de insumo e se quem pediu escolheu seguir assim mesmo (aí conceitos são reciclados em '
  'formatos de saída diferentes). NULL quando o material bastou.';

notify pgrst, 'reload schema';

-- Conferência:
-- SELECT status, count(*) FROM public.marketing_compositions GROUP BY 1;
-- SELECT id, status, jsonb_array_length(conceitos) FROM public.marketing_compositions
--   WHERE status = 'conceitos' ORDER BY criado_em DESC LIMIT 5;
