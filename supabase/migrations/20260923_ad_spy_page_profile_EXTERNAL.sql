-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium), NÃO o projeto
-- primário do config.toml. Rode este SQL no SQL Editor DESSE projeto (o PAT é read-only, então DDL
-- só passa pelo SQL Editor). IDEMPOTENTE.
--
-- Pode rodar a qualquer momento: o worker antigo ignora a coluna, e o frontend cai no link montado
-- a partir do `page_id` enquanto ela estiver vazia.
--
-- ----------------------------------------------------------------------------------------------
-- MINERAÇÃO — perfil do anunciante.
--
-- O menu "Abrir" do card oferece o perfil do anunciante, e a Scrape Creators já manda esse link em
-- `snapshot.page_profile_uri`. Sem guardá-lo, o melhor que dá para fazer é montar
-- `facebook.com/<page_id>`, que resolve, mas é sempre Facebook — e parte dos anunciantes anuncia
-- por um perfil do Instagram.
-- ----------------------------------------------------------------------------------------------

alter table public.ad_spy_ads
  add column if not exists page_profile_uri text;

comment on column public.ad_spy_ads.page_profile_uri is
  'Perfil do anunciante como a fonte o informa (Facebook ou Instagram). Vazio em anúncios '
  'minerados antes desta coluna — nesse caso o frontend monta o link pelo page_id.';

notify pgrst, 'reload schema';

-- Conferência:
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'ad_spy_ads' AND column_name = 'page_profile_uri';
