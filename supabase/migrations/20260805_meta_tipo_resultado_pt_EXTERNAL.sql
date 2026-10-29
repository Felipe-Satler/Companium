-- ============================================================================
-- Coluna "Tipo_de_resultado_pt": Tipo de Resultado do Meta Ads traduzido p/ PT,
-- gravado na tabela base "Meta/Google Ads" (fonte de v_meta_google_ads).
-- Rodar no SQL Editor do Supabase (projeto companium-db) — o PAT é read-only (DDL 403).
--
-- Mapa (mesmo da tabela de campanhas do Companium):
--   lead                                                  -> Lead Form
--   onsite_conversion.messaging_conversation_started_7d   -> Conversas Iniciadas
--   messaging_conversation_started                        -> Conversas Iniciadas
--   follow                                                -> Seguidores
--   profile_visit                                         -> Visitas ao perfil
--   link_click                                            -> Visitas ao Perfil
--   purchase / offsite_conversion.fb_pixel_purchase       -> Compras
--   NULL / vazio                                          -> -
--   (qualquer outro código não mapeado)                   -> mantém o valor cru
-- ============================================================================

-- ----------------------------------------------------------------------------
-- OPÇÃO A (RECOMENDADA): coluna GERADA (STORED).
-- Recalcula sozinha a cada insert/update — sempre em sincronia com o código cru,
-- inclusive para linhas NOVAS que o robô gravar. Não precisa de UPDATE nem de
-- alterar o robô. (Requer Postgres 12+, ok no Supabase.)
-- ----------------------------------------------------------------------------
ALTER TABLE "Meta/Google Ads"
  ADD COLUMN IF NOT EXISTS "Tipo_de_resultado_pt" text
  GENERATED ALWAYS AS (
    CASE
      WHEN "Tipo_de_resultado" = 'lead' THEN 'Lead'
      WHEN "Tipo_de_resultado" IN (
        'onsite_conversion.messaging_conversation_started_7d',
        'messaging_conversation_started'
      ) THEN 'Conversas Iniciadas'
      WHEN "Tipo_de_resultado" = 'follow' THEN 'Seguidores'
      WHEN "Tipo_de_resultado" = 'profile_visit' THEN 'Visitas ao perfil'
      WHEN "Tipo_de_resultado" = 'link_click' THEN 'Visitas ao Perfil'
      WHEN "Tipo_de_resultado" IN (
        'purchase',
        'offsite_conversion.fb_pixel_purchase'
      ) THEN 'Compras'
      WHEN "Tipo_de_resultado" IS NULL OR btrim("Tipo_de_resultado") = '' THEN '-'
      ELSE "Tipo_de_resultado"
    END
  ) STORED;


-- ----------------------------------------------------------------------------
-- OPÇÃO B (ALTERNATIVA): coluna comum + UPDATE único.
-- Use SÓ se quiser poder editar valores manualmente depois. Linhas novas do robô
-- NÃO preenchem esta coluna sozinhas (precisaria alterar o robô ou reexecutar o
-- UPDATE periodicamente). NÃO rode junto com a Opção A.
-- ----------------------------------------------------------------------------
-- ALTER TABLE "Meta/Google Ads"
--   ADD COLUMN IF NOT EXISTS "Tipo_de_resultado_pt" text;
--
-- UPDATE "Meta/Google Ads"
-- SET "Tipo_de_resultado_pt" = CASE
--     WHEN "Tipo_de_resultado" = 'lead' THEN 'Lead Form'
--     WHEN "Tipo_de_resultado" IN (
--       'onsite_conversion.messaging_conversation_started_7d',
--       'messaging_conversation_started'
--     ) THEN 'Conversas Iniciadas'
--     WHEN "Tipo_de_resultado" = 'follow' THEN 'Seguidores'
--     WHEN "Tipo_de_resultado" = 'profile_visit' THEN 'Visitas ao perfil'
--     WHEN "Tipo_de_resultado" = 'link_click' THEN 'Visitas ao Perfil'
--     WHEN "Tipo_de_resultado" IN (
--       'purchase',
--       'offsite_conversion.fb_pixel_purchase'
--     ) THEN 'Compras'
--     WHEN "Tipo_de_resultado" IS NULL OR btrim("Tipo_de_resultado") = '' THEN '-'
--     ELSE "Tipo_de_resultado"
--   END;


-- ----------------------------------------------------------------------------
-- (OPCIONAL) Expor a coluna nas views p/ o Companium/consumidores lerem do banco
-- em vez de traduzir no front. As views precisam adicionar "Tipo_de_resultado_pt"
-- na lista de colunas de _v_meta_google_ads_raw e v_meta_google_ads.
-- Ver: supabase/migrations/20260615_google_ads_share_metrics.sql (def. das views).
-- ----------------------------------------------------------------------------

-- Conferência rápida da distribuição:
-- SELECT "Tipo_de_resultado", "Tipo_de_resultado_pt", count(*)
-- FROM "Meta/Google Ads"
-- GROUP BY 1, 2 ORDER BY count(*) DESC;
