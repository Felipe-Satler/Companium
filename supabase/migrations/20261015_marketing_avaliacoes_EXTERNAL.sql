-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium), NÃO o projeto
-- primário do config.toml. Rode este SQL no SQL Editor DESSE projeto (o PAT é read-only, então DDL
-- só passa pelo SQL Editor). IDEMPOTENTE.
--
-- ⚠️ RODAR ANTES DO RESTART DO WORKER: as rotas novas leem e escrevem estas tabelas. É aditiva e
-- inofensiva enquanto ninguém as lê, então pode rodar com antecedência.
--
-- ----------------------------------------------------------------------------------------------
-- CONTROLE DE QUALIDADE — voto e tag de análises da Mineração e composições do Composer.
--
-- ## Duas tabelas porque são duas cardinalidades, não por simetria
--
-- O **voto** é por pessoa: controle de qualidade com uma opinião só não é controle, e saber quem
-- votou é o que permite perguntar por quê. A **tag** é do item, uma só: ela classifica o artefato,
-- não a opinião de alguém sobre ele.
--
-- Juntar as duas numa tabela com `user_id` nulável faria "linha de tag" e "linha de voto" conviverem
-- com significados diferentes na mesma chave — e toda consulta teria de lembrar qual é qual.
--
-- ## Voto e tag dizem coisas diferentes, de propósito
--
-- O voto diz se a peça presta; a tag diz **o que fazer com ela**. Nenhuma tag do vocabulário
-- (`shared/avaliacao-tags.js`) é adjetivo de qualidade — todas são encaminhamento. Sem essa
-- separação a tag vira um segundo voto, pior, porque com uma opinião só.
--
-- ## Polimórfico: o que isso custa
--
-- `alvo_tipo` em ('analise','composicao') com `alvo_id` solto é o que torna isto UM sistema para os
-- dois — uma migração, um par de rotas, um componente. O preço é não haver FK: apagar uma análise
-- **não** limpa os votos dela em cascata. Por isso a limpeza entra nos dois caminhos de exclusão que
-- o worker já é dono (`deleteLibraryEntry`, `deleteComposition`). Se alguém apagar por fora do
-- worker, sobram linhas órfãs — invisíveis, porque toda leitura parte do item.
-- ----------------------------------------------------------------------------------------------

create table if not exists public.marketing_votos (
  alvo_tipo  text not null check (alvo_tipo in ('analise', 'composicao')),
  alvo_id    text not null,
  user_id    uuid not null,
  -- 1 ou -1. NÃO existe 0: "votei neutro" e "não votei" seriam indistinguíveis na contagem, e a
  -- contagem é a única coisa que a tela mostra. Tirar o voto é apagar a linha.
  voto       smallint not null check (voto in (1, -1)),
  criado_em  timestamptz not null default now(),
  -- Votar de novo é a mesma coisa que votar uma vez: a PK torna o upsert idempotente, como nos
  -- favoritos da Biblioteca.
  primary key (alvo_tipo, alvo_id, user_id)
);

comment on table public.marketing_votos is
  'Voto de qualidade (+1/-1) por PESSOA em análise da Mineração ou composição do Composer. Uma '
  'opinião só não é controle de qualidade, daí ser por usuário e a tela mostrar o agregado. '
  'Polimórfico por `alvo_tipo`: é o mesmo sistema para os dois artefatos. Escrita pelo worker.';

create table if not exists public.marketing_tags (
  alvo_tipo    text not null check (alvo_tipo in ('analise', 'composicao')),
  alvo_id      text not null,
  -- O id do vocabulário de `shared/avaliacao-tags.js`. Sem CHECK com a lista de propósito: tag nova
  -- entraria por deploy de frontend/worker, e um CHECK obrigaria uma migração a cada tag. O worker
  -- valida contra `tagValida()`, que é a MESMA definição que a tela usa.
  tag          text not null,
  -- Quem definiu por último. Qualquer pessoa interna pode trocar (decisão do usuário), então isto
  -- não é permissão — é rastro: saber a quem perguntar quando a tag parecer errada.
  definida_por uuid,
  definida_em  timestamptz not null default now(),
  -- UMA tag por item. Trocar é sobrescrever.
  primary key (alvo_tipo, alvo_id)
);

comment on table public.marketing_tags is
  'A tag de encaminhamento de uma análise ou composição — UMA por item, compartilhada pela equipe. '
  'Diz o que FAZER com a peça; se o julgamento de qualidade é o voto (marketing_votos). O id vem de '
  'shared/avaliacao-tags.js e é validado no worker, não por CHECK, para tag nova não pedir migração.';

alter table public.marketing_votos enable row level security;
alter table public.marketing_tags enable row level security;

-- Leitura: equipe interna aprovada. `caller_ads_names()` é NULL para quem não é usuário-cliente —
-- mesma regra das outras tabelas de Marketing.
--
-- O voto é lido por TODOS (não só o próprio, como nos favoritos): o agregado é o produto, e esconder
-- o voto alheio tornaria "+3 / -1" impossível de montar. Quem votou o quê é informação de equipe
-- aqui, e é de propósito — é o que permite perguntar por quê.
drop policy if exists marketing_votos_read on public.marketing_votos;
create policy marketing_votos_read on public.marketing_votos
  for select to authenticated
  using (is_approved(auth.uid()) and (select public.caller_ads_names()) is null);

drop policy if exists marketing_tags_read on public.marketing_tags;
create policy marketing_tags_read on public.marketing_tags
  for select to authenticated
  using (is_approved(auth.uid()) and (select public.caller_ads_names()) is null);

-- As duas consultas reais: "os votos/tags DESTES itens" (a tela carrega uma página de cada vez) e
-- "os itens com esta tag" (o filtro).
create index if not exists idx_marketing_votos_alvo
  on public.marketing_votos (alvo_tipo, alvo_id);
create index if not exists idx_marketing_tags_tag
  on public.marketing_tags (alvo_tipo, tag);

notify pgrst, 'reload schema';

-- Conferência:
-- SELECT to_regclass('public.marketing_votos'), to_regclass('public.marketing_tags');
-- SELECT alvo_tipo, tag, count(*) FROM public.marketing_tags GROUP BY 1,2 ORDER BY 3 DESC;
-- SELECT alvo_tipo, alvo_id, sum(voto) AS saldo, count(*) AS votos
--   FROM public.marketing_votos GROUP BY 1,2 ORDER BY saldo DESC LIMIT 20;
