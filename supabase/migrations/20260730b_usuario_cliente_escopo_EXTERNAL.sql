-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium). Rode no SQL Editor
-- desse projeto. É IDEMPOTENTE e ADITIVO: enquanto NÃO houver linha em user_client_scope,
-- as funções caller_*() retornam NULL e TODAS as condições de escopo viram "vê tudo" — ou
-- seja, aplicar esta migration NÃO muda nada para a equipe até você vincular um usuário-cliente.
--
-- USUÁRIO-CLIENTE (acesso restrito): um usuário vinculado a UM cliente enxerga somente os
-- dados desse cliente, em CRM / Meta Ads / Google Ads, somente leitura. O isolamento é feito
-- NO BANCO (aqui), então nem via API ele acessa outro cliente. Quem NÃO é usuário-cliente
-- (a equipe) continua vendo tudo, sem qualquer alteração de comportamento.

-- =====================================================================================
-- 1. Vínculo usuário → cliente (1 linha por usuário-cliente)
-- =====================================================================================
create table if not exists public.user_client_scope (
  user_id     uuid primary key,
  client_id   uuid not null,               -- clientes.id (escopo de v_clientes_lookup/clientes/clientes_meta)
  client_slug text not null,               -- nome_identificador (para o filtro do frontend)
  cmpkeys     text[] not null default '{}',-- chaves de match do CRM/Kommo (clientMatchKey das variantes)
  ads_names   text[] not null default '{}',-- nomes CRUS de conta Ads (match exato em "Client")
  updated_at  timestamptz not null default now()
);

alter table public.user_client_scope enable row level security;

-- Leitura: o próprio usuário lê o seu vínculo (o AuthContext precisa); admin lê todos.
drop policy if exists user_client_scope_read on public.user_client_scope;
create policy user_client_scope_read on public.user_client_scope
  for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

-- Escrita: só admin (atribui/remove o vínculo na tela de Administração).
drop policy if exists user_client_scope_insert on public.user_client_scope;
drop policy if exists user_client_scope_update on public.user_client_scope;
drop policy if exists user_client_scope_delete on public.user_client_scope;
create policy user_client_scope_insert on public.user_client_scope
  for insert to authenticated with check (public.has_role(auth.uid(), 'admin'));
create policy user_client_scope_update on public.user_client_scope
  for update to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
create policy user_client_scope_delete on public.user_client_scope
  for delete to authenticated using (public.has_role(auth.uid(), 'admin'));

-- =====================================================================================
-- 2. Helpers
-- =====================================================================================
-- clientMatchKey() do frontend em SQL: remove acento (Português) + lower + [\s_]+ -> _.
-- translate() é immutable (não depende da extensão unaccent), então a função é immutable.
create or replace function public.client_matchkey(s text)
returns text language sql immutable as $$
  select regexp_replace(
    lower(translate(coalesce(s, ''),
      'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
      'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')),
    '[\s_]+', '_', 'g')
$$;

-- Identificadores do cliente vinculado ao USUÁRIO LOGADO. Retornam NULL quando o usuário
-- NÃO é usuário-cliente (sem linha) → as condições de escopo viram "vê tudo" (equipe intacta).
-- SECURITY DEFINER para ler user_client_scope independentemente da RLS do chamador.
create or replace function public.caller_client_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select array(select client_id from user_client_scope where user_id = auth.uid());
$$;
create or replace function public.caller_kommo_cmpkeys()
returns text[] language sql stable security definer set search_path = public as $$
  select cmpkeys from user_client_scope where user_id = auth.uid();
$$;
create or replace function public.caller_ads_names()
returns text[] language sql stable security definer set search_path = public as $$
  select ads_names from user_client_scope where user_id = auth.uid();
$$;

revoke execute on function public.client_matchkey(text)     from public, anon;
revoke execute on function public.caller_client_ids()       from public, anon;
revoke execute on function public.caller_kommo_cmpkeys()    from public, anon;
revoke execute on function public.caller_ads_names()        from public, anon;
grant  execute on function public.client_matchkey(text)     to authenticated;
grant  execute on function public.caller_client_ids()       to authenticated;
grant  execute on function public.caller_kommo_cmpkeys()    to authenticated;
grant  execute on function public.caller_ads_names()        to authenticated;

