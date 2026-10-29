-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium), NÃO o projeto
-- primário do config.toml. Rode este SQL no SQL Editor DESSE projeto (o PAT é read-only, então DDL
-- só passa pelo SQL Editor). IDEMPOTENTE.
--
-- ⚠️ RODAR ANTES DO RESTART DO WORKER: o worker novo grava `entradas` e deixa de mandar `formato`
-- no insert. Com o `not null` ainda de pé, toda composição falharia no banco.
--
-- ----------------------------------------------------------------------------------------------
-- AD COMPOSER v2 — os insumos escolhidos, e o formato deixando de ser imposto.
--
-- Duas mudanças de conceito:
--
-- 1. `formato` era o formato PEDIDO, obrigatório, escolhido antes de existir qualquer ideia. Agora
--    é o formato que a composição É: quem decide é o agente, lendo o material (ou obedecendo ao
--    pedido no prompt). Por isso deixa de ser `not null` — na hora do insert ainda não se sabe.
--
-- 2. A composição deixa de ser alimentada só por uma análise. Entram o Contexto Operacional, as
--    métricas da semana fechada, os relatórios e os documentos do ClickUp — e `entradas` registra
--    exatamente o que foi escolhido.
-- ----------------------------------------------------------------------------------------------

alter table public.marketing_compositions alter column formato drop not null;

-- O que alimentou esta composição: [{ tipo, id, titulo }], com `tipo` em
-- analise | brief | metricas | relatorio | documento.
--
-- UMA coluna em vez de quatro (nem `report_ids uuid[]`, nem `doc_ids text[]`) porque a lista de
-- tipos de insumo vai crescer, e cada tipo novo não pode custar uma migração.
--
-- Guarda o TÍTULO do insumo no momento da composição, pelo mesmo motivo que `analise_titulo` já
-- existe: relatório apagado ou documento renomeado no ClickUp não podem apagar em silêncio a
-- origem da ideia. Um histórico que perde a procedência é indistinguível de um histórico errado.
alter table public.marketing_compositions
  add column if not exists entradas jsonb not null default '[]'::jsonb;

-- Por que o agente escolheu esse formato, em uma frase. É o que separa "o bot escolheu" de
-- "o bot escolheu por isso" — sem ela, a escolha é uma caixa preta e a pessoa só pode aceitar.
alter table public.marketing_compositions
  add column if not exists formato_justificativa text;

comment on column public.marketing_compositions.formato is
  'Id de `shared/ad-formats.js`. O formato que a composição É, escrito DEPOIS que o agente decide '
  '— não o formato pedido. NULL enquanto a composição está rodando, ou quando o agente não '
  'declarou um formato válido (aí a composição degrada para prosa).';

notify pgrst, 'reload schema';

-- Conferência:
-- SELECT column_name, is_nullable FROM information_schema.columns
--  WHERE table_name = 'marketing_compositions'
--    AND column_name IN ('formato','entradas','formato_justificativa');
