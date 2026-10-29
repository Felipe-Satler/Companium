// Mapeamento manual: slug de Campanha no Kommo (Origem = Google Ads)
// → norm_key da campanha correspondente no Google Ads.
//
// Use APENAS para casos 1↔1 sem ambiguidade. Quando o slug do CRM casar com
// múltiplas campanhas Ads (ex: GROOHUB001 com versões em datas diferentes),
// NÃO adicione alias aqui — esses casos viram linha agregada "[CRM] {slug}".
//
// Estrutura: { client: { slug_norm_crm: norm_key_ads } }
// norm_key segue: minúsculas, sem acento, só [a-z0-9].
export const GOOGLE_ADS_CAMPAIGN_ALIASES: Record<string, Record<string, string>> = {
  Clínica_Lumen: {
    // 1 lead → única campanha GROOHUB do cliente
    groohub001: "groohub001sracupunturadorescronicasmedicinaesportivaregioessp0704",
  },
};

// Slugs do CRM a IGNORAR (não entram na agregação nem viram linha [CRM]).
// Útil para Origem mal classificada na fonte (ex: nomes Meta marcados Google).
// Valores em norm_key.
export const GOOGLE_ADS_CRM_IGNORE: Record<string, string[]> = {
  Rogerio_Lacerda: [
    "cboliftingbroadrmkt1707",
    "cbofoxeyescidadessprmkt0906",
  ],
};
