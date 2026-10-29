-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium), NÃO o projeto
-- primário do config.toml. Rode este SQL no SQL Editor DESSE projeto (o PAT é read-only, então DDL
-- só passa pelo SQL Editor). IDEMPOTENTE.
--
-- ⚠️ RODAR ANTES DO RESTART DO WORKER: o worker novo termina toda composição em `revisao` e toda
-- orquestração em `revisao`. Sem esta migração, o CHECK de status recusa a gravação e a composição
-- inteira termina em erro no último passo.
--
-- ----------------------------------------------------------------------------------------------
-- AD COMPOSER — REVISÃO antes de salvar.
--
-- Até aqui a composição ficava salva assim que o agente terminava. Agora ela termina EM REVISÃO:
-- quem pediu edita os anúncios à mão, pede ao agente que revise um anúncio com um texto, desfaz o
-- que não gostou e, por fim, salva. A orquestração que gerou a composição espera na mesma revisão.
--
-- Composições e orquestrações antigas ficam como estão (`ok`): já estavam salvas.
-- ----------------------------------------------------------------------------------------------

-- 1. O estado novo nas duas tabelas.
alter table public.marketing_compositions
  drop constraint if exists marketing_compositions_status_check;
alter table public.marketing_compositions
  add constraint marketing_compositions_status_check
  check (status in ('running', 'revisao', 'ok', 'error'));

alter table public.marketing_orquestracoes
  drop constraint if exists marketing_orquestracoes_status_check;
alter table public.marketing_orquestracoes
  add constraint marketing_orquestracoes_status_check
  check (status in ('running', 'revisao', 'ok', 'error'));

-- 2. As versões anteriores dos anúncios: [{ indice, motivo, por, em, composicao, composicao_md,
-- avisos }], com `motivo` em edicao | revisao. Toda edição à mão e toda revisão pelo agente
-- empilham aqui a versão que estava antes; o "desfazer" de um anúncio tira a mais recente DELE.
-- O worker guarda as 30 últimas da composição.
alter table public.marketing_compositions
  add column if not exists versoes jsonb not null default '[]'::jsonb;

comment on column public.marketing_compositions.versoes is
  'Versões anteriores dos anúncios, empilhadas a cada edição ou revisão durante a revisão da '
  'composição. É o que o "desfazer" devolve. As 30 últimas.';

-- 3. A composição que a orquestração espera é achada por ela no "salvar".
create index if not exists idx_marketing_orquestracoes_composition
  on public.marketing_orquestracoes (composition_id);

notify pgrst, 'reload schema';

-- Conferência:
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE conname IN ('marketing_compositions_status_check', 'marketing_orquestracoes_status_check');
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'marketing_compositions' AND column_name = 'versoes';