-- Predicados de escopo (retornam TRUE p/ equipe = caller NULL; senão exigem match).
-- Kommo: caller sem vínculo → NULL → TRUE. Com vínculo → client_matchkey(client) na lista.
create or replace function public.scope_kommo_ok(_client text)
returns boolean language sql stable as $$
  select public.caller_kommo_cmpkeys() is null
      or public.client_matchkey(_client) = any(public.caller_kommo_cmpkeys());
$$;
-- Ads: match EXATO do nome cru da conta (precomputado no vínculo).
create or replace function public.scope_ads_ok(_client text)
returns boolean language sql stable as $$
  select public.caller_ads_names() is null
      or _client = any(public.caller_ads_names());
$$;
grant execute on function public.scope_kommo_ok(text) to authenticated;
grant execute on function public.scope_ads_ok(text)   to authenticated;

-- =====================================================================================
-- 3. Views recriadas VERBATIM + condição de escopo no WHERE (aditivo; column-list idêntica)
-- =====================================================================================

-- v_clientes_lookup: usuário-cliente só enxerga a linha do próprio cliente.
create or replace view public.v_clientes_lookup as
 SELECT c.id,
    c.nome_identificador,
    cc.nome_bruto
   FROM clientes c
     LEFT JOIN cliente_contas cc ON cc.cliente_id = c.id AND cc.ativo = true
  WHERE c.ativo = true AND is_approved(auth.uid())
    AND (public.caller_client_ids() = '{}'::uuid[] OR c.id = ANY(public.caller_client_ids()));

-- v_kommo_crm_agg (agregado do CRM): escopo por client (slug Kommo).
create or replace view public.v_kommo_crm_agg as
 SELECT client,
    medico,
    medicos,
    origem,
    especialidade,
    event_type,
    event_date,
    qtd,
    valor
   FROM mv_kommo_crm_agg
  WHERE is_approved(COALESCE(NULLIF(current_setting('request.jwt.claim.sub'::text, true), ''::text), NULLIF(current_setting('request.jwt.claims'::text, true), ''::text)::jsonb ->> 'sub'::text)::uuid)
    AND public.scope_kommo_ok(client);

-- v_meta_google_ads: escopo por "Client" (nome cru da conta Ads).
create or replace view public.v_meta_google_ads as
 SELECT id,
    "Dia",
    "Nome_Campanha",
    "Valor_usado_BRL",
    "Impressões",
    "Cliques_no_link",
    "CTR_taxa_de_cliques_no_link",
    "CPM_custo_por_1000_impressões",
    "CPC_custo_por_clique_no_link",
    "Tipo_de_resultado",
    "Resultados",
    "Custo_por_resultado",
    "Lead",
    "Custo_por_Lead",
    "Links",
    "Client",
    "Alcance",
    "Frequencia",
    id_unique,
    "Fonte_Ads",
    "Valor_conversao_BRL",
    "ROAS",
    "Video_views_3s",
    "Video_views_95pct",
    "Hook",
    "Hold",
    "Orcamento_diario",
    "Mensagens_iniciadas",
    "Custo_por_mensagem",
    "Visitas_perfil",
    "Custo_por_visita",
    "Seguidores",
    "Custo_por_seguidor",
    "Quality_ranking",
    "Engagement_ranking",
    "Conversion_ranking",
    "Resultados_meta",
    "Custo_por_resultado_meta",
    "Conversao_de_landing_page",
    "Parcela_de_impressao_na_rede_de_pesquisa",
    "Por_falta_de_orcamento",
    "Por_falta_de_classificacao",
    "Status_do_indice_de_qualidade_das_palavras"
   FROM _v_meta_google_ads_raw
  WHERE is_approved(auth.uid())
    AND public.scope_ads_ok("Client");

-- v_meta_google_ads_daily: escopo por "Client".
create or replace view public.v_meta_google_ads_daily as
 SELECT "Dia",
    "Client",
    "Fonte_Ads",
    "Valor_usado_BRL",
    "Lead",
    "Impressões",
    "Cliques_no_link",
    "Alcance",
    campaign_count,
    "Conversa",
    "Resultados",
    "Spend_Lead",
    "Spend_Conversa",
    "Resultados_meta"
   FROM _v_meta_google_ads_daily_raw
  WHERE is_approved(auth.uid())
    AND public.scope_ads_ok("Client");

