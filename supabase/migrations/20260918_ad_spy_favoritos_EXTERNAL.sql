-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium), NÃO o projeto
-- primário do config.toml. Rode este SQL no SQL Editor DESSE projeto (o PAT é read-only, então DDL
-- só passa pelo SQL Editor). IDEMPOTENTE.
--
-- ⚠️ RODAR ANTES DO RESTART DO WORKER: o worker novo lê e escreve esta tabela. O frontend aguenta
-- a ausência dela (a estrela some), mas o worker antigo não conhece as rotas novas.
--
-- ----------------------------------------------------------------------------------------------
-- BIBLIOTECA DE ANÁLISES — favoritos POR USUÁRIO.
--
-- A Biblioteca é da equipe: todo mundo enxerga todas as análises. O favorito, não — é de cada um,
-- e serve para filtrar ("só os meus favoritos"). Por isso a chave é (entry_id, user_id) e não uma
-- coluna booleana em `ad_spy_library`: uma coluna lá seria compartilhada, e a estrela de uma pessoa
-- apareceria para todas as outras.
-- ----------------------------------------------------------------------------------------------

create table if not exists public.ad_spy_library_favoritos (
  entry_id   uuid not null references public.ad_spy_library(id) on delete cascade,
  user_id    uuid not null,
  criado_em  timestamptz not null default now(),
  -- Favoritar duas vezes é a mesma coisa que favoritar uma: a PK torna o upsert idempotente.
  primary key (entry_id, user_id)
);

comment on table public.ad_spy_library_favoritos is
  'Favoritos por usuário na Biblioteca de Análises da Mineração. A Biblioteca é comum à equipe; '
  'a estrela é de cada um. Escrita pelo worker (service_role).';

alter table public.ad_spy_library_favoritos enable row level security;

-- Leitura: só os próprios favoritos, e só equipe interna aprovada (`caller_ads_names()` é NULL
-- para quem não é usuário-cliente, mesma regra das outras tabelas). Escrita não tem policy: passa
-- pelo worker com service_role, que já confere o usuário.
drop policy if exists ad_spy_library_favoritos_read on public.ad_spy_library_favoritos;
create policy ad_spy_library_favoritos_read on public.ad_spy_library_favoritos
  for select to authenticated
  using (
    user_id = auth.uid()
    and is_approved(auth.uid())
    and (select public.caller_ads_names()) is null
  );

-- A listagem sempre pergunta "quais desta pessoa", nunca "quem favoritou isto".
create index if not exists idx_ad_spy_library_favoritos_user
  on public.ad_spy_library_favoritos (user_id, criado_em desc);

notify pgrst, 'reload schema';

-- Conferência:
-- SELECT to_regclass('public.ad_spy_library_favoritos');
-- SELECT entry_id, user_id, criado_em FROM public.ad_spy_library_favoritos ORDER BY criado_em DESC;
