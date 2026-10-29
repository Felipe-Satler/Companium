import type { SpySettings, SpySourceId } from "@/lib/adSpyApi";

/**
 * A qual fonte cada filtro do formulário se aplica.
 *
 * ESPELHA o worker — `makeQualityGate` (apps/ad-spy-worker/sources/shared.js) para os filtros de
 * qualidade, e os parâmetros que cada provider manda à API para os de busca (status, país,
 * ordenação). Se um filtro passar a valer para outra fonte lá, muda aqui; a tag na tela e o
 * esmaecimento do campo saem deste mapa, e o teste `mineracaoFiltroFontes` compara os dois lados.
 *
 * "Instagram Ads" é tag própria: é a Biblioteca da Meta filtrada pelo posicionamento, então os
 * filtros de anúncio Meta valem nela, e os do Instagram orgânico não.
 */
export type TagFonte = "meta" | "google" | "instagram_ads" | "tiktok" | "tiktok_organic" | "instagram" | "youtube";

export const TAG_LABEL: Record<TagFonte, string> = {
  meta: "Meta",
  google: "Google Ads",
  instagram_ads: "Instagram Ads",
  tiktok: "TikTok Ads",
  tiktok_organic: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
};

export const TODAS: TagFonte[] = ["meta", "google", "instagram_ads", "tiktok", "tiktok_organic", "instagram", "youtube"];
const PAGAS: TagFonte[] = ["meta", "google", "instagram_ads", "tiktok"];
const ORGANICAS: TagFonte[] = ["tiktok_organic", "instagram", "youtube"];

type Filtro = keyof SpySettings;

export const FILTRO_FONTES: Partial<Record<Filtro, TagFonte[]>> = {
  targetAds: TODAS,
  // Pagos
  minDaysRunning: PAGAS,
  minCollationCount: ["meta", "instagram_ads"],
  minTikTokAudience: ["tiktok"],
  status: ["meta", "instagram_ads"],
  // Orgânicos
  minViews: ORGANICAS,
  minEngagementPct: ORGANICAS,
  // Só o Instagram traz os seguidores junto do post; a busca do YouTube não traz inscritos, e o
  // TikTok manda 0 seguidores em várias rotas.
  minViewsPerFollower: ["instagram"],
  // Todas
  maxPerAdvertiser: TODAS,
  minCopyChars: TODAS,
  mediaType: TODAS,
  // Parâmetros de busca: só as fontes cuja API os aceita.
  country: ["meta", "google", "instagram_ads", "tiktok", "tiktok_organic", "youtube"],
  sortBy: ["meta", "instagram_ads", "tiktok_organic", "youtube"],
  // YouTube não entrega o vídeo: a transcrição dele é sempre a legenda, com ou sem esta chave.
  transcribe: ["meta", "instagram_ads", "tiktok", "tiktok_organic", "instagram"],
};

/** As tags das fontes marcadas no formulário. */
export function fontesAtivas(sources: SpySourceId[]): Set<TagFonte> {
  const out = new Set<TagFonte>();
  for (const s of sources) {
    if (s === "meta") out.add("meta");
    else if (s.startsWith("google")) out.add("google");
    else if (s === "instagram_ads") out.add("instagram_ads");
    else if (s === "tiktok") out.add("tiktok");
    else if (s.startsWith("tiktok")) out.add("tiktok_organic");
    else if (s.startsWith("instagram")) out.add("instagram");
    else if (s.startsWith("youtube")) out.add("youtube");
  }
  return out;
}

/** O filtro vale para alguma fonte marcada? */
export function filtroSeAplica(filtro: Filtro, ativas: Set<TagFonte>): boolean {
  const fontes = FILTRO_FONTES[filtro];
  return !fontes || fontes.some((f) => ativas.has(f));
}
