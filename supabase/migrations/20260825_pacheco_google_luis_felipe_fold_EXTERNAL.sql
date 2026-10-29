-- 20260825 — Pacheco (Google Ads): conta renomeada Luis_Pacheco -> Luis_Felipe pelo exportador externo
-- =============================================================================
-- CONTEXTO
--   O exportador externo do Google Ads passou a gravar a conta do Dr. Luis Felipe
--   Pacheco sob o slug "Luis_Felipe" a partir de 09/05/2026 (antes: "Luis_Pacheco").
--   As views _v_meta_google_ads_raw / _daily_raw tinham um filtro hardcoded
--   AND "Client" <> 'Luis_Felipe' (colocado quando "Luis_Felipe" era tido como
--   cliente-fantasma), que descartava justamente os dados ATUAIS do Pacheco — por
--   isso o Google Ads dele sumiu do Companium desde maio.
--
--   Verificado: de 05/01 a 08/05/2026 os dois slugs tinham linhas IDÊNTICAS
--   (mesmo Dia/Campanha/Valor; só id_unique diferente) = duplicatas do exportador.
--
-- APLICADO EM PRODUÇÃO (companium-db) via PAT em 25/08/2026, nesta ordem:
--   0) backup:  CREATE TABLE backup_luis_felipe_google_20260825 AS
--                 SELECT * FROM "Meta/Google Ads"
--                 WHERE "Fonte_Ads"='Google' AND "Client"='Luis_Felipe';   (163 linhas)
--   1) dedup:   DELETE FROM "Meta/Google Ads"
--                 WHERE "Fonte_Ads"='Google' AND "Client"='Luis_Felipe'
--                   AND "Dia" <= '2026-05-08';                                (90 duplicatas)
--   2) relabel: UPDATE "Meta/Google Ads" SET "Client"='Luis_Pacheco'
--                 WHERE "Fonte_Ads"='Google' AND "Client"='Luis_Felipe'
--                   AND "Dia" > '2026-05-08';                                  (73 linhas)
--   -> Luis_Pacheco ficou com 163 linhas contínuas 05/01 -> 25/08 (sem duplicatas).
--
-- VIEWS (abaixo): removido o filtro de exclusão e adicionado um CASE que dobra
--   qualquer "Luis_Felipe" futuro em "Luis_Pacheco" (futuro-proof: o exportador é
--   externo e pode voltar a gravar o slug curto).
-- =============================================================================

CREATE OR REPLACE VIEW public._v_meta_google_ads_raw AS
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
    COALESCE("Lead", 0::numeric) + COALESCE("Mensagens_iniciadas", 0::numeric) AS "Resultados",
        CASE
            WHEN (COALESCE("Lead", 0::numeric) + COALESCE("Mensagens_iniciadas", 0::numeric)) = 0::numeric THEN 0::numeric
            ELSE COALESCE("Valor_usado_BRL", 0::numeric) / (COALESCE("Lead", 0::numeric) + COALESCE("Mensagens_iniciadas", 0::numeric))
        END AS "Custo_por_resultado",
    "Lead",
    "Custo_por_Lead",
    "Links",
        CASE
            WHEN "Client" = 'Luis_Felipe'::text THEN 'Luis_Pacheco'::text
            ELSE "Client"
        END AS "Client",
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
    COALESCE("Lead", 0::numeric) + COALESCE("Mensagens_iniciadas", 0::numeric) AS "Resultados_meta",
        CASE
            WHEN (COALESCE("Lead", 0::numeric) + COALESCE("Mensagens_iniciadas", 0::numeric)) = 0::numeric THEN 0::numeric
            ELSE COALESCE("Valor_usado_BRL", 0::numeric) / (COALESCE("Lead", 0::numeric) + COALESCE("Mensagens_iniciadas", 0::numeric))
        END AS "Custo_por_resultado_meta",
    NULLIF("Conversao_de_landing_page", ''::text)::numeric AS "Conversao_de_landing_page",
    NULLIF("Parcela_de_impressao_na_rede_de_pesquisa", ''::text)::numeric AS "Parcela_de_impressao_na_rede_de_pesquisa",
    NULLIF("Por_falta_de_orcamento", ''::text)::numeric AS "Por_falta_de_orcamento",
    NULLIF("Por_falta_de_classificacao", ''::text)::numeric AS "Por_falta_de_classificacao",
    NULLIF("Status_do_indice_de_qualidade_das_palavras", ''::text)::numeric AS "Status_do_indice_de_qualidade_das_palavras"
   FROM "Meta/Google Ads"
  WHERE "Fonte_Ads" = 'Google'::text OR "Client" ~~* '%groohub%'::text OR "Nome_Campanha" ~~* '%groohub%'::text AND "Client" ~~ '% %'::text;;

CREATE OR REPLACE VIEW public._v_meta_google_ads_daily_raw AS
SELECT "Dia",
        CASE
            WHEN "Client" = 'Luis_Felipe'::text THEN 'Luis_Pacheco'::text
            ELSE "Client"
        END AS "Client",
    "Fonte_Ads",
    sum(COALESCE("Valor_usado_BRL", 0::numeric)) AS "Valor_usado_BRL",
    sum(COALESCE("Lead", 0::numeric)) AS "Lead",
    sum(COALESCE("Impressões", 0::numeric)) AS "Impressões",
    sum(COALESCE("Cliques_no_link", 0::numeric)) AS "Cliques_no_link",
    sum(COALESCE("Alcance", 0::numeric)) AS "Alcance",
    count(*)::integer AS campaign_count,
    sum(COALESCE("Mensagens_iniciadas", 0::numeric)) AS "Conversa",
    sum(COALESCE("Lead", 0::numeric) + COALESCE("Mensagens_iniciadas", 0::numeric)) AS "Resultados",
    sum(COALESCE("Lead", 0::numeric) * COALESCE("Custo_por_Lead", 0::numeric)) AS "Spend_Lead",
    sum(COALESCE("Mensagens_iniciadas", 0::numeric) * COALESCE("Custo_por_mensagem", 0::numeric)) AS "Spend_Conversa",
    sum(COALESCE("Resultados", 0::numeric)) AS "Resultados_meta"
   FROM "Meta/Google Ads"
  WHERE "Fonte_Ads" = 'Google'::text OR "Client" ~~* '%groohub%'::text OR "Nome_Campanha" ~~* '%groohub%'::text AND "Client" ~~ '% %'::text
  GROUP BY "Dia", "Client", "Fonte_Ads";;
