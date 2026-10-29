-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium), NÃO o projeto
-- primário do config.toml. É onde vivem "Criativos Meta Ads" / v_meta_google_ads e onde o
-- frontend (externalSupabase) lê. Rode este SQL no SQL Editor DESSE projeto (o PAT é read-only,
-- então DDL só passa pelo SQL Editor). IDEMPOTENTE.
--
-- ----------------------------------------------------------------------------------------------
-- Análise diária da IA por ANÚNCIO (Ad_ID). Uma linha por anúncio, SOBRESCRITA a cada dia pelo
-- robô `analysis.ts` (meta-ads-bot) com a leitura mais recente. Guarda três blocos de bullets
-- (pontos positivos / a melhorar / a ajustar AGORA), a tendência vs. a análise anterior e um
-- snapshot das métricas usadas — pra equipe agir rápido no criativo direto pelo modal do card.
--
-- ESCRITA: só o robô, com SUPABASE_SERVICE_KEY (service_role BYPASSA RLS) — igual a "Criativos
-- Meta Ads". O frontend só LÊ.
-- LEITURA: `authenticated`, com o MESMO isolamento de "Criativos Meta Ads":
--   • policy PERMISSIVE  → equipe aprovada (is_approved) enxerga tudo;
--   • policy RESTRICTIVE → usuário-cliente (login externo restrito) só enxerga o próprio `client`
--     via caller_ads_names() (NULL p/ equipe = sem restrição). Espelha 20260730c linha ~343.
-- ----------------------------------------------------------------------------------------------

create table if not exists public.meta_ads_ad_analysis (
  ad_id             text primary key,
  client            text,
  nome_anuncio      text,
  -- Cada bloco é um array JSON de bullets curtos (strings). Default [] pra UI nunca receber null.
  pontos_positivos  jsonb not null default '[]'::jsonb,
  pontos_melhorar   jsonb not null default '[]'::jsonb,
  pontos_ajustar    jsonb not null default '[]'::jsonb,   -- "ajustes AGORA" (urgentes)
  resumo            text,                                  -- 1 frase de leitura geral
  tendencia         text check (tendencia in ('melhorando','estavel','piorando')),
  metricas          jsonb,                                 -- snapshot que alimentou a análise
  modelo            text,                                  -- ex.: claude-sonnet-5
  dia_analisado     date,                                  -- último dia fechado considerado
  updated_at        timestamptz not null default now()
);

alter table public.meta_ads_ad_analysis enable row level security;

-- PERMISSIVE: leitura para equipe aprovada. `is_approved` já é usado nas views/tabelas do
-- projeto (mesma função de aprovação de usuário). Escrita não precisa de policy: o robô usa
-- service_role, que ignora RLS.
drop policy if exists meta_ads_ad_analysis_read on public.meta_ads_ad_analysis;
create policy meta_ads_ad_analysis_read on public.meta_ads_ad_analysis
  for select to authenticated
  using (is_approved(auth.uid()));

-- RESTRICTIVE: AND com a permissive. Usuário-cliente só vê o próprio `client`; equipe
-- (caller_ads_names() = NULL) não é restringida. Idêntico ao criativos_client_scope.
drop policy if exists meta_ads_ad_analysis_client_scope on public.meta_ads_ad_analysis;
create policy meta_ads_ad_analysis_client_scope on public.meta_ads_ad_analysis
  as restrictive for select to authenticated
  using (((select public.caller_ads_names()) IS NULL OR client = ANY((select public.caller_ads_names())::text[])));

-- Consulta do modal é sempre por ad_id (PK já cobre). Índice extra por client p/ varreduras
-- eventuais por conta (ex.: painéis futuros).
create index if not exists idx_meta_ads_ad_analysis_client on public.meta_ads_ad_analysis (client);

notify pgrst, 'reload schema';

-- Conferência rápida depois do 1º run do robô:
-- SELECT ad_id, client, nome_anuncio, tendencia, dia_analisado, updated_at
-- FROM public.meta_ads_ad_analysis ORDER BY updated_at DESC LIMIT 20;
