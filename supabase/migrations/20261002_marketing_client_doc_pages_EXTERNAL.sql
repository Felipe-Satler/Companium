-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium), NÃO o projeto primário do
-- config.toml. Rode este SQL no SQL Editor DESSE projeto (o PAT é read-only, então DDL só passa
-- pelo SQL Editor). IDEMPOTENTE.
--
-- ⚠️ RODAR ANTES DO RESTART DO WORKER. O worker novo escreve e lê `marketing_client_doc_pages`, e a
-- aba Documentos passa a servir DELA. Sem a migração a aba responde vazio.
--
-- ----------------------------------------------------------------------------------------------
-- A UNIDADE DE ATRIBUIÇÃO PASSA A SER A PÁGINA, NÃO O DOC.
--
-- ## O que a investigação do workspace 9013219864 mostrou (02/10/2026)
--
-- O desenho anterior supunha "um Doc = um documento de um cliente". O workspace não é assim. O
-- padrão dominante é **página dentro de Doc coletivo**:
--
--   groohub › Mapeamento do Cliente › Ativo › Mapeamento - Dra. Amanda Duarte
--   (doc 8cknmgr-18393, página 8cknmgr-302713)
--
-- O Doc "Mapeamento do Cliente" tem 66 páginas de clientes sob a página "Ativo" e 94 sob "Inativo".
-- "Briefing de Conteúdo" segue a mesma forma, com uma página "Groohub" de material interno. "Ativo"
-- e "Inativo" são PÁGINAS, não pastas — a hierarquia vive dentro do Doc, não acima dele.
--
-- Duas premissas do desenho anterior caíram com isso:
--
-- 1. **"Cada cliente é uma tarefa."** A tarefa-pai 86a43dceu chama-se "Mapeamento Estratégico" e
--    não nomeia cliente nenhum; quem nomeava era o título do Doc. A tarefa continua sendo um sinal,
--    mas deixa de ser O sinal.
-- 2. **"Doc com vários clientes é empate, logo não atribui."** Doc coletivo com dezenas de páginas
--    de clientes diferentes é o caso NORMAL. A regra de empate recusava exatamente o caso mais
--    comum do workspace, e é por isso que 117 documentos sincronizados rendiam quase nenhuma
--    atribuição.
--
-- ## Por que isto é também um conserto de VAZAMENTO, e não só de cobertura
--
-- `marketing_client_docs.conteudo_md` guardava as páginas do Doc CONCATENADAS. Para "Mapeamento do
-- Cliente" isso é um texto único com 66 clientes dentro. Enquanto o Doc estava sem cliente
-- atribuído nada acontecia — mas "consertar a atribuição no nível do Doc" era precisamente o que
-- faria aquele texto virar insumo do Ad Composer de UM cliente, levando a estratégia dos outros 65
-- ao prompt de um modelo. Guardar conteúdo por página conserta a cobertura e fecha esse caminho de
-- uma vez: não existe mais um campo onde o conteúdo de dois clientes conviva.
--
-- Por isso esta migração **apaga** `conteudo_md` de `marketing_client_docs` no fim. O texto é
-- recuperável do ClickUp (o próximo sync rebaixa por página) e deixá-lo parado seria manter o
-- material misturado em repouso à espera de alguém que leia a coluna de novo.
-- ----------------------------------------------------------------------------------------------

