-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium), NÃO o projeto
-- primário do config.toml. Rode este SQL no SQL Editor DESSE projeto (o PAT é read-only, então DDL
-- só passa pelo SQL Editor). IDEMPOTENTE.
--
-- ⚠️ RODAR ANTES DO RESTART DO WORKER: o worker novo lê e escreve esta tabela. Sem ela,
-- `POST /api/spy/relatorios` responde 502 já na primeira gravação. É aditiva e inofensiva enquanto
-- ninguém a lê, então pode rodar com antecedência.
--
-- ----------------------------------------------------------------------------------------------
-- MARKETING › CLIENTES — RELATÓRIO: diagnóstico de um período, escrito por um agente OpenClaw.
--
-- Uma linha por relatório pedido, com histórico: o valor da ferramenta é comparar, e a segunda
-- leitura de um cliente só serve ao lado da primeira. Não é upsert por cliente como o Contexto
-- Operacional.
--
-- O texto tem quatro blocos (leitura crítica, prioridade única, causa/correlação, ação) e UMA
-- prioridade tipada: gargalo | investigacao | oportunidade.
--
-- ## Por que os números vêm da TELA e ficam gravados aqui
--
-- O frontend é quem sabe reproduzir o que o dashboard mostra: metas mensais pró-rateadas
-- (`resolveMeta`), a base de faturamento de cada cliente e as correções manuais de
-- `crm_metric_overrides`. O worker não lê nada disso — não tem leitor de `clientes_meta`, e o
-- agregador dele não produz 4 dos 9 campos de meta. Um relatório que contradiz o dashboard não vale
-- nada, então quem manda o número é quem o exibe, e `snapshot` guarda esse número VERBATIM. Sem o
-- snapshot, um relatório antigo é indistinguível de um relatório errado.
--
-- `origem_numeros` existe para o dia em que o worker passar a calcular sozinho: as duas gerações
-- ficam distinguíveis na mesma tabela, em vez de silenciosamente misturadas.
-- ----------------------------------------------------------------------------------------------

create table if not exists public.marketing_client_reports (
  id                uuid primary key default gen_random_uuid(),
  -- O `padrao` do cliente, a MESMA chave do Contexto Operacional. Não é FK de propósito: a lista de
  -- ativos vem de `projetos_lista`, que é planilha e não tem id estável.
  cliente           text not null,
  nome_exibicao     text,

  -- O período ANALISADO. Colunas reais, não só dentro do snapshot: é por elas que se acha "o
  -- relatório de agosto deste cliente" sem abrir o jsonb.
  periodo_de        date not null,
  periodo_ate       date not null,
  -- `month` | `mtd` | `range`, de `periodSignature` (src/utils/crmOverrides.ts). `mtd` é o caso em
  -- que o período termina HOJE — ou seja, dado possivelmente parcial.
  periodo_kind      text,
  periodo_label     text,

  -- O período COMPARÁVEL, e a regra que o escolheu. A regra fica gravada porque ela muda a
  -- conclusão: comparar 9 dias com um mês inteiro não é a mesma análise que comparar 9 com 9.
  comparacao_de     date,
  comparacao_ate    date,
  comparacao_regra  text,
  comparacao_motivo text,

  -- Instrução livre de quem pediu ("olhar a campanha de novembro").
  observacao        text,

  -- A prosa como o agente escreveu. É saída de modelo: o frontend sanitiza antes de renderizar.
  relatorio_md      text,
  -- Os quatro blocos:
  --   { leitura, problema: {prioridade, texto, impacto},
  --     causa: {texto, tipo: causa|correlacao|hipotese, verificar},
  --     acao: {texto, responsavel, prazo},
  --     limitacoes: [texto] }
  -- `causa.tipo` é tipado pelo mesmo motivo da prioridade: "separar causa comprovada de correlação e
  -- de hipótese" é inverificável se vive só dentro da prosa.
  relatorio         jsonb,
  -- DESNORMALIZADO de `relatorio->problema->>prioridade`, para a lista do histórico pintar o chip e
  -- filtrar sem cavar o jsonb. Anulável: uma resposta degradada (só prosa) não pode perder o
  -- relatório, e chutar entre gargalo e oportunidade seria inventar o diagnóstico.
  prioridade        text,

  -- Avisos de MÁQUINA (dado parcial, override no período, meta ausente), promovidos do snapshot para
  -- a tela poder destacá-los sem depender da prosa. As limitações que o AGENTE declarou moram em
  -- `relatorio->limitacoes` — autores diferentes, campos diferentes.
  avisos            jsonb not null default '[]'::jsonb,
  fontes            jsonb not null default '{}'::jsonb,

  -- O snapshot da tela, VERBATIM. É a auditoria do texto.
  snapshot          jsonb not null default '{}'::jsonb,
  snapshot_versao   integer,
  origem_numeros    text not null default 'frontend',

  -- running = o agente está escrevendo (a UI faz polling); ok | error = terminou.
  status            text not null default 'running',
  error             text,
  agent_id          text,

  criado_por        uuid,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);

