-- ============================================================================
-- Ajuste do rótulo: 'lead' passa de "Lead Form" para "Lead".
-- "Tipo_de_resultado_pt" é uma coluna GERADA (STORED): não aceita UPDATE; para
-- mudar o mapeamento é preciso recriar a expressão (DROP + ADD).
-- Rodar no SQL Editor do Supabase (projeto companium-db).
-- ============================================================================

ALTER TABLE "Meta/Google Ads" DROP COLUMN IF EXISTS "Tipo_de_resultado_pt";

ALTER TABLE "Meta/Google Ads"
  ADD COLUMN "Tipo_de_resultado_pt" text
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

-- Conferência:
-- SELECT "Tipo_de_resultado", "Tipo_de_resultado_pt", count(*)
-- FROM "Meta/Google Ads" GROUP BY 1,2 ORDER BY count(*) DESC;
