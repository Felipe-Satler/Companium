-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium), NÃO o projeto
-- primário do config.toml. É onde o frontend (externalSupabase) lê e onde vivem as tabelas
-- de ads. Rode este SQL no SQL Editor DESSE projeto (o PAT é read-only, então DDL só passa
-- pelo SQL Editor). IDEMPOTENTE.
--
-- ----------------------------------------------------------------------------------------------
-- MINERAÇÃO DE ANÚNCIOS (ad spy) — página /marketing, seção "Mineração". Uso INTERNO.
--
-- Diferente de "Criativos Meta Ads" / meta_ads_ad_analysis, que guardam os anúncios DOS NOSSOS
-- CLIENTES (first-party, vindos do robô de ingestão), estas duas tabelas guardam anúncios de
-- TERCEIROS garimpados na Biblioteca de Anúncios da Meta por tema — é pesquisa de concorrência,
-- insumo pra briefing de criativo.
--
-- Duas tabelas:
--   • ad_spy_runs — 1 linha por execução. É a ÚNICA fonte de verdade do pipeline visual: o
--     worker reescreve `stages` a cada etapa e o frontend faz polling dessa coluna. Isso existe
--     porque uma run leva minutos e, atrás do nginx, a desconexão do browser é indetectável
--     (mesma lição do persistBackgroundReply no openclaw-bridge): o resultado precisa ser
--     durável independente de quem está ouvindo. Efeito colateral bom: F5 não perde a run.
--   • ad_spy_ads — o corpus garimpado (cópia do anúncio + transcrição do vídeo).
--
-- ESCRITA: só o worker (apps/ad-spy-worker), com SUPABASE_SERVICE_KEY (service_role BYPASSA
-- RLS) — mesmo padrão de todas as tabelas escritas por robô neste projeto. O frontend só LÊ.
--
-- LEITURA: escopo de DONO, não de cliente. Uma run é pesquisa pessoal de quem rodou, não dado
-- de cliente, então o isolamento aqui é `user_id = auth.uid()` e NÃO caller_ads_names(). Por
-- isso também NÃO há policy restritiva de cliente: usuário-cliente não chega nessa página (o
-- ProtectedRoute derruba /marketing pra quem tem linha em user_client_scope) e o worker recusa
-- com 403 no servidor. Defesa em profundidade, não dependência do frontend.
-- ----------------------------------------------------------------------------------------------

-- ============================================================================================
-- 1) ad_spy_runs
-- ============================================================================================

create table if not exists public.ad_spy_runs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null,
  tema           text not null,
  -- Quais fontes foram pedidas. Hoje só 'meta' funciona; 'google'/'tiktok' já são aceitos pelo
  -- schema pra não precisar migration quando os adapters existirem.
  sources        text[] not null default '{meta}'::text[],
  -- Configurações de busca/qualidade do formulário (country, language, status, mediaType,
  -- startDate, endDate, limit, minDaysRunning, maxPerAdvertiser, sortBy, minCopyChars,
  -- transcribe). jsonb em vez de colunas porque o conjunto vai mudar junto com a UI.
  settings       jsonb not null default '{}'::jsonb,
  -- Texto livre que o usuário acrescenta ao prompt de análise. NÃO substitui o contrato de
  -- saída — o agente é instruído a tratar isso como instrução adicional.
  extra_prompt   text,
  status         text not null default 'queued'
                   check (status in ('queued','running','done','error','canceled')),
  -- Pipeline visual. Array de objetos na ORDEM de execução:
  --   {key,label,status,done,total,started_at,ended_at,note}
  --   status ∈ pending | running | done | error | skipped
  -- Default [] pra UI nunca receber null.
  stages         jsonb not null default '[]'::jsonb,
  -- Pedido de cancelamento. O runner checa entre etapas (não mata processo no meio).
  cancel_requested boolean not null default false,
  -- Resultado: prosa em markdown + bloco estruturado. analysis_md sobrevive mesmo se o JSON
  -- vier malformado, então um parse ruim degrada pra "relatório sem os painéis" em vez de
  -- falhar a run inteira.
  analysis_md    text,
  analysis       jsonb,
  -- Qual provider de fato respondeu (playwright | scrapecreators). Guardado porque é a primeira
  -- coisa que se quer saber quando uma run vem vazia ou estranha.
  meta_provider  text,
  error          text,
  criado_em      timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.ad_spy_runs is
  'Ad spy (/marketing > Mineração): 1 linha por execução. `stages` é a fonte de verdade do '
  'pipeline visual, lida por polling. Escrita só pelo worker via service_role.';

alter table public.ad_spy_runs enable row level security;

