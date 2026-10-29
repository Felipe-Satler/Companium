// Tradução dos códigos crus de `Tipo_de_resultado` (tabela principal "Meta/Google Ads",
// exposta via v_meta_google_ads) para os rótulos PT exibidos na TABELA DE CAMPANHAS do
// Meta Ads. NÃO confundir com os rótulos da tabela "Criativos Meta Ads" (cards) — mapa e
// nomes distintos (ex.: aqui `link_click` = "Visitas ao Perfil" e `lead` = "Lead Form").
//
// O valor CRU continua sendo a fonte da verdade: é ele que fica no filtro (dropdown) e no
// tooltip da célula. Esta função só troca o texto exibido. Valores desconhecidos passam
// direto (mostra o código), e "Total"/"—" são preservados.
const CAMPAIGN_RESULT_TYPE_LABELS: Record<string, string> = {
  lead: "Lead",
  "onsite_conversion.messaging_conversation_started_7d": "Conversas Iniciadas",
  messaging_conversation_started: "Conversas Iniciadas",
  follow: "Seguidores",
  profile_visit: "Visitas ao perfil",
  // MESMA string de `profile_visit` (não "Visitas ao Perfil"): os dois códigos significam
  // a mesma coisa nestas campanhas de tráfego pro IG. Quando as grafias diferiam por UMA
  // maiúscula, o dropdown de Tipo de Resultado ganhava duas opções visualmente idênticas,
  // cada uma filtrando um conjunto DISJUNTO de campanhas.
  link_click: "Visitas ao perfil",
  purchase: "Compras",
  "offsite_conversion.fb_pixel_purchase": "Compras",
};

export function formatCampaignResultType(raw: string | null | undefined): string {
  if (raw == null) return "—";
  const t = raw.trim();
  if (!t || t === "—" || t === "Total") return t || "—";
  return CAMPAIGN_RESULT_TYPE_LABELS[t] ?? t;
}

// Vocabulário CANÔNICO de tipo de resultado — um rótulo por objetivo, valha o valor de
// onde vier. Existem TRÊS grafias do mesmo tipo circulando no sistema:
//   1. código cru do Meta na tabela principal ("onsite_conversion.messaging_...");
//   2. rótulo PT gravado em "Criativos Meta Ads" ("Conversas iniciadas");
//   3. o mesmo rótulo com outra caixa, gravado por outra versão da ingestão
//      ("Conversas Iniciadas") — as duas convivem na tabela hoje.
// Sem canonicalizar, cada grafia vira uma entrada separada no filtro e as campanhas de um
// mesmo objetivo se dividem entre elas. Comparações de tipo devem passar por aqui.
// O alvo é o vocabulário de "Criativos Meta Ads" (TIPO_LABELS em useMetaAdsCriativosData),
// porque é dele que vêm tanto o rótulo quanto o NÚMERO exibidos na hierarquia. Difere do mapa
// de exibição acima em dois pontos de propósito: `lead` é "Cadastros" (não "Lead") e
// `link_click` cai em "Visitas ao perfil" — nestas campanhas de tráfego pro IG o clique no
// link É a visita ao perfil, e é assim que a tabela principal já classificava.
const CANONICAL_RESULT_TYPES: Record<string, string> = {
  lead: "Cadastros",
  "onsite_conversion.messaging_conversation_started_7d": "Conversas iniciadas",
  messaging_conversation_started: "Conversas iniciadas",
  follow: "Seguidores",
  profile_visit: "Visitas ao perfil",
  link_click: "Visitas ao perfil",
  purchase: "Compras",
  "offsite_conversion.fb_pixel_purchase": "Compras",
};

export function canonicalResultType(raw: string | null | undefined): string {
  if (raw == null) return "";
  const t = raw.trim();
  if (!t || t === "—" || t === "Total") return "";
  const byCode = CANONICAL_RESULT_TYPES[t];
  if (byCode) return byCode;
  // Já é rótulo PT: normaliza só a caixa contra o vocabulário conhecido.
  const lower = t.toLowerCase();
  for (const label of Object.values(CANONICAL_RESULT_TYPES)) {
    if (label.toLowerCase() === lower) return label;
  }
  return t;
}
