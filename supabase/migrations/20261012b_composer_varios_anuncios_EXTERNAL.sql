-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium), NÃO o projeto
-- primário do config.toml. Rode este SQL no SQL Editor DESSE projeto (o PAT é read-only, então DDL
-- só passa pelo SQL Editor). IDEMPOTENTE.
--
-- ⚠️ RODAR ANTES DO RESTART DO WORKER: o worker novo grava `anuncios` e `plano` em toda composição,
-- e lista `plano`. Sem as colunas, a listagem responde 502 e toda composição termina em erro.
--
-- ----------------------------------------------------------------------------------------------
-- AD COMPOSER v3 — uma composição são de 1 a 8 anúncios.
--
-- Até aqui uma linha era UM anúncio: `formato`, `composicao` e `avisos` descreviam a peça. Agora o
-- agente decide, lendo o pedido, quantos anúncios o conjunto tem e para que uso é cada um (Reels,
-- Stories, Feed, Meta Ads, Google Ads), e escreve um por vez. A linha é regravada a cada anúncio
-- pronto — é isso que a tela lê para dizer "3 de 5".
--
-- As colunas antigas ficam, e continuam sendo a verdade das composições ANTIGAS (que têm `anuncios`
-- vazio): a tela lê uma linha sem `anuncios` como um conjunto de um anúncio só. Nas novas:
--   - `composicao_md` passa a ser a prosa do CONJUNTO;
--   - `formato` / `formato_justificativa` repetem os do primeiro anúncio;
--   - `composicao` fica NULL;
--   - `avisos` junta os de todos os anúncios, cada um com `anuncio` (a posição na lista).
-- ----------------------------------------------------------------------------------------------

-- O conjunto inteiro, na ordem em que é escrito:
--   [{ formato, angulo, formato_justificativa, status, composicao_md, composicao, avisos, error }]
-- `status` de cada anúncio: pendente | running | ok | error. Um anúncio que falha não derruba os
-- outros, então a linha pode terminar `ok` com um item em `error`.
alter table public.marketing_compositions
  add column if not exists anuncios jsonb not null default '[]'::jsonb;

-- O mesmo conjunto SEM a copy: [{ formato, angulo, status }]. Existe para a listagem, que mostra
-- dezenas de composições e não pode carregar oito peças inteiras em cada uma. É escrito pelo worker
-- junto de `anuncios`, sempre derivado dele.
alter table public.marketing_compositions
  add column if not exists plano jsonb not null default '[]'::jsonb;

comment on column public.marketing_compositions.anuncios is
  'Os anúncios da composição (1 a 8), com a copy por campo de cada um. Vazio em composição antiga, '
  'que tem um anúncio só nas colunas `formato`/`composicao`/`avisos`.';
comment on column public.marketing_compositions.plano is
  'Resumo de `anuncios` para a listagem: formato, ângulo e estado de cada um, sem a copy.';

notify pgrst, 'reload schema';

-- Conferência:
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_name = 'marketing_compositions' AND column_name IN ('anuncios','plano');
-- SELECT id, cliente, jsonb_array_length(plano) AS anuncios, status, criado_em
--   FROM public.marketing_compositions ORDER BY criado_em DESC LIMIT 10;
