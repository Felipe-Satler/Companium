-- ⚠️ PROJETO-ALVO: your-project-ref. Rode no SQL Editor. CORREÇÃO DE PERFORMANCE:
-- reescreve a condição de escopo das views/policies para AVALIAÇÃO ÚNICA por query
-- (subquery (select ...) = InitPlan). Para a EQUIPE (caller sem vínculo) a condição vira
-- constante TRUE avaliada 1x → custo ZERO por linha (volta à performance original, sem
-- o timeout que zerava os cards no 1º load). Aditivo e seguro. Requer a migration
-- 20260730b já aplicada (usa as funções caller_*/client_matchkey).

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
    AND ((select public.caller_client_ids()) = '{}'::uuid[] OR c.id = ANY((select public.caller_client_ids())::uuid[]));

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
    AND ((select public.caller_kommo_cmpkeys()) IS NULL OR public.client_matchkey(client) = ANY((select public.caller_kommo_cmpkeys())::text[]));

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
    AND ((select public.caller_ads_names()) IS NULL OR "Client" = ANY((select public.caller_ads_names())::text[]));

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
    AND ((select public.caller_ads_names()) IS NULL OR "Client" = ANY((select public.caller_ads_names())::text[]));

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
    AND ((select public.caller_kommo_cmpkeys()) IS NULL OR public.client_matchkey(client) = ANY((select public.caller_kommo_cmpkeys())::text[]));

-- =====================================================================================
-- 4. Tabelas com RLS: policies RESTRICTIVE (AND com o que já existe; NULL p/ equipe = TRUE)
-- =====================================================================================

-- Criativos Meta Ads (leitura escopada por "Client"; escrita do bot inalterada).
drop policy if exists criativos_client_scope on public."Criativos Meta Ads";
create policy criativos_client_scope on public."Criativos Meta Ads"
  as restrictive for select to authenticated
  using (((select public.caller_ads_names()) IS NULL OR "Client" = ANY((select public.caller_ads_names())::text[])));

-- clientes_meta (planejado): usuário-cliente só lê a meta do próprio cliente.
drop policy if exists clientes_meta_client_scope on public.clientes_meta;
create policy clientes_meta_client_scope on public.clientes_meta
  as restrictive for select to authenticated
  using ((select public.caller_client_ids()) = '{}'::uuid[] OR client_id = ANY((select public.caller_client_ids())::uuid[]));

-- crm_faturamento_config (base de faturamento): escopo por client_key (= clientMatchKey).
drop policy if exists crm_fat_config_client_scope on public.crm_faturamento_config;
create policy crm_fat_config_client_scope on public.crm_faturamento_config
  as restrictive for select to authenticated
  using ((select public.caller_kommo_cmpkeys()) is null OR client_key = ANY((select public.caller_kommo_cmpkeys())::text[]));

-- clientes (tabela): usuário-cliente só lê a própria linha (belt-and-suspenders; leituras
-- normais passam por v_clientes_lookup, já escopada acima).
drop policy if exists clientes_client_scope on public.clientes;
create policy clientes_client_scope on public.clientes
  as restrictive for select to authenticated
  using ((select public.caller_client_ids()) = '{}'::uuid[] OR id = ANY((select public.caller_client_ids())::uuid[]));

notify pgrst, 'reload schema';
