-- Expõe na pipeline de views do Google Ads as 4 métricas de share/conversão
-- (+ índice de qualidade) que já existem na tabela bruta "Meta/Google Ads" como
-- TEXTO e eram descartadas pelas views. Convertidas para numeric (frações 0..1).
-- Pipeline: "Meta/Google Ads" -> _v_meta_google_ads_raw -> v_meta_google_ads
-- CREATE OR REPLACE apenas ANEXA colunas no fim — não quebra a view dependente.

CREATE OR REPLACE VIEW public._v_meta_google_ads_raw AS
 SELECT id, "Dia", "Nome_Campanha", "Valor_usado_BRL", "Impressões", "Cliques_no_link",
    "CTR_taxa_de_cliques_no_link", "CPM_custo_por_1000_impressões", "CPC_custo_por_clique_no_link",
    "Tipo_de_resultado",
    COALESCE("Lead", 0::numeric) + COALESCE("Mensagens_iniciadas", 0::numeric) AS "Resultados",
        CASE
            WHEN (COALESCE("Lead", 0::numeric) + COALESCE("Mensagens_iniciadas", 0::numeric)) = 0::numeric THEN 0::numeric
            ELSE COALESCE("Valor_usado_BRL", 0::numeric) / (COALESCE("Lead", 0::numeric) + COALESCE("Mensagens_iniciadas", 0::numeric))
        END AS "Custo_por_resultado",
    "Lead", "Custo_por_Lead", "Links", "Client", "Alcance", "Frequencia", id_unique, "Fonte_Ads",
    "Valor_conversao_BRL", "ROAS", "Video_views_3s", "Video_views_95pct", "Hook", "Hold",
    "Orcamento_diario", "Mensagens_iniciadas", "Custo_por_mensagem", "Visitas_perfil", "Custo_por_visita",
    "Seguidores", "Custo_por_seguidor", "Quality_ranking", "Engagement_ranking", "Conversion_ranking",
    COALESCE("Lead", 0::numeric) + COALESCE("Mensagens_iniciadas", 0::numeric) AS "Resultados_meta",
        CASE
            WHEN (COALESCE("Lead", 0::numeric) + COALESCE("Mensagens_iniciadas", 0::numeric)) = 0::numeric THEN 0::numeric
            ELSE COALESCE("Valor_usado_BRL", 0::numeric) / (COALESCE("Lead", 0::numeric) + COALESCE("Mensagens_iniciadas", 0::numeric))
        END AS "Custo_por_resultado_meta",
    NULLIF("Conversao_de_landing_page", '')::numeric AS "Conversao_de_landing_page",
    NULLIF("Parcela_de_impressao_na_rede_de_pesquisa", '')::numeric AS "Parcela_de_impressao_na_rede_de_pesquisa",
    NULLIF("Por_falta_de_orcamento", '')::numeric AS "Por_falta_de_orcamento",
    NULLIF("Por_falta_de_classificacao", '')::numeric AS "Por_falta_de_classificacao",
    NULLIF("Status_do_indice_de_qualidade_das_palavras", '')::numeric AS "Status_do_indice_de_qualidade_das_palavras"
   FROM "Meta/Google Ads"
  WHERE ("Fonte_Ads" = 'Google'::text OR "Client" ~~* '%groohub%'::text OR "Nome_Campanha" ~~* '%groohub%'::text AND "Client" ~~ '% %'::text) AND "Client" <> 'Luis_Felipe'::text;

CREATE OR REPLACE VIEW public.v_meta_google_ads AS
 SELECT id, "Dia", "Nome_Campanha", "Valor_usado_BRL", "Impressões", "Cliques_no_link",
    "CTR_taxa_de_cliques_no_link", "CPM_custo_por_1000_impressões", "CPC_custo_por_clique_no_link",
    "Tipo_de_resultado", "Resultados", "Custo_por_resultado", "Lead", "Custo_por_Lead", "Links",
    "Client", "Alcance", "Frequencia", id_unique, "Fonte_Ads", "Valor_conversao_BRL", "ROAS",
    "Video_views_3s", "Video_views_95pct", "Hook", "Hold", "Orcamento_diario", "Mensagens_iniciadas",
    "Custo_por_mensagem", "Visitas_perfil", "Custo_por_visita", "Seguidores", "Custo_por_seguidor",
    "Quality_ranking", "Engagement_ranking", "Conversion_ranking", "Resultados_meta", "Custo_por_resultado_meta",
    "Conversao_de_landing_page",
    "Parcela_de_impressao_na_rede_de_pesquisa",
    "Por_falta_de_orcamento",
    "Por_falta_de_classificacao",
    "Status_do_indice_de_qualidade_das_palavras"
   FROM _v_meta_google_ads_raw
  WHERE is_approved(auth.uid());