-- Só o dono lê a própria run, e só se aprovado. Escrita não precisa de policy: o worker usa
-- service_role, que ignora RLS.
drop policy if exists ad_spy_runs_read on public.ad_spy_runs;
create policy ad_spy_runs_read on public.ad_spy_runs
  for select to authenticated
  using (user_id = auth.uid() and is_approved(auth.uid()));

-- Histórico do usuário é sempre "minhas runs, mais novas primeiro".
create index if not exists idx_ad_spy_runs_user_criado
  on public.ad_spy_runs (user_id, criado_em desc);

-- ============================================================================================
-- 2) ad_spy_ads
-- ============================================================================================

create table if not exists public.ad_spy_ads (
  id                 bigint generated always as identity primary key,
  run_id             uuid not null references public.ad_spy_runs(id) on delete cascade,
  source             text not null,                -- meta | google | tiktok
  external_id        text,                          -- ad_archive_id na Meta
  -- Anunciante
  page_name          text,
  page_id            text,
  permalink          text,                          -- link de volta pra Biblioteca de Anúncios
  -- Texto do anúncio
  ad_copy            text,
  title              text,
  cta_text           text,
  link_url           text,
  display_format     text,
  publisher_platform text[],
  -- Longevidade: o melhor proxy PÚBLICO de "esse anúncio está funcionando" é há quanto tempo
  -- ele roda. days_running é calculado na coleta (não é GENERATED porque a run é um retrato
  -- de uma data e o valor não deve mudar depois).
  started_running_on date,
  days_running       int,
  -- Mídia. media_path fica NULL quando o vídeo é descartado após a transcrição
  -- (SPY_KEEP_VIDEO=0, default) — o permalink é o que garante voltar ao anúncio real.
  media_type         text,                          -- video | image
  thumb_path         text,
  media_path         text,
  duration_sec       numeric,
  -- Transcrição local (faster-whisper; o PyAV decodifica o mp4, sem ffmpeg). NULL = não
  -- transcrito: imagem, falha, ou anúncio SEM FALA (só música) — nesse caso é vazio de
  -- propósito, porque o Whisper alucina letra de música se deixarem.
  transcript         text,
  transcript_lang    text,
  transcript_model   text,
  criado_em          timestamptz not null default now(),
  -- O mesmo anúncio aparece várias vezes na rolagem infinita da Biblioteca; o upsert do worker
  -- depende desta constraint pra deduplicar dentro da run.
  unique (run_id, source, external_id)
);

comment on table public.ad_spy_ads is
  'Ad spy: corpus garimpado de uma run (anúncios de TERCEIROS, não dos clientes). Cópia do '
  'anúncio + transcrição local do vídeo. Escrita só pelo worker via service_role.';

alter table public.ad_spy_ads enable row level security;

-- Herda o escopo da run: leio os anúncios de uma run se ela é minha.
drop policy if exists ad_spy_ads_read on public.ad_spy_ads;
create policy ad_spy_ads_read on public.ad_spy_ads
  for select to authenticated
  using (
    exists (
      select 1 from public.ad_spy_runs r
      where r.id = ad_spy_ads.run_id
        and r.user_id = auth.uid()
        and is_approved(auth.uid())
    )
  );

-- Toda leitura do corpus é "os anúncios desta run".
create index if not exists idx_ad_spy_ads_run on public.ad_spy_ads (run_id);

-- ============================================================================================
-- 3) Storage — bucket privado pra thumbnails e (opcionalmente) os vídeos
-- ============================================================================================
-- PRIVADO de propósito. Os bytes são servidos same-origin pelo worker
-- (GET /api/spy/media/:adId/thumb.jpg), nunca por URL *.supabase.co — mesmo motivo documentado
-- em src/chatbot/docs/openclaw-contract.md §5 (URL cross-origin faz o browser navegar em vez de
-- baixar, e URL pública vaza acesso). Caminho: ${userId}/${runId}/${adId}.{jpg,mp4}
insert into storage.buckets (id, name, public)
values ('ad-spy-media', 'ad-spy-media', false)
on conflict (id) do nothing;

notify pgrst, 'reload schema';

-- Conferência rápida depois da 1ª run:
-- SELECT id, tema, status, meta_provider, jsonb_array_length(stages) AS etapas, criado_em
-- FROM public.ad_spy_runs ORDER BY criado_em DESC LIMIT 10;
--
-- SELECT page_name, days_running, left(ad_copy, 60) AS copy, length(transcript) AS transc
-- FROM public.ad_spy_ads WHERE run_id = '<uuid>' ORDER BY days_running DESC NULLS LAST;
