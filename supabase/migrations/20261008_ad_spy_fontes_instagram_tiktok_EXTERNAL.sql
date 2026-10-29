-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium), NÃO o projeto
-- primário do config.toml. Rode este SQL no SQL Editor DESSE projeto (o PAT é read-only, então DDL
-- só passa pelo SQL Editor). IDEMPOTENTE.
--
-- RODE ANTES de reiniciar o worker. O worker novo grava `found_via` e `metrics` em todo upsert, e
-- o PostgREST recusa a linha inteira se a coluna não existir — a busca falharia já no 1º bloco,
-- inclusive as só de Meta.
--
-- ----------------------------------------------------------------------------------------------
-- MINERAÇÃO — Instagram (orgânico) e TikTok Ads como fontes, na mesma busca que a Meta.
--
-- `source` continua sendo a PLATAFORMA (meta | instagram | tiktok); a unique
-- (run_id, source, external_id) segue valendo, e um reel achado pela hashtag E pela busca de reels
-- é uma linha só.
--
-- found_via  qual trilha achou a peça: 'reels', 'hashtag:<tag>', 'perfil:@<handle>', 'link',
--            'busca' (TikTok). Na Meta fica NULL — só há uma trilha.
-- metrics    números que só algumas fontes têm, e cujo SIGNIFICADO muda de fonte para fonte, por
--            isso jsonb e não colunas:
--              instagram: views, likes, comments, followers, paidPartnership
--              tiktok:    lastShownOn, estimatedAudience, impressions, spent, likes, comments,
--                         shares, ctr, creativeCenterUrl
--              ambos:     hydrated (já completado pelo detalhe — não gastar crédito de novo)
-- ----------------------------------------------------------------------------------------------

alter table public.ad_spy_ads
  add column if not exists found_via text,
  add column if not exists metrics jsonb;

comment on column public.ad_spy_ads.found_via is
  'Trilha da busca que achou a peça (reels, hashtag:x, perfil:@x, link, busca). NULL na Meta.';
comment on column public.ad_spy_ads.metrics is
  'Números por fonte (views/likes/comments no Instagram; audiência/ctr/likes no TikTok). NULL na Meta.';
comment on column public.ad_spy_ads.source is
  'Plataforma: meta | instagram | tiktok. Instagram é conteúdo ORGÂNICO, não anúncio.';

notify pgrst, 'reload schema';

-- Conferência:
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'ad_spy_ads' AND column_name IN ('found_via', 'metrics');
