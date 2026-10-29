-- Mineração › "perguntar ao grid".
--
-- A última pergunta feita sobre as peças de uma busca e a resposta de cada peça:
--   { id, texto, status: running|done|error, error, pedido_em, concluido_em, total, feito,
--     respostas: { "<ad id>": { veredito: atende|parcial|nao|null, trecho, base: copy|transcricao|vazio } } }
--
-- Uma coluna na run, e não uma tabela: é UMA pergunta por busca (a nova substitui a anterior), lida
-- sempre junto com a run pelo mesmo polling. Nula = nunca perguntaram.
--
-- Rodar ANTES de reiniciar o worker: ele passa a selecionar esta coluna em toda leitura de run.
--
-- Projeto EXTERNO (your-project-ref).

alter table public.ad_spy_runs
  add column if not exists question jsonb;

comment on column public.ad_spy_runs.question is
  'Mineração: última pergunta feita ao grid e o veredito por peça (apps/ad-spy-worker/pergunta.js).';