-- v_kommo_completa (security_invoker=on preservado): escopo por client (slug Kommo).
create or replace view public.v_kommo_completa with (security_invoker=on) as
 SELECT id_unique,
    id,
    id_externo,
    created_at,
    updated_at,
    client,
    metadata,
    account_id,
    "Anuncio",
    "Atendimento",
    "Avaliação Agendada Em",
    "Avaliação Agendada Para",
    "Avaliação Realizada",
    "Campanha",
    "Cidade",
    "Cidade do Procedimento",
    "Cidade Formulário",
    closed_at,
    closest_task_at,
    "Começou com Transplante",
    "Conjunto",
    "Consulta Agendada",
    "Consulta Agendada Em",
    "Consulta Agendada Para",
    "Consulta de Revisão Agendada",
    "Consulta na Clinica",
    "Consulta Paga",
    "Consulta Realizada",
    "Continuação de Tratamento",
    "Convênio",
    "Cpf",
    "CRC",
    custom_fields_values,
    "Data",
    "Data 1 Pacote",
    "Data Campanha",
    "Data da Campanha",
    "Data da Confirmação",
    "Data da finalização do Procedimento",
    "Data da Sessão 1",
    "Data da Sessão 10",
    "Data da Sessão 11",
    "Data da Sessão 12",
    "Data da Sessão 13",
    "Data da Sessão 14",
    "Data da Sessão 15",
    "Data da Sessão 16",
    "Data da Sessão 17",
    "Data da Sessão 18",
    "Data da Sessão 19",
    "Data da Sessão 2",
    "Data da Sessão 20",
    "Data da Sessão 21",
    "Data da Sessão 22",
    "Data da Sessão 3",
    "Data da Sessão 4",
    "Data da Sessão 5",
    "Data da Sessão 6",
    "Data da Sessão 7",
    "Data da Sessão 8",
    "Data da Sessão 9",
    "Data de Confirmação",
    "Data de Encerramento Avaliação",
    "Data de Encerramento Definitivo",
    "Data de Inicio Avaliação",
    "Data de Inicio Definitivo",
    "Data de Nascimento",
    "Data de Pagamento",
    "Data do Inicio Procedimento",
    "Data do Orçamento",
    "Data do Pagamento da Consulta",
    "Data do Primeiro Contato",
    "Data do Retorno",
    "Data do Retorno da Consulta",
    "Dia da Avaliação Realizada",
    "Dia da Consulta Realizada",
    "Dia da Reunião Realizada",
    "Dia da Revisão Realizada",
    "Dia da Sessão 23",
    "Dia da Sessão 24",
    "Dia da Sessão 25",
    "Dia da Sessão 26",
    "Dia da Sessão 27",
    "Dia da Sessão 28",
    "Dia da Sessão 29",
    "Dia da Sessão 30",
    "Dia da Sessão 31",
    "Dia da Terapia Realizada",
    "Dia do Exame Realizado",
    "Dia do Novo Procedimento Realizado",
    "Dia do Orçamento Enviado",
    "Dia do Procedimento Realizado",
    "Dia do Retorno Realizado",
    "Dia do Transplante Realizado",
    "Dia do Tratamento Realizado",
    "Dor",
    "Especialidade",
    "Exame Agendado Em",
    "Exame Agendado Para",
    "Forma de Pagamento",
    "Forma de Pagamento Procedimento",
    "FUP 1",
    "FUP 2",
    "FUP 3",
    "FUP FINAL",
    "FUP1",
    "FUP2",
    "Genero",
    group_id,
    "histórico clínico",
    "Hora Campanha",
    "Hora da Campanha",
    "Hospital",
    "Hospital/Clinica",
    "ID do Paciente no Clinica nas Nuvens",
    "Interesse",
    is_deleted,
    is_price_computed,
    "Lead Campanha",
    "Lead Empresa",
    "Localização",
    loss_reason_id,
    "Médico",
    "Médicos",
    "Motivo da Perda",
    "Motivo de Perda",
    "Motivos de Perda",
    "Novo Paciente",
    "Novo Procedimento Agendado Em",
    "Novo Procedimento Agendado Para",
    "Número de Dias Tratamento",
    "Número de Sessões",
    "Número de Terapias",
    "Observação",
    "Observações",
    "Observações Procedimentos",
    "Orçamento",
    "Orçamento Enviado Em",
    "Origem",
    "Origem de Perda",
    "Origem Perda",
    "Pagamento Fechado Em",
    "Pagamento Finalizado",
    "perguntou valor da cirurgia",
    pipeline_id,
    price,
    price_with_minor_units,
    "Procedimento",
    "Procedimento (Antigo Sem Uso)",
    "Procedimento Agendado Em",
    "Procedimento Agendado Para",
    "Procedimentos",
    "Procedimentos de Tratamento",
    "Procedimentos Injetáveis",
    "Procedimentos Lia",
    "Procedimentos Moacir",
    "Resgate",
    responsible_user_id,
    "Retorno",
    "Retorno Agendado Em",
    "Retorno Agendado Para",
    "Reunião Agendada Em",
    "Secretária",
    "Sessão Atual",
    "Seu joanete te incomoda?",
    status_id,
    status_nome,
    "Terapia Agendada Em",
    "Terapia Agendada Para",
    "Terapias",
    "Tipo da Consulta",
    "Tipo de Avaliação",
    "Tipo de Consulta",
    "Tipo do Pagamento",
    "Tipo do Procedimento",
    "Transplante Agendado Para",
    "Tratamento Agendado Para",
    "Tratamento iniciado em",
    "Unidade",
    utm_campaign,
    utm_content,
    utm_medium,
    "Valor",
    "Valor da Avaliação",
    "Valor da Consulta",
    "Valor da Sessão 1",
    "Valor da Sessão 10",
    "Valor da Sessão 11",
    "Valor da Sessão 12",
    "Valor da Sessão 13",
    "Valor da Sessão 14",
    "Valor da Sessão 15",
    "Valor da Sessão 16",
    "Valor da Sessão 17",
    "Valor da Sessão 18",
    "Valor da Sessão 19",
    "Valor da Sessão 2",
    "Valor da Sessão 20",
    "Valor da Sessão 21",
    "Valor da Sessão 22",
    "Valor da Sessão 23",
    "Valor da Sessão 24",
    "Valor da Sessão 25",
    "Valor da Sessão 26",
    "Valor da Sessão 27",
    "Valor da Sessão 28",
    "Valor da Sessão 29",
    "Valor da Sessão 3",
    "Valor da Sessão 30",
    "Valor da Sessão 31",
    "Valor da Sessão 4",
    "Valor da Sessão 5",
    "Valor da Sessão 6",
    "Valor da Sessão 7",
    "Valor da Sessão 8",
    "Valor da Sessão 9",
    "Valor de Exame",
    "Valor do 1 Pacote",
    "Valor do Novo Procedimento",
    "Valor do Pacote",
    "Valor do Pacote Definitivo",
    "Valor do Procedimento",
    "Valor Pago",
    "Valor Pago no Curso",
    "Valor Total da Terapia",
    "Você conhece a Cirurgia Minimamente Invasiva? Qual sua disponi",
    "Você tem plano de saúde?"
   FROM _v_kommo_completa_raw
  WHERE is_approved(auth.uid())
    AND public.scope_kommo_ok(client);