create table if not exists public.marketing_client_doc_pages (
  -- O id da PÁGINA no ClickUp. É a identidade da linha e a chave que a tela e o Ad Composer
  -- carregam: o que se escolhe como insumo é uma página.
  --
  -- Exceção: quando a enumeração de páginas de um Doc falha, o sync grava UMA linha sintética com
  -- `page_id = 'doc:<doc_id>'` representando o Doc inteiro (ver docs-sync.js). O prefixo existe para
  -- essa linha nunca colidir com o id de uma página de verdade e para ser reconhecível no log.
  page_id            text primary key,

  -- O Doc que contém a página. `on delete cascade` é o que faz a varredura de Docs apagados levar
  -- as páginas embora sem uma segunda consulta.
  doc_id             text not null references public.marketing_client_docs(doc_id) on delete cascade,

  -- A página-mãe DENTRO do Doc, quando há. NULO = página de primeiro nível.
  pagina_pai_id      text,

  -- Título da página ("Mapeamento - Dra. Amanda Duarte").
  nome               text not null,

  -- Os títulos das páginas ANCESTRAIS dentro do Doc, do mais externo ao mais interno: ['Ativo'].
  -- Não inclui o nome do Doc (que está em `marketing_client_docs.nome`) nem o da própria página.
  -- É o que permite a tela mostrar "Mapeamento do Cliente › Ativo" e é também um sinal de
  -- atribuição: a página "Dra. Amanda Duarte" com subpáginas passa o cliente para elas.
  caminho            text[] not null default '{}',

  -- O `padrao` do cliente, a MESMA chave do Contexto Operacional e do Relatório. NULO é comum e
  -- correto: página-contêiner ("Ativo", "Inativo"), material interno ("Groohub"), template.
  cliente            text,
  -- Como a atribuição foi feita, do mais forte para o mais fraco:
  --   'pagina'      o título da própria página nomeia o cliente  (o sinal forte, e o caso comum)
  --   'pagina_pai'  uma página ancestral o nomeia                (herdado dentro do Doc)
  --   'tarefa'      o Doc inteiro é do cliente pela tarefa-pai
  --   'pasta'       o Doc inteiro é do cliente pelo espaço/pasta/lista
  --   'nome'        o Doc inteiro é do cliente só pelo título     (indício)
  -- A tela mostra a diferença em vez de apresentar tudo como a mesma certeza.
  atribuido_via      text,

  -- O tipo da allowlist (`shared/clickup-doc-tipos.js`), herdado do Doc. NULO = conteúdo NÃO lido,
  -- de propósito (ver o cabeçalho daquele arquivo e o documento chamado "Acessos").
  tipo               text,
  -- O markdown DESTA página, sozinho. Nunca concatenado com o de outra.
  conteudo_md        text,
  conteudo_chars     integer,
  conteudo_lido_em   timestamptz,

  -- A posição desta página na árvore do Doc, na ordem em que a enumeração a encontrou. Guardada
  -- porque um documento tem ordem de leitura: "Persona" antes de "Oferta" não é detalhe estético
  -- quando o texto vai inteiro para o prompt de um modelo. Sem a coluna, a aba e o Composer
  -- ordenariam por id, que é aleatório.
  ordem              integer not null default 0,

  -- A data de edição do Doc no ClickUp (a listagem de páginas não traz uma por página). Serve à
  -- ordenação da aba e ao incremental.
  atualizado_em_clickup timestamptz,

  -- Quando o sync viu esta linha. Linha com data anterior ao início da execução é página que saiu
  -- do Doc; a varredura a remove, sob a mesma guarda de confiabilidade da varredura de Docs.
  sincronizado_em    timestamptz not null default now()
);

comment on table public.marketing_client_doc_pages is
  'Marketing › Central de Clientes (Documentos): uma linha por PÁGINA de Doc do ClickUp. A unidade '
  'de atribuição é a página porque no workspace da Groohub o documento de um cliente é uma página '
  'dentro de um Doc coletivo ("Mapeamento do Cliente" tem 66 páginas de clientes). Guardar o '
  'conteúdo por página também elimina o campo onde o texto de 66 clientes convivia — que viraria '
  'insumo do Composer de um só deles se a atribuição fosse consertada no nível do Doc.';

comment on column public.marketing_client_doc_pages.conteudo_md is
  'Markdown DESTA página, nunca concatenado com o de outra. NULO quando `tipo` é nulo: tipo fora '
  'da allowlist não tem conteúdo lido, para credencial de cliente não atravessar para este banco '
  'nem para o prompt de um modelo.';

-- Marcador de "já enumerei as páginas deste Doc, nesta data". A enumeração é uma chamada por Doc,
-- então ela é incremental pelo mesmo critério do conteúdo: só quem mudou desde a última leitura.
-- Sem a coluna, todo sync pagaria uma chamada por Doc do workspace para redescobrir a mesma árvore.
alter table public.marketing_client_docs
  add column if not exists estrutura_lida_em timestamptz;

comment on column public.marketing_client_docs.estrutura_lida_em is
  'Quando as páginas deste Doc foram enumeradas (ver marketing_client_doc_pages). Comparada com '
  '`atualizado_em_clickup` é o que decide reenumerar.';

alter table public.marketing_client_doc_pages enable row level security;

