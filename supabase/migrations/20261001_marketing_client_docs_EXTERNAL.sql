-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium), NÃO o projeto
-- primário do config.toml. Rode este SQL no SQL Editor DESSE projeto (o PAT é read-only, então DDL
-- só passa pelo SQL Editor). IDEMPOTENTE.
--
-- ⚠️ RODAR ANTES DO RESTART DO WORKER: o worker novo lê e escreve estas tabelas, e a aba Documentos
-- passa a servir DELAS em vez de consultar o ClickUp a cada abertura. Sem a migração, a aba responde
-- o erro de leitura em vez de listar. É aditiva e inofensiva enquanto ninguém a lê.
--
-- ----------------------------------------------------------------------------------------------
-- MARKETING › CENTRAL DE CLIENTES — DOCUMENTOS: Docs do ClickUp ingeridos e guardados.
--
-- A primeira versão da aba lia o ClickUp ao vivo a cada abertura. Guardar muda três coisas:
-- o documento vira INSUMO (o Ad Composer recebe o conteúdo no prompt), a leitura fica instantânea,
-- e o sync passa a ser incremental — `atualizado_em_clickup` contra o `date_updated` que a busca de
-- Docs devolve, então só quem mudou custa uma chamada de conteúdo.
--
-- ## Por que o conteúdo da maioria dos documentos é NULL de propósito
--
-- `conteudo_md` só é preenchido para os tipos da allowlist de `shared/clickup-doc-tipos.js`. O
-- workspace tem um documento chamado "Acessos", e documento com esse nome em agência guarda login e
-- senha de cliente. Uma denylist pegaria esse nome e deixaria passar o próximo ("Infra - chaves",
-- "Credenciais GA4"), gravando a senha aqui e mandando-a ao prompt de um modelo. Então o padrão é
-- fechado: tipo não reconhecido entra como LINHA (nome, link, pai), com `tipo` e `conteudo_md`
-- nulos. A pessoa clica e vai ao ClickUp, onde o controle de acesso é o do ClickUp.
--
-- `tipo is null` é portanto o estado normal da maioria das linhas, não um defeito de classificação.
-- ----------------------------------------------------------------------------------------------

create table if not exists public.marketing_client_docs (
  -- O id do Doc no ClickUp é a chave natural e é estável: ele é a identidade da linha, não um uuid
  -- nosso. Upsert por ele é o que torna o sync idempotente.
  doc_id                text primary key,

  -- O `padrao` do cliente, a MESMA chave do Contexto Operacional e do Relatório. NULO quando o
  -- documento não foi atribuído a cliente nenhum — e isso é comum e correto: documento interno da
  -- agência (processo, template, documento no nível do workspace) não é de cliente.
  cliente               text,
  -- Como a atribuição foi feita: 'tarefa' (o pai é a tarefa do cliente — o sinal mais forte, porque
  -- no ClickUp da Groohub cada cliente É uma tarefa), 'pasta' (espaço/pasta/lista com o nome do
  -- cliente) ou 'nome' (só o título do documento casou). A tela mostra a diferença em vez de
  -- apresentar os três como a mesma certeza.
  atribuido_via         text,

  nome                  text not null,
  url                   text,
  -- O caminho legível ("MktOps › Clientes › Dr. José Ramos"), montado na resolução do pai.
  local                 text,

  -- O pai cru, como a API devolve. Guardado porque é o que permite reclassificar depois sem
  -- reconsultar o ClickUp — e porque os códigos de `parent.type` deste workspace (1 e 12) não são os
  -- que a documentação de Views enumera, então tratá-los como opacos é mais honesto que fingir
  -- conhecê-los.
  parent_id             text,
  parent_type           integer,

  -- O tipo da allowlist (`shared/clickup-doc-tipos.js`). NULO = não reconhecido = conteúdo não lido.
  tipo                  text,
  -- Markdown das páginas do Doc, concatenado. NULO quando `tipo` é nulo (ver o cabeçalho).
  conteudo_md           text,
  conteudo_chars        integer,
  -- Quando o conteúdo foi baixado. Comparado com `atualizado_em_clickup` é o que decide rebaixar:
  -- conteúdo mais velho que a última edição = precisa reler.
  conteudo_lido_em      timestamptz,

  arquivado             boolean not null default false,
  publico               boolean not null default false,

  -- As datas DO CLICKUP, não as nossas. `atualizado_em_clickup` é o motor do sync incremental.
  criado_em_clickup     timestamptz,
  atualizado_em_clickup timestamptz,

  -- Quando esta linha foi vista pelo sync. Linha que parou de ser vista é documento apagado no
  -- ClickUp; o sync a remove, e esta coluna é como se audita isso.
  sincronizado_em       timestamptz not null default now()
);