-- Colunas acrescentadas depois da primeira versão deste arquivo, para quem já rodou alguma delas.
alter table public.marketing_client_reports add column if not exists comparacao_motivo text;
alter table public.marketing_client_reports add column if not exists observacao text;
alter table public.marketing_client_reports add column if not exists snapshot_versao integer;
alter table public.marketing_client_reports
  add column if not exists origem_numeros text not null default 'frontend';

alter table public.marketing_client_reports
  drop constraint if exists marketing_client_reports_status_check;
alter table public.marketing_client_reports
  add constraint marketing_client_reports_status_check
  check (status in ('running', 'ok', 'error'));

-- Text + check, não um `create type` enum: é a convenção das outras três tabelas, e um arquivo que
-- precisa ser rerrodável no SQL Editor não convive bem com `create type`. Acrescentar uma quarta
-- prioridade depois é drop/add de constraint, duas linhas.
alter table public.marketing_client_reports
  drop constraint if exists marketing_client_reports_prioridade_check;
alter table public.marketing_client_reports
  add constraint marketing_client_reports_prioridade_check
  check (prioridade is null or prioridade in ('gargalo', 'investigacao', 'oportunidade'));

alter table public.marketing_client_reports
  drop constraint if exists marketing_client_reports_periodo_check;
alter table public.marketing_client_reports
  add constraint marketing_client_reports_periodo_check
  check (periodo_ate >= periodo_de);

comment on table public.marketing_client_reports is
  'Marketing › Clientes (Relatório): diagnóstico de um período escolhido, escrito pelo agente '
  'OpenClaw em quatro blocos com UMA prioridade (gargalo|investigacao|oportunidade). Os números '
  'vêm da TELA e ficam em `snapshot` verbatim, para o relatório nunca contradizer o dashboard e '
  'continuar auditável. Uma linha por pedido, com histórico. Escrita pelo worker (service_role).';

alter table public.marketing_client_reports enable row level security;

-- Leitura: equipe interna aprovada. `caller_ads_names()` é NULL para quem não é usuário-cliente —
-- mesma regra de `ad_spy_library`, `marketing_client_briefs` e `marketing_compositions`. Escrita não
-- tem policy: passa pelo worker com service_role, que também impõe "só quem criou ou admin apaga".
drop policy if exists marketing_client_reports_read on public.marketing_client_reports;
create policy marketing_client_reports_read on public.marketing_client_reports
  for select to authenticated
  using (is_approved(auth.uid()) and (select public.caller_ads_names()) is null);

-- O histórico da tela é sempre "deste cliente, mais recente primeiro".
create index if not exists idx_marketing_client_reports_cliente
  on public.marketing_client_reports (cliente, criado_em desc);

notify pgrst, 'reload schema';

-- Conferência:
-- SELECT to_regclass('public.marketing_client_reports');
-- SELECT id, cliente, periodo_label, prioridade, status, criado_em
--   FROM public.marketing_client_reports ORDER BY criado_em DESC LIMIT 10;
