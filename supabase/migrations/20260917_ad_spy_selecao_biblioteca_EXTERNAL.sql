-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium), NÃO o projeto
-- primário do config.toml. Rode este SQL no SQL Editor DESSE projeto (o PAT é read-only, então DDL
-- só passa pelo SQL Editor). IDEMPOTENTE.
--
-- ⚠️ RODAR ANTES DO PUSH: o auto-deploy publica o frontend novo assim que o commit chega, e o
-- worker novo escreve colunas que só existem depois deste arquivo.
--
-- ----------------------------------------------------------------------------------------------
-- MINERAÇÃO v2 — seleção manual em blocos + Biblioteca de Análises.
--
-- O pipeline deixa de ser automático de ponta a ponta. Agora:
--   1. a busca traz anúncios em BLOCOS de 8, sempre passando nos filtros de qualidade;
--   2. a pessoa marca no grid quais entram;
--   3. só os marcados são transcritos e analisados;
--   4. a análise pode ser salva na Biblioteca, com especialidade(s), visível para toda a equipe.
--
-- Por que blocos, e por que guardar estado da busca: a Scrape Creators cobra por REQUISIÇÃO (~30
-- anúncios por página), e os filtros que mais importam (longevidade, anúncios usando o criativo)
-- só podem ser aplicados depois da resposta. Então a run guarda o cursor da API e o EXCEDENTE que
-- passou nos filtros mas não coube no bloco — o próximo "carregar mais" sai dali sem gastar
-- crédito.
-- ----------------------------------------------------------------------------------------------

-- ============================================================================================
-- 1) ad_spy_runs — novos estados + estado da busca
-- ============================================================================================

-- searching           = buscando um bloco (a UI faz polling)
-- awaiting_selection  = bloco na tela, esperando a pessoa marcar e mandar analisar (sem polling)
alter table public.ad_spy_runs drop constraint if exists ad_spy_runs_status_check;
alter table public.ad_spy_runs add constraint ad_spy_runs_status_check
  check (status in ('queued','searching','awaiting_selection','running','done','error','canceled'));

-- { cursor, exhausted, buffer: MinedAd[], seen: string[], advertisers: {pageId: n},
--   creditsUsed, pagesUsed, lastNote }
-- `buffer` guarda anúncios que passaram nos filtros e ainda não foram mostrados. `advertisers`
-- persiste a contagem do "máximo por anunciante" entre blocos — sem isso cada bloco zerava o limite.
alter table public.ad_spy_runs
  add column if not exists search_state jsonb not null default '{}'::jsonb;

-- ============================================================================================
-- 2) ad_spy_ads — métrica de replicação, seleção e links de origem
-- ============================================================================================

alter table public.ad_spy_ads
  -- Quantos anúncios usam o mesmo criativo+texto ("13 anúncios usam esse criativo e esse texto").
  -- Anunciante replicando a peça em vários anúncios = colocando dinheiro nela. NULL = a fonte não
  -- informou (e aí um filtro de mínimo o reprova).
  add column if not exists collation_count int,
  add column if not exists is_active boolean,
  -- Marcado pela pessoa no grid para entrar na transcrição/análise.
  add column if not exists selected boolean not null default false,
  -- URLs de ORIGEM da mídia. A CDN da Meta assina com validade de horas; ficam guardadas porque a
  -- transcrição agora acontece depois da seleção, e o worker renova pelo id se tiverem expirado.
  add column if not exists media_url text,
  add column if not exists thumb_url text,
  -- Avatar do anunciante, rehospedado no bucket (o link original também expira).
  add column if not exists avatar_path text;

create index if not exists idx_ad_spy_ads_run_selected
  on public.ad_spy_ads (run_id) where selected;

-- ============================================================================================
-- 3) ad_spy_library — análises salvas, compartilhadas com toda a equipe
-- ============================================================================================
-- SNAPSHOT, não referência: guarda cópia da análise e dos anúncios selecionados. Reanalisar a run
-- depois não altera o que foi salvo, e a entrada sobrevive se a run for limpa. `run_id` fica só
-- como rastro (on delete set null).

create table if not exists public.ad_spy_library (
  id               uuid primary key default gen_random_uuid(),
  run_id           uuid references public.ad_spy_runs(id) on delete set null,
  tema             text not null,
  titulo           text,
  -- Várias por análise: "harmonização" pode servir a Dermatologia e a Cirurgia Plástica. Valores
  -- vêm da mesma lista normalizada do filtro de especialidades (v_cliente_especialidades).
  especialidades   text[] not null default '{}'::text[],
  settings         jsonb not null default '{}'::jsonb,
  extra_prompt     text,
  analysis_md      text not null,
  analysis         jsonb,
  -- Cópia dos anúncios selecionados, na MESMA ORDEM que o agente leu — é por essa ordem que a
  -- análise cita #1, #2...
  ads              jsonb not null default '[]'::jsonb,
  saved_by         uuid not null,
  saved_by_name    text,
  criado_em        timestamptz not null default now()
);

comment on table public.ad_spy_library is
  'Biblioteca de Análises da Mineração: snapshot de análise + anúncios selecionados, com '
  'especialidades. Visível para toda a equipe interna; apaga quem salvou ou admin (via worker).';

alter table public.ad_spy_library enable row level security;

-- Leitura: equipe interna aprovada. `caller_ads_names()` é NULL para quem não é usuário-cliente
-- (mesma regra das outras tabelas). Escrita não tem policy: passa pelo worker com service_role,
-- que também impõe "só quem salvou ou admin apaga".
drop policy if exists ad_spy_library_read on public.ad_spy_library;
create policy ad_spy_library_read on public.ad_spy_library
  for select to authenticated
  using (is_approved(auth.uid()) and (select public.caller_ads_names()) is null);

create index if not exists idx_ad_spy_library_criado on public.ad_spy_library (criado_em desc);
-- Filtro por especialidade usa `&&` (sobreposição de arrays).
create index if not exists idx_ad_spy_library_especialidades
  on public.ad_spy_library using gin (especialidades);

notify pgrst, 'reload schema';

-- Conferência:
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'ad_spy_ads' AND column_name IN ('collation_count','selected','media_url');
-- SELECT id, tema, especialidades, saved_by_name, criado_em FROM public.ad_spy_library
--  ORDER BY criado_em DESC LIMIT 10;
