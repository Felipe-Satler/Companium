-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium), NÃO o projeto
-- primário do config.toml. Rode este SQL no SQL Editor DESSE projeto (o PAT é read-only, então DDL
-- só passa pelo SQL Editor). IDEMPOTENTE.
--
-- ⚠️ RODAR ANTES DO RESTART DO WORKER: o worker novo lê e escreve esta tabela. O frontend aguenta
-- a ausência dela (a aba mostra os clientes sem resumo), mas o worker responderia 502.
--
-- ----------------------------------------------------------------------------------------------
-- MARKETING › CLIENTES — resumo por cliente, escrito por um agente OpenClaw.
--
-- Uma linha por cliente ATIVO, com o resumo que o agente escreveu: contexto comercial, situação
-- das frentes de marketing (do ClickUp) e riscos.
--
-- Chave é `cliente`: o slug canônico (`nome_identificador` / `padrao`), que é o que o resto do app
-- já usa para casar cliente entre planilha, Ads e CRM. Não é uuid de propósito — a lista de ativos
-- vem de `projetos_lista`, que é planilha e não tem id estável.
--
-- A métrica guardada aqui é SEMPRE de semana FECHADA (`semana_de`..`semana_ate`, segunda a
-- domingo): é o que permite regerar o resumo a qualquer momento sem mudar a conclusão, porque
-- semana fechada não se mexe mais. A semana em curso nunca entra. Os números "de agora" não moram
-- aqui — são calculados pelo Companium diariamente e aparecem no card.
-- ----------------------------------------------------------------------------------------------

create table if not exists public.marketing_client_briefs (
  cliente         text primary key,
  nome_exibicao   text,
  -- A prosa como o agente escreveu. É saída de modelo: o frontend sanitiza antes de renderizar.
  brief_md        text,
  -- Bloco estruturado: { contexto, resultados, situacao, riscos: [{ titulo, gravidade, detalhe }] }
  brief           jsonb,
  -- Os números que o agente viu, das duas semanas fechadas. Guardados para o texto poder ser
  -- auditado depois: sem eles, um resumo antigo é indistinguível de um resumo errado.
  metricas        jsonb not null default '{}'::jsonb,
  -- O que ele conseguiu consultar de fato: { clickup: bool, supabase: bool }. O ClickUp depende de
  -- configuração do agente no servidor, fora deste repo — então "não consultou" é estado normal.
  fontes          jsonb not null default '{}'::jsonb,
  -- running = atualização em andamento (a UI faz polling); ok | error = terminou.
  status          text not null default 'ok',
  error           text,
  agent_id        text,
  -- A semana FECHADA que o resumo analisa (segunda..domingo). Fica na tela junto do texto.
  semana_de       date,
  semana_ate      date,
  atualizado_em   timestamptz not null default now(),
  -- NULL = job agendado. Preenchido = alguém clicou "atualizar agora".
  atualizado_por  uuid,
  criado_em       timestamptz not null default now()
);

-- Colunas de versões anteriores deste arquivo, quando o recorte era "últimos 30 dias" em vez de
-- semana fechada. Se você já rodou alguma delas, isto limpa; se não, é no-op.
alter table public.marketing_client_briefs drop column if exists periodo_de;
alter table public.marketing_client_briefs drop column if exists periodo_ate;
-- E estas voltam, para quem rodou a versão que as havia removido.
alter table public.marketing_client_briefs
  add column if not exists metricas jsonb not null default '{}'::jsonb;
alter table public.marketing_client_briefs add column if not exists semana_de date;
alter table public.marketing_client_briefs add column if not exists semana_ate date;

alter table public.marketing_client_briefs
  drop constraint if exists marketing_client_briefs_status_check;
alter table public.marketing_client_briefs
  add constraint marketing_client_briefs_status_check
  check (status in ('running', 'ok', 'error'));

comment on table public.marketing_client_briefs is
  'Marketing › Clientes: resumo por cliente escrito pelo agente OpenClaw (contexto, situação de '
  'marketing e riscos), reescrito semanalmente. As métricas são de SEMANA FECHADA '
  '(semana_de..semana_ate), para o texto poder ser regerado sem mudar de conclusão. Escrita pelo '
  'worker (service_role).';

alter table public.marketing_client_briefs enable row level security;

-- Leitura: equipe interna aprovada. `caller_ads_names()` é NULL para quem não é usuário-cliente —
-- mesma regra de `ad_spy_library`. Escrita não tem policy: passa pelo worker com service_role.
drop policy if exists marketing_client_briefs_read on public.marketing_client_briefs;
create policy marketing_client_briefs_read on public.marketing_client_briefs
  for select to authenticated
  using (is_approved(auth.uid()) and (select public.caller_ads_names()) is null);

create index if not exists idx_marketing_client_briefs_atualizado
  on public.marketing_client_briefs (atualizado_em desc);

notify pgrst, 'reload schema';

-- Conferência:
-- SELECT to_regclass('public.marketing_client_briefs');
-- SELECT cliente, status, semana_de, semana_ate, atualizado_em
--   FROM public.marketing_client_briefs ORDER BY atualizado_em DESC;
