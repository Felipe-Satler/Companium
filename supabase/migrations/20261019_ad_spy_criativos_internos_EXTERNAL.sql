-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium), NÃO o projeto
-- primário do config.toml. Rode este SQL no SQL Editor DESSE projeto. IDEMPOTENTE.
--
-- ⚠️ RODAR ANTES DO RESTART DO WORKER: ele passa a gravar as colunas novas em toda análise de
-- criativo, e o PostgREST recusa a linha inteira se a coluna não existir.
--
-- ----------------------------------------------------------------------------------------------
-- MINERAÇÃO › ANÁLISES DE CRIATIVOS — criativos INTERNOS do cliente.
--
-- Além dos anúncios de concorrentes (da Mineração), a dissecação passa a poder ser de um anúncio
-- do PRÓPRIO cliente, da conta de anúncios dele ("Criativos Meta Ads"). O vídeo vem do link do
-- post (`Video_Permalink`), pela Scrape Creators.
--
-- origem      'mineracao' (anúncio de concorrente, de uma busca) | 'cliente' (anúncio do cliente)
-- cliente     o `padrao` do cliente, para a origem 'cliente'
-- meta_ad_id  o `Ad_ID` da conta de anúncios, para a origem 'cliente' — é por ele que o Composer
--             diz se um criativo interno já foi dissecado
-- ----------------------------------------------------------------------------------------------

alter table public.ad_spy_criativos
  add column if not exists origem text not null default 'mineracao',
  add column if not exists cliente text,
  add column if not exists meta_ad_id text;

alter table public.ad_spy_criativos drop constraint if exists ad_spy_criativos_origem_check;
alter table public.ad_spy_criativos
  add constraint ad_spy_criativos_origem_check check (origem in ('mineracao', 'cliente'));

create index if not exists idx_ad_spy_criativos_meta_ad
  on public.ad_spy_criativos (meta_ad_id) where origem = 'cliente';

notify pgrst, 'reload schema';

-- Conferência:
-- SELECT origem, count(*) FROM public.ad_spy_criativos GROUP BY 1;