-- Mesma regra de `marketing_client_docs`: equipe interna aprovada, e NUNCA usuário-cliente.
-- `caller_ads_names()` é NULL para quem não tem escopo de cliente. Importa aqui tanto quanto lá:
-- estas linhas carregam o TEXTO do mapeamento estratégico de um cliente.
drop policy if exists marketing_client_doc_pages_read on public.marketing_client_doc_pages;
create policy marketing_client_doc_pages_read on public.marketing_client_doc_pages
  for select to authenticated
  using (is_approved(auth.uid()) and (select public.caller_ads_names()) is null);

-- A consulta da aba e do Composer é sempre "deste cliente, editado mais recentemente primeiro".
create index if not exists idx_doc_pages_cliente
  on public.marketing_client_doc_pages (cliente, atualizado_em_clickup desc);

-- O sync reconstrói as linhas de um Doc, e a varredura de Docs cascateia por aqui.
create index if not exists idx_doc_pages_doc
  on public.marketing_client_doc_pages (doc_id);

-- ----------------------------------------------------------------------------------------------
-- O conteúdo concatenado sai de cena.
--
-- Não é limpeza: é o conserto do vazamento descrito no cabeçalho. A coluna continua existindo
-- (apagá-la é irreversível e nada ganha), mas vazia e marcada como morta — o sync novo não a
-- escreve e nada a lê.
-- ----------------------------------------------------------------------------------------------
update public.marketing_client_docs
   set conteudo_md = null, conteudo_chars = null, conteudo_lido_em = null
 where conteudo_md is not null or conteudo_chars is not null or conteudo_lido_em is not null;

comment on column public.marketing_client_docs.conteudo_md is
  'MORTA desde 02/10/2026. Guardava as páginas do Doc CONCATENADAS, o que num Doc coletivo é o '
  'texto de dezenas de clientes num campo só. O conteúdo agora vive em '
  'marketing_client_doc_pages.conteudo_md, uma linha por página. Nada escreve nem lê esta coluna.';

comment on column public.marketing_client_docs.conteudo_chars is
  'MORTA desde 02/10/2026, junto com conteudo_md. O tamanho agora é por página.';

-- `conteudo_lido_em` NÃO morre: ela é uma data, não conteúdo, e segue sendo o marcador de "quando
-- os corpos deste Doc foram baixados". O incremental continua decidindo no nível do Doc porque a
-- leitura é uma chamada por Doc que devolve todas as páginas de uma vez — decidir por página
-- custaria o mesmo e daria a mesma resposta. O `update` acima a zerou de propósito: o próximo sync
-- rebaixa tudo, agora separado por página.
comment on column public.marketing_client_docs.conteudo_lido_em is
  'Quando os corpos das páginas deste Doc foram baixados. Comparada com `atualizado_em_clickup` é '
  'o que decide rebaixar. O conteúdo em si está em marketing_client_doc_pages.';

-- Os pais que nenhum endpoint reconheceu ficam em cache como 'desconhecido' para sempre, e entre
-- eles estão os que falharam por permissão (401 OAUTH_027 em 21 tarefas-pai, 401 ACCESS_022 na
-- pasta 90131707316). Se o acesso for concedido no ClickUp, o cache impediria a redescoberta — então
-- a migração o limpa para o próximo sync tentar de novo.
delete from public.marketing_clickup_parents where kind = 'desconhecido';

notify pgrst, 'reload schema';

-- Conferência:
-- SELECT to_regclass('public.marketing_client_doc_pages');
-- -- quantas páginas por cliente, e quantas com conteúdo:
-- SELECT cliente, count(*) AS paginas, count(conteudo_md) AS com_conteudo
--   FROM public.marketing_client_doc_pages GROUP BY cliente ORDER BY paginas DESC NULLS LAST;
-- -- o Doc coletivo deve render MUITAS páginas, cada uma de um cliente:
-- SELECT p.cliente, p.nome, p.caminho FROM public.marketing_client_doc_pages p
--   JOIN public.marketing_client_docs d USING (doc_id)
--  WHERE d.nome ILIKE 'Mapeamento do Cliente%' ORDER BY p.cliente NULLS FIRST LIMIT 40;
-- -- e a coluna morta tem de estar vazia:
-- SELECT count(*) FROM public.marketing_client_docs WHERE conteudo_md IS NOT NULL;  -- 0
