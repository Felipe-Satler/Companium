-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium), NÃO o projeto
-- primário do config.toml. Rode este SQL no SQL Editor DESSE projeto (o PAT é read-only, então DDL
-- só passa pelo SQL Editor). IDEMPOTENTE.
--
-- ⚠️ RODAR ANTES DO RESTART DO WORKER: as rotas novas (/api/spy/criativos) leem e escrevem estas
-- tabelas, e o voto/tag de criativo é recusado pelo CHECK antigo. É aditiva: pode rodar antes.
--
-- ----------------------------------------------------------------------------------------------
-- MINERAÇÃO › ANÁLISES DE CRIATIVOS — a dissecação de UM anúncio, salva por especialidade.
--
-- Antes a dissecação vinha dentro da análise da mineração, uma linha por anúncio, numa tabela que
-- ninguém conseguia reaproveitar sozinha. Agora é pedida peça a peça ("Analisar Criativo") e vira um
-- item próprio, com voto, tag, favorito e filtro, como as Minerações Salvas.
--
-- `ad` é um SNAPSHOT do anúncio (como `ad_spy_library.ads`): a análise tem de continuar legível
-- depois que a busca de onde ele veio for apagada. `run_id` e `library_entry_id` são só a origem.
-- ----------------------------------------------------------------------------------------------

create table if not exists public.ad_spy_criativos (
  id                uuid primary key default gen_random_uuid(),
  -- De onde a peça veio. Um dos dois, ou nenhum se a origem já foi apagada.
  run_id            uuid references public.ad_spy_runs(id) on delete set null,
  library_entry_id  uuid references public.ad_spy_library(id) on delete set null,
  ad_id             bigint,
  titulo            text,
  -- Uma por análise, como na Biblioteca; `text[]` pelo mesmo motivo de lá (filtro por overlap).
  especialidades    text[] not null default '{}'::text[],
  ad                jsonb not null default '{}'::jsonb,
  -- running -> done | error. A tela acompanha por polling.
  status            text not null default 'running' check (status in ('running', 'done', 'error')),
  -- O que está acontecendo agora ("transcrevendo o vídeo", "analisando"), para a tela dizer.
  etapa             text,
  error             text,
  -- formato, estrutura, anatomia_semantica, anatomia_psicologica, nivel_consciencia
  dissecacao        jsonb,
  dissecacao_md     text,
  saved_by          uuid not null,
  saved_by_name     text,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);

comment on table public.ad_spy_criativos is
  'Mineração › Análises de Criativos: a dissecação de UM anúncio pelo spyagent (formato, estrutura, '
  'anatomia semântica e psicológica, nível de consciência), salva por especialidade. Visível para '
  'toda a equipe interna; apaga quem pediu ou admin (via worker).';

alter table public.ad_spy_criativos enable row level security;

drop policy if exists ad_spy_criativos_read on public.ad_spy_criativos;
create policy ad_spy_criativos_read on public.ad_spy_criativos
  for select to authenticated
  using (is_approved(auth.uid()) and (select public.caller_ads_names()) is null);

create index if not exists idx_ad_spy_criativos_criado on public.ad_spy_criativos (criado_em desc);
create index if not exists idx_ad_spy_criativos_especialidades
  on public.ad_spy_criativos using gin (especialidades);

-- Favoritos: a lista é da equipe, a estrela é de cada um — igual a ad_spy_library_favoritos.
create table if not exists public.ad_spy_criativos_favoritos (
  criativo_id  uuid not null references public.ad_spy_criativos(id) on delete cascade,
  user_id      uuid not null,
  criado_em    timestamptz not null default now(),
  primary key (criativo_id, user_id)
);

alter table public.ad_spy_criativos_favoritos enable row level security;

drop policy if exists ad_spy_criativos_favoritos_read on public.ad_spy_criativos_favoritos;
create policy ad_spy_criativos_favoritos_read on public.ad_spy_criativos_favoritos
  for select to authenticated
  using (
    user_id = auth.uid()
    and is_approved(auth.uid())
    and (select public.caller_ads_names()) is null
  );

-- Voto e tag: o mesmo sistema das análises e composições, com um tipo a mais.
alter table public.marketing_votos drop constraint if exists marketing_votos_alvo_tipo_check;
alter table public.marketing_votos
  add constraint marketing_votos_alvo_tipo_check check (alvo_tipo in ('analise', 'composicao', 'criativo'));
alter table public.marketing_tags drop constraint if exists marketing_tags_alvo_tipo_check;
alter table public.marketing_tags
  add constraint marketing_tags_alvo_tipo_check check (alvo_tipo in ('analise', 'composicao', 'criativo'));

notify pgrst, 'reload schema';

-- Conferência:
-- SELECT to_regclass('public.ad_spy_criativos'), to_regclass('public.ad_spy_criativos_favoritos');
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'public.marketing_votos'::regclass AND contype = 'c';
