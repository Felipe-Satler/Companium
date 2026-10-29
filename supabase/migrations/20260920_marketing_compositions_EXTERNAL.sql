-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium), NÃO o projeto
-- primário do config.toml. Rode este SQL no SQL Editor DESSE projeto (o PAT é read-only, então DDL
-- só passa pelo SQL Editor). IDEMPOTENTE.
--
-- ⚠️ RODAR ANTES DO RESTART DO WORKER: o worker novo lê e escreve esta tabela. Sem ela,
-- `POST /api/spy/compositions` responde 502 já na primeira gravação.
--
-- ----------------------------------------------------------------------------------------------
-- MARKETING › AD COMPOSER — ideias de anúncio, escritas por um agente OpenClaw.
--
-- Uma linha por composição. O que entra é sempre a mesma tríade: a ANÁLISE da Biblioteca (o que
-- funciona no nicho), o RESUMO do cliente (o que está acontecendo com ele) e as MÉTRICAS da semana
-- fechada. O que sai é ideia de post já no formato de destino, campo a campo.
--
-- Não é upsert como os resumos: cada pedido é uma linha nova. Duas composições do mesmo cliente
-- com o mesmo formato são coisas diferentes e legítimas — é assim que se compara ideia com ideia,
-- e é por isso que a tela tem histórico.
--
-- A métrica guardada é SEMPRE de semana FECHADA, pelo mesmo motivo dos resumos: guardada junto do
-- texto, a composição continua auditável meses depois. Sem ela, uma ideia antiga é indistinguível
-- de uma ideia errada.
-- ----------------------------------------------------------------------------------------------

create table if not exists public.marketing_compositions (
  id               uuid primary key default gen_random_uuid(),
  -- O `padrao` do cliente, a MESMA chave dos resumos. Não é FK de propósito: a lista de ativos vem
  -- de `projetos_lista`, que é planilha e não tem id estável.
  cliente          text not null,
  nome_exibicao    text,
  -- ANULÁVEL nos dois sentidos: dá para compor sem análise nenhuma, e apagar a análise depois não
  -- pode apagar a composição que ela gerou.
  library_entry_id uuid references public.ad_spy_library(id) on delete set null,
  -- O título da análise no momento em que ela alimentou esta composição. Existe porque o FK acima
  -- vira NULL quando a análise é apagada: sem esta cópia, o histórico perderia a origem em
  -- silêncio e ninguém saberia mais de onde a ideia veio.
  analise_titulo   text,
  -- Id de `shared/ad-formats.js` (instagram_reels, google_ads, …). Sem CHECK de propósito: a lista
  -- de formatos mora no código e cresce sem migração; quem valida é o worker, contra a MESMA spec
  -- que a tela usa para desenhar o seletor.
  formato          text not null,
  extra_prompt     text,
  -- A prosa como o agente escreveu. É saída de modelo: o frontend sanitiza antes de renderizar.
  composicao_md    text,
  -- As ideias por CAMPO do formato: { gancho: "...", headlines: ["...", "..."] }. É o que a tela
  -- renderiza com botão de copiar em cada campo — colar bloco inteiro no Ads Manager não serve.
  composicao       jsonb,
  -- O que estourou limite, por campo: [{ campo, indice, tipo, detalhe }]. O agente erra contagem de
  -- caractere de vez em quando; a tela dizendo "34/30" é honesta, silenciar seria pior.
  avisos           jsonb not null default '[]'::jsonb,
  -- O que de fato alimentou: { analise: bool, brief: bool, metricas: bool }. Compor sem resumo ou
  -- sem métrica é estado normal, não erro — mas quem lê a ideia precisa saber com o que ela foi
  -- feita antes de confiar nela.
  fontes           jsonb not null default '{}'::jsonb,
  -- Os números que o agente viu, da semana fechada abaixo.
  metricas         jsonb not null default '{}'::jsonb,
  semana_de        date,
  semana_ate       date,
  -- running = composição em andamento (a UI faz polling); ok | error = terminou.
  status           text not null default 'running',
  error            text,
  agent_id         text,
  criado_por       uuid,
  criado_em        timestamptz not null default now(),
  -- Quando a linha parou de mudar. A composição nasce `running` e é fechada pelo worker minutos
  -- depois; sem isto a tela não teria como dizer quando a ideia ficou pronta.
  atualizado_em    timestamptz not null default now()
);

-- Colunas adicionadas depois da primeira versão deste arquivo, para quem já rodou alguma delas.
alter table public.marketing_compositions add column if not exists analise_titulo text;
alter table public.marketing_compositions
  add column if not exists avisos jsonb not null default '[]'::jsonb;
alter table public.marketing_compositions
  add column if not exists atualizado_em timestamptz not null default now();

alter table public.marketing_compositions
  drop constraint if exists marketing_compositions_status_check;
alter table public.marketing_compositions
  add constraint marketing_compositions_status_check
  check (status in ('running', 'ok', 'error'));

comment on table public.marketing_compositions is
  'Marketing › Ad Composer: ideias de anúncio escritas pelo agente OpenClaw a partir de uma '
  'análise da Biblioteca + o resumo do cliente + as métricas da semana fechada, no formato de '
  'destino escolhido (Reels, Stories, Feed, Meta Ads, Google Ads). Uma linha por composição, com '
  'histórico. Escrita pelo worker (service_role).';

alter table public.marketing_compositions enable row level security;

-- Leitura: equipe interna aprovada. `caller_ads_names()` é NULL para quem não é usuário-cliente —
-- mesma regra de `ad_spy_library` e `marketing_client_briefs`. Escrita não tem policy: passa pelo
-- worker com service_role, que também impõe "só quem criou ou admin apaga".
drop policy if exists marketing_compositions_read on public.marketing_compositions;
create policy marketing_compositions_read on public.marketing_compositions
  for select to authenticated
  using (is_approved(auth.uid()) and (select public.caller_ads_names()) is null);

-- O histórico da tela é sempre "deste cliente, mais recente primeiro".
create index if not exists idx_marketing_compositions_cliente
  on public.marketing_compositions (cliente, criado_em desc);

notify pgrst, 'reload schema';

-- Conferência:
-- SELECT to_regclass('public.marketing_compositions');
-- SELECT id, cliente, formato, status, jsonb_array_length(avisos) AS avisos, criado_em
--   FROM public.marketing_compositions ORDER BY criado_em DESC LIMIT 10;
