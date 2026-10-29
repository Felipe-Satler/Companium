-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium), NÃO o projeto
-- primário do config.toml. Rode este SQL no SQL Editor DESSE projeto (o PAT é read-only, então DDL
-- só passa pelo SQL Editor). IDEMPOTENTE.
--
-- ⚠️ RODAR ANTES DO RESTART DO WORKER, e DEPOIS de `20261012b_composer_varios_anuncios`: o
-- orquestrador termina numa composição, que já grava as colunas daquela migração.
--
-- ----------------------------------------------------------------------------------------------
-- MARKETING › COMPOSER › ORQUESTRADOR — uma composição conduzida do começo ao fim.
--
-- Uma linha por orquestração. Ela guarda o PERCURSO, não o resultado: os anúncios vivem em
-- `marketing_compositions` e a análise em `ad_spy_library`, como os de qualquer pessoa. O que só
-- existe aqui é o que o orquestrador decidiu e por quê — os números que leu, o diagnóstico, a
-- análise que escolheu (ou mandou fazer), os relatórios e documentos, e o que perguntou a cada bot.
--
-- Sem isso o piloto automático seria uma caixa preta: daria para aceitar os anúncios, não para
-- discordar da abordagem.
-- ----------------------------------------------------------------------------------------------

create table if not exists public.marketing_orquestracoes (
  id               uuid primary key default gen_random_uuid(),
  -- O `padrao` do cliente, a MESMA chave de `marketing_compositions`. Não é FK pelo mesmo motivo.
  cliente          text not null,
  nome_exibicao    text,
  -- Direção opcional de quem disparou. NULL = "decida tudo".
  pedido           text,
  -- running = em andamento (a UI faz polling); ok | error = terminou.
  status           text not null default 'running',
  error            text,
  -- As cinco etapas, na ordem: [{ key, label, status, note, started_at, ended_at }], com `status`
  -- em pending | running | done | skipped | error. Semeadas no insert, para a tela desenhar o
  -- caminho inteiro desde o começo. Uma etapa em `error` não significa orquestração em erro: a
  -- mineração pode falhar e a composição sair assim mesmo, sem análise.
  etapas           jsonb not null default '[]'::jsonb,
  -- A prosa do orquestrador: o que os números mostram e por que essa abordagem. É saída de modelo:
  -- o frontend sanitiza antes de renderizar.
  diagnostico_md   text,
  -- O plano: { abordagem, contexto_operacional, analise: { id, titulo, motivo, nova },
  -- mineracao: { nicho, contexto, pergunta, foco, termo, pecas } | null,
  -- relatorios: [{ id, titulo, motivo }], documentos: [{ id, titulo, local, motivo }],
  -- pedido_ao_composer }. Os títulos são gravados junto pelo motivo de sempre: relatório apagado
  -- não pode apagar a razão de ele ter sido escolhido.
  decisoes         jsonb not null default '{}'::jsonb,
  -- O que foi perguntado a cada bot: [{ para, assunto, pergunta, resposta, erro, em }]. Pergunta e
  -- resposta vão cortadas — é registro para conferir, não cópia do prompt.
  perguntas        jsonb not null default '[]'::jsonb,
  -- Os números que o orquestrador viu: { atual, anterior }, das semanas FECHADAS abaixo. Vazio
  -- quando o cliente não aparece no CRM nem nos anúncios, ou a leitura falhou.
  metricas         jsonb not null default '{}'::jsonb,
  semana_de        date,
  semana_ate       date,
  -- O que nasceu (ou foi usado) nesta orquestração. `on delete set null` nos três: apagar a
  -- mineração, a análise ou a composição não pode apagar o registro de como se chegou nelas.
  run_id           uuid references public.ad_spy_runs(id) on delete set null,
  library_entry_id uuid references public.ad_spy_library(id) on delete set null,
  composition_id   uuid references public.marketing_compositions(id) on delete set null,
  agent_id         text,
  criado_por       uuid,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);

alter table public.marketing_orquestracoes
  drop constraint if exists marketing_orquestracoes_status_check;
alter table public.marketing_orquestracoes
  add constraint marketing_orquestracoes_status_check
  check (status in ('running', 'ok', 'error'));

comment on table public.marketing_orquestracoes is
  'Marketing › Composer › Orquestrador: o percurso de uma composição conduzida por agente do '
  'começo ao fim — números, diagnóstico, análise escolhida ou minerada, insumos, perguntas feitas '
  'aos outros bots. O resultado vive em marketing_compositions. Escrita pelo worker (service_role).';

alter table public.marketing_orquestracoes enable row level security;

-- Leitura: equipe interna aprovada, a mesma regra de `marketing_compositions`. Escrita não tem
-- policy: passa pelo worker com service_role, que também impõe "só quem disparou ou admin apaga".
drop policy if exists marketing_orquestracoes_read on public.marketing_orquestracoes;
create policy marketing_orquestracoes_read on public.marketing_orquestracoes
  for select to authenticated
  using (is_approved(auth.uid()) and (select public.caller_ads_names()) is null);

create index if not exists idx_marketing_orquestracoes_cliente
  on public.marketing_orquestracoes (cliente, criado_em desc);

notify pgrst, 'reload schema';

-- Conferência:
-- SELECT to_regclass('public.marketing_orquestracoes');
-- SELECT id, cliente, status, composition_id, library_entry_id, criado_em
--   FROM public.marketing_orquestracoes ORDER BY criado_em DESC LIMIT 10;
