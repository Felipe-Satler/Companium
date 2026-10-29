-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium), NÃO o projeto
-- primário do config.toml. Rode este SQL no SQL Editor DESSE projeto (o PAT é read-only, então DDL
-- só passa pelo SQL Editor). IDEMPOTENTE.
--
-- ⚠️ RODAR ANTES DO RESTART DO WORKER, e DEPOIS de 20261027c_brand_kits: o worker novo grava esta
-- tabela ao criar um estático. Sem ela, "Gerar arte" responde 502.
--
-- ----------------------------------------------------------------------------------------------
-- MARKETING › COMPOSER › ESTÁTICO — a arte (post renderizável) de UM anúncio de uma composição SALVA.
--
-- O agente `artagent` destrincha o anúncio pronto nos textos de cada página da arte (no carrossel,
-- uma página por card), com legenda e identificação do médico. O worker grava aqui o "post
-- renderizável" (`post`), que é a entrada do render — regenerar a arte (outro texto, outro
-- template) é refazer o post, sem refazer a composição.
--
-- A marca (cores, fontes, contatos, caminhos do logo) é COPIADA para a linha na criação: trocar a
-- paleta do cliente depois não muda uma arte que já foi entregue.
--
-- Uma linha por pedido: duas artes do mesmo anúncio são coisas diferentes e legítimas. O histórico
-- de versões de uma mesma arte (editar e regenerar) é a próxima etapa, não esta migração.
-- ----------------------------------------------------------------------------------------------

create table if not exists public.marketing_artes (
  id               uuid primary key default gen_random_uuid(),
  -- SET NULL, e não CASCADE: apagar a composição não pode apagar uma arte que já foi postada.
  composition_id   uuid references public.marketing_compositions(id) on delete set null,
  anuncio_indice   integer not null,
  cliente          text not null,
  nome_exibicao    text,
  -- O formato do anúncio de origem (instagram_feed, meta_ads) e um hash da copy dele no momento da
  -- criação: se o anúncio for editado depois, a tela sabe que a arte ficou desatualizada.
  formato_origem   text,
  anuncio_hash     text,
  -- A pré-etapa: { uso, circula_fora, onde_identificar, elementos, fotos: [{ caminho, tipo,
  -- descricao }], template, proporcao }.
  opcoes           jsonb not null default '{}'::jsonb,
  -- A cópia da marca usada nesta arte: { nome_clinica, paleta, fontes, contatos, enderecos, imagens }.
  marca            jsonb not null default '{}'::jsonb,
  -- O post renderizável (`post_renderizavel@1`, shared/post-templates.js). NULL enquanto o agente escreve.
  post             jsonb,
  -- Texto acima do limite, slot vazio, alt ausente, CRM que o agente mudou… [{ slide, campo, tipo, detalhe }]
  avisos           jsonb not null default '[]'::jsonb,
  -- running = o agente está destrinchando (a tela faz polling); pronta | error = terminou.
  status           text not null default 'running',
  error            text,
  agent_id         text,
  criado_por       uuid,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);

alter table public.marketing_artes drop constraint if exists marketing_artes_status_check;
alter table public.marketing_artes
  add constraint marketing_artes_status_check check (status in ('running', 'pronta', 'error'));

comment on table public.marketing_artes is
  'Marketing › Composer › Estático: a arte (post renderizável) de um anúncio de uma composição '
  'salva, destrinchada pelo agente artagent. Escrita pelo worker (service_role).';

alter table public.marketing_artes enable row level security;

drop policy if exists marketing_artes_read on public.marketing_artes;
create policy marketing_artes_read on public.marketing_artes
  for select to authenticated
  using (is_approved(auth.uid()) and (select public.caller_ads_names()) is null);

-- A tela do estático lista "as artes deste anúncio"; a Biblioteca de artes, "deste cliente".
create index if not exists idx_marketing_artes_composition
  on public.marketing_artes (composition_id, anuncio_indice, criado_em desc);
create index if not exists idx_marketing_artes_cliente
  on public.marketing_artes (cliente, criado_em desc);

notify pgrst, 'reload schema';

-- Conferência:
-- SELECT to_regclass('public.marketing_artes');
-- SELECT id, cliente, formato_origem, status, jsonb_array_length(post->'slides') AS slides, criado_em
--   FROM public.marketing_artes ORDER BY criado_em DESC LIMIT 10;
