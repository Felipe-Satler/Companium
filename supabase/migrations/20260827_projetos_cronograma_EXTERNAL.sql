-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium). Rode no SQL
-- Editor desse projeto. Aplicar ANTES de subir o frontend novo (o PAT é read-only:
-- DDL via MCP dá 403, então este script precisa ser rodado manualmente).
--
-- SEÇÃO PROJETOS › CRONOGRAMA (/projetos/cronograma):
--   Gantt por cliente — linhas = "marcos", colunas = "meses". Cada card ocupa um
--   intervalo de colunas e tem um par "Real". Tudo preenchido MANUALMENTE na tela.
--
--   3 tabelas (o front salva por "replace": apaga tudo do cliente e reinsere):
--     projetos_cronograma_meses   — colunas (meses) por cliente
--     projetos_cronograma_marcos  — linhas (marcos) por cliente
--     projetos_cronograma_cards   — os cards/checkpoints (a "tabela do cronograma")
--
--   Chave lógica = `cliente` (texto = nome_identificador da v_clientes_lookup, ou um
--   nome avulso digitado em "Salvar cliente"). `marco_ordem` liga um card à sua linha.
--
--   Colunas de projetos_cronograma_cards (preenchidas ao montar o cronograma):
--     cliente          — dono do cronograma
--     marco_ordem      — índice da linha (marco) a que o card pertence
--     ordem            — ordem do card dentro da linha
--     tipo             — 'card' | 'checkpoint'
--     kind             — 'plan' (planejado) | 'real' (executado)
--     titulo           — título do card
--     status           — status do planejado: 'concluido' | 'andamento' | 'planejado'
--     real_status      — status do card Real: para_fazer|em_andamento|descartado|paralisado|finalizado
--     mes_inicio       — coluna inicial (float; 1 coluna = 30 dias)
--     mes_fim          — coluna final inclusiva (float)
--     duracao_dias     — duração do card em dias
--     descricao        — descrição/comentários (tooltip)
--     pair_id          — liga o card planejado ao seu par Real
--     checkpoint_pos   — posição do checkpoint (float) [tipo='checkpoint']
--     checkpoint_lane  — faixa do checkpoint: 'plan' | 'real'  [tipo='checkpoint']
--
--   LEITURA/ESCRITA abertas a todo authenticated (é uma ferramenta interna de
--   planejamento; a seção Projetos nem aparece p/ usuário-cliente). Sem dados de um
--   cliente → cronograma em branco.

-- ---------------------------------------------------------------------------
create table if not exists public.projetos_cronograma_meses (
  id            uuid primary key default gen_random_uuid(),
  cliente       text    not null,
  ordem         integer not null default 0,
  nome          text    not null default '',
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_proj_crono_meses_cliente
  on public.projetos_cronograma_meses (cliente, ordem);

create table if not exists public.projetos_cronograma_marcos (
  id            uuid primary key default gen_random_uuid(),
  cliente       text    not null,
  ordem         integer not null default 0,
  nome          text    not null default '',
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_proj_crono_marcos_cliente
  on public.projetos_cronograma_marcos (cliente, ordem);

create table if not exists public.projetos_cronograma_cards (
  id              uuid primary key default gen_random_uuid(),
  cliente         text    not null,
  marco_ordem     integer not null default 0,
  ordem           integer not null default 0,
  tipo            text    not null default 'card',   -- 'card' | 'checkpoint'
  kind            text    not null default 'plan',   -- 'plan' | 'real'
  titulo          text    not null default '',
  status          text,                              -- planejado: concluido|andamento|planejado
  real_status     text,                              -- real: para_fazer|em_andamento|descartado|paralisado|finalizado
  mes_inicio      numeric not null default 0,
  mes_fim         numeric not null default 1,
  duracao_dias    integer,
  descricao       text,
  pair_id         text,
  checkpoint_pos  numeric,
  checkpoint_lane text,                              -- 'plan' | 'real'
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  constraint projetos_cronograma_cards_tipo_chk  check (tipo in ('card','checkpoint')),
  constraint projetos_cronograma_cards_kind_chk  check (kind in ('plan','real'))
);
create index if not exists idx_proj_crono_cards_cliente
  on public.projetos_cronograma_cards (cliente, marco_ordem, ordem);

-- ---- RLS: leitura + escrita p/ todo authenticated -------------------------
alter table public.projetos_cronograma_meses  enable row level security;
alter table public.projetos_cronograma_marcos enable row level security;
alter table public.projetos_cronograma_cards  enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'projetos_cronograma_meses',
    'projetos_cronograma_marcos',
    'projetos_cronograma_cards'
  ] loop
    execute format('drop policy if exists "%s_read"   on public.%I', t, t);
    execute format('drop policy if exists "%s_insert" on public.%I', t, t);
    execute format('drop policy if exists "%s_update" on public.%I', t, t);
    execute format('drop policy if exists "%s_delete" on public.%I', t, t);
    execute format('create policy "%s_read"   on public.%I for select to authenticated using (true)', t, t);
    execute format('create policy "%s_insert" on public.%I for insert to authenticated with check (true)', t, t);
    execute format('create policy "%s_update" on public.%I for update to authenticated using (true) with check (true)', t, t);
    execute format('create policy "%s_delete" on public.%I for delete to authenticated using (true)', t, t);
  end loop;
end $$;

notify pgrst, 'reload schema';