comment on table public.marketing_client_docs is
  'Marketing › Central de Clientes (Documentos): Docs do ClickUp ingeridos pelo worker, com sync '
  'incremental por `atualizado_em_clickup`. `conteudo_md` só é preenchido para os tipos da '
  'allowlist de shared/clickup-doc-tipos.js — padrão FECHADO, porque o workspace tem documento de '
  'credencial ("Acessos") e uma denylist deixaria passar o próximo nome imprevisto. `tipo is null` '
  'é o estado normal da maioria das linhas. Serve à aba Documentos e de insumo ao Ad Composer.';

comment on column public.marketing_client_docs.conteudo_md is
  'Markdown das páginas do Doc. NULO quando `tipo` é nulo: tipo não reconhecido NÃO tem conteúdo '
  'lido, para credencial de cliente nunca atravessar para este banco nem para um prompt.';

-- ----------------------------------------------------------------------------------------------
-- RESOLUÇÃO DE PAI — cache permanente, porque resolver é caro e repetido.
--
-- A busca de Docs devolve só o id do pai. Descobrir o NOME dele custa uma chamada, e na medição do
-- workspace 74 dos 100 primeiros documentos compartilhavam UM pai: resolver por documento seria
-- repetir a mesma chamada 74 vezes, a cada sync, para sempre.
--
-- `kind` é descoberto por tentativa (list -> folder -> space -> task, o primeiro que responde 200)
-- justamente para NÃO depender dos códigos numéricos de `parent.type`, que eu já errei uma vez.
-- ----------------------------------------------------------------------------------------------
create table if not exists public.marketing_clickup_parents (
  parent_id    text primary key,
  -- 'space' | 'folder' | 'list' | 'task' | 'desconhecido'
  kind         text not null,
  nome         text,
  -- Do mais externo ao mais interno: ['MktOps', 'Clientes', 'Dr. José Ramos'].
  cadeia       text[] not null default '{}',
  resolvido_em timestamptz not null default now()
);

comment on table public.marketing_clickup_parents is
  'Cache permanente da resolução id -> nome/cadeia de pais de Doc do ClickUp. Existe porque a busca '
  'de Docs só devolve o id do pai e porque dezenas de documentos compartilham o mesmo pai. `kind` é '
  'descoberto por tentativa nos endpoints, não pelos códigos de `parent.type`.';

alter table public.marketing_client_docs enable row level security;
alter table public.marketing_clickup_parents enable row level security;

-- Leitura: equipe interna aprovada. `caller_ads_names()` é NULL para quem não é usuário-cliente —
-- mesma regra de `ad_spy_library`, `marketing_client_briefs`, `marketing_compositions` e
-- `marketing_client_reports`. Escrita não tem policy: passa pelo worker com service_role.
--
-- Importa mais aqui do que nas outras quatro: estas linhas carregam TEXTO de documento de cliente.
-- Um usuário-cliente logado não pode ler o mapeamento estratégico de outro cliente.
drop policy if exists marketing_client_docs_read on public.marketing_client_docs;
create policy marketing_client_docs_read on public.marketing_client_docs
  for select to authenticated
  using (is_approved(auth.uid()) and (select public.caller_ads_names()) is null);

drop policy if exists marketing_clickup_parents_read on public.marketing_clickup_parents;
create policy marketing_clickup_parents_read on public.marketing_clickup_parents
  for select to authenticated
  using (is_approved(auth.uid()) and (select public.caller_ads_names()) is null);

-- A consulta da aba é sempre "deste cliente, editado mais recentemente primeiro".
create index if not exists idx_marketing_client_docs_cliente
  on public.marketing_client_docs (cliente, atualizado_em_clickup desc);

-- O sync pergunta "quais linhas já existem e com que data", e o Composer pergunta "quais deste
-- cliente têm conteúdo".
create index if not exists idx_marketing_client_docs_tipo
  on public.marketing_client_docs (cliente, tipo)
  where tipo is not null;

notify pgrst, 'reload schema';

-- Conferência:
-- SELECT to_regclass('public.marketing_client_docs'), to_regclass('public.marketing_clickup_parents');
-- -- quantos documentos por cliente, e quantos com conteúdo ingerido:
-- SELECT cliente, count(*) AS docs, count(conteudo_md) AS com_conteudo
--   FROM public.marketing_client_docs GROUP BY cliente ORDER BY docs DESC;
-- -- o que ficou sem classificar (conteúdo NÃO lido, de propósito):
-- SELECT nome, local FROM public.marketing_client_docs WHERE tipo IS NULL ORDER BY nome;