-- =====================================================================================
-- 4. Tabelas com RLS: policies RESTRICTIVE (AND com o que já existe; NULL p/ equipe = TRUE)
-- =====================================================================================

-- Criativos Meta Ads (leitura escopada por "Client"; escrita do bot inalterada).
drop policy if exists criativos_client_scope on public."Criativos Meta Ads";
create policy criativos_client_scope on public."Criativos Meta Ads"
  as restrictive for select to authenticated
  using (public.scope_ads_ok("Client"));

-- clientes_meta (planejado): usuário-cliente só lê a meta do próprio cliente.
drop policy if exists clientes_meta_client_scope on public.clientes_meta;
create policy clientes_meta_client_scope on public.clientes_meta
  as restrictive for select to authenticated
  using (public.caller_client_ids() = '{}'::uuid[] OR client_id = ANY(public.caller_client_ids()));

-- crm_faturamento_config (base de faturamento): escopo por client_key (= clientMatchKey).
drop policy if exists crm_fat_config_client_scope on public.crm_faturamento_config;
create policy crm_fat_config_client_scope on public.crm_faturamento_config
  as restrictive for select to authenticated
  using (public.caller_kommo_cmpkeys() is null OR client_key = ANY(public.caller_kommo_cmpkeys()));

-- clientes (tabela): usuário-cliente só lê a própria linha (belt-and-suspenders; leituras
-- normais passam por v_clientes_lookup, já escopada acima).
drop policy if exists clientes_client_scope on public.clientes;
create policy clientes_client_scope on public.clientes
  as restrictive for select to authenticated
  using (public.caller_client_ids() = '{}'::uuid[] OR id = ANY(public.caller_client_ids()));

notify pgrst, 'reload schema';
