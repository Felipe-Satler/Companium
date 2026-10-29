-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium). Rode no SQL Editor
-- desse projeto. Aplicar ANTES de subir o frontend novo.
--
-- QUEM APARECE NOS FILTROS DE CLIENTE (CRM, Meta Ads, Google Ads, Relatório, Performance,
-- Metas):
--   Passa a ser a planilha `projetos_lista` (só quem está ATIVO). O que era uma lista
--   HARDCODED no front (EXCLUDED_CLIENT_MATCHES em src/data/clienteAliases.ts, mantida na
--   mão a cada mudança de carteira) vira esta tabela, editável na tela de Administração.
--
--   As duas fontes se somam: a planilha decide quem ENTRA; esta tabela pode TIRAR alguém
--   mesmo que a planilha diga ATIVO (conta de teste, cliente mal arquivado, nome duplicado).
--   Nada aqui é obrigatório — tabela vazia = só a planilha manda.
--
-- DEPENDE de 20260901_projetos_lista_rls (a policy de leitura de projetos_lista). Sem ela o
-- front não enxerga a planilha e continua no comportamento antigo.

create table if not exists public.clientes_ocultos (
  id           bigint generated always as identity primary key,
  -- Token do nome, no mesmo formato do antigo EXCLUDED_CLIENT_MATCHES: minúsculo, sem
  -- acento, palavras separadas por "_" (ex.: "teo_de_oliveira"). O front casa isso como
  -- TOKEN INTEIRO (delimitado por início/fim ou "_"), nunca pedaço no meio de palavra —
  -- por isso "icv" pega "Clínica ICV" mas não "Medicva".
  padrao       text not null,
  -- null = escondido em TODAS as telas. 'google' = escondido só no Google Ads (era o
  -- GOOGLE_HIDDEN_CLIENT_MATCHES). Outros canais: 'meta', 'crm', 'overview'.
  canal        text,
  -- true = o nome canônico inteiro precisa ser IGUAL ao padrão (era EXCLUDED_CLIENT_EXACT).
  -- Use quando o nome a remover é PREFIXO de outro que deve permanecer.
  exato        boolean not null default false,
  motivo       text,
  criado_por   uuid,
  criado_em    timestamptz not null default now(),
  constraint clientes_ocultos_padrao_canal_key unique (padrao, canal)
);

comment on table public.clientes_ocultos is
  'Clientes escondidos dos filtros do dashboard, além do que a planilha projetos_lista já define por status. Editável em Administração.';

alter table public.clientes_ocultos enable row level security;

-- Leitura: qualquer usuário logado (todo mundo precisa p/ montar os filtros).
drop policy if exists "clientes_ocultos_read" on public.clientes_ocultos;
create policy "clientes_ocultos_read"
  on public.clientes_ocultos for select to authenticated using (true);

-- Escrita: SÓ admin. É uma trava que muda o que todo mundo vê — não pode ficar na mão de
-- qualquer usuário logado.
drop policy if exists "clientes_ocultos_insert" on public.clientes_ocultos;
create policy "clientes_ocultos_insert"
  on public.clientes_ocultos for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "clientes_ocultos_update" on public.clientes_ocultos;
create policy "clientes_ocultos_update"
  on public.clientes_ocultos for update to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "clientes_ocultos_delete" on public.clientes_ocultos;
create policy "clientes_ocultos_delete"
  on public.clientes_ocultos for delete to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- Semente: SÓ o que NÃO é "cliente inativo".
--
-- A lista antiga do front tinha 29 nomes; 26 deles estavam ali porque o cliente estava
-- encerrado/fora da carteira — isso agora é a planilha que resolve (status != ATIVO), então
-- semeá-los aqui criaria 26 travas redundantes que alguém teria de limpar na mão depois.
--
-- Sobram os 3 que NÃO são caso de inatividade: clientes ATIVOS que devem sumir apenas da tela
-- de Google Ads. Isso a planilha não expressa, então continua sendo trava manual.
insert into public.clientes_ocultos (padrao, canal, motivo)
values
  ('alan_sampaio',  'google', 'cliente ativo, escondido só no Google Ads'),
  ('luiz_cardoso', 'google', 'cliente ativo, escondido só no Google Ads'),
  ('douglas_brito',  'google', 'cliente ativo, escondido só no Google Ads')
on conflict (padrao, canal) do nothing;

notify pgrst, 'reload schema';
