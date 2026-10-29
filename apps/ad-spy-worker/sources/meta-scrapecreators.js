/**
 * Meta Ad Library provider — Scrape Creators API.
 *
 * The drop-in replacement for meta-playwright.js. Same module shape, same `search()` signature,
 * same MinedAd output, so flipping `SPY_META_PROVIDER=scrapecreators` is the entire migration.
 *
 * It exists from day one rather than "later" because the Playwright path's main risk — Meta's WAF
 * refusing a datacenter IP — is not something we can verify from a laptop. If prod gets blocked,
 * the fix has to already be in the repo.
 *
 * Cost: 1 credit per request (not per ad), so a 50-ad run is a handful of credits. Auth is the
 * `x-api-key` header. Free signup gives 100 credits, and credits do not expire.
 *
 * Docs: https://docs.scrapecreators.com/v1/facebook/adlibrary/search/ads/
 */

import { hasKey, scGet } from "./scrapecreators.js";
import {
  adLibraryPermalink,
  intOrNull,
  metaDaysRunning,
  pickAdArchiveId,
  unixToIsoDate,
} from "./shared.js";

export const id = "meta";
export const label = "Meta Ads (Biblioteca de Anúncios)";
export const implName = "scrapecreators";
export const available = hasKey();
export const creditsPerPage = 1;

const ENDPOINT = "/v1/facebook/adLibrary/search/ads";
const AD_ENDPOINT = "/v1/facebook/adLibrary/ad";
const COMPANY_ENDPOINT = "/v1/facebook/adLibrary/company/ads";
const FONTE = "Meta Ads";
// The API pages for us; this only stops a runaway loop if `cursor` never goes null.
const MAX_PAGES = 20;

function mapMediaType(mediaType) {
  switch ((mediaType || "all").toUpperCase()) {
    case "VIDEO":
      return "VIDEO";
    case "IMAGE":
      return "IMAGE_AND_MEME";
    default:
      return "ALL";
  }
}

function pickMedia(snapshot) {
  const videos = Array.isArray(snapshot.videos) ? snapshot.videos : [];
  for (const v of videos) {
    const url = v?.video_hd_url || v?.video_sd_url || v?.video_url;
    if (url) {
      return {
        mediaType: "video",
        mediaUrl: url,
        thumbUrl: v?.video_preview_image_url || null,
      };
    }
  }
  const images = Array.isArray(snapshot.images) ? snapshot.images : [];
  for (const im of images) {
    const url = im?.original_image_url || im?.resized_image_url;
    if (url) return { mediaType: "image", mediaUrl: url, thumbUrl: url };
  }
  return { mediaType: null, mediaUrl: null, thumbUrl: null };
}

/** Scrape Creators `searchResults[]` entry -> MinedAd. */
function normalize(row) {
  const snap = row.snapshot || {};
  const startedRunningOn = unixToIsoDate(row.start_date);
  const externalId = pickAdArchiveId(row);
  return {
    source: "meta",
    externalId,
    pageName: row.page_name || snap.page_name || null,
    pageId: row.page_id ? String(row.page_id) : null,
    // NÃO usa `row.url`: a fonte manda ali uma URL de BUSCA (`search_type=page`), não um link
    // para o anúncio. Aberta, ela procura o id como se fosse uma página e não acha nada.
    permalink: adLibraryPermalink(externalId),
    adCopy: (snap.body?.text || "").trim(),
    title: snap.title || null,
    ctaText: snap.cta_text || null,
    linkUrl: snap.link_url || null,
    displayFormat: snap.display_format || null,
    publisherPlatform: Array.isArray(row.publisher_platform) ? row.publisher_platform : null,
    collationCount: intOrNull(row.collation_count),
    isActive: typeof row.is_active === "boolean" ? row.is_active : null,
    pageProfilePictureUrl: snap.page_profile_picture_url || null,
    pageProfileUri: snap.page_profile_uri || null,
    startedRunningOn,
    daysRunning: metaDaysRunning(startedRunningOn, unixToIsoDate(row.end_date), row.is_active),
    // Contexto, não filtro: tamanho da página do anunciante. Uma clínica de 2 mil curtidas com
    // anúncio de 90 dias é um sinal diferente de uma rede de 2 milhões com o mesmo anúncio.
    metrics: snap.page_like_count != null ? { pageLikes: intOrNull(snap.page_like_count) } : null,
    ...pickMedia(snap),
  };
}

/**
 * UMA página da busca = UM crédito. Retomável: devolve o cursor da próxima página.
 *
 * É a unidade com que o worker monta os blocos de 8. Como a API cobra por requisição e não por
 * anúncio, e os filtros de qualidade (longevidade, anúncios com o criativo) só podem ser aplicados
 * depois da resposta, o worker guarda o cursor e o excedente entre um "carregar mais" e outro —
 * em vez de pagar de novo por anúncios que já tinha em mãos.
 *
 * @returns {Promise<{ ads: MinedAd[], cursor: string|null, creditsRemaining: number|null }>}
 */
export async function fetchPage(params, cursor, ctx = {}) {
  const { tema, country, language, status, mediaType, startDate, endDate, sortBy } = params;
  const q = new URLSearchParams({
    query: tema,
    country: country || "BR",
    status: status || "ACTIVE",
    media_type: mapMediaType(mediaType),
    ad_type: "all",
    search_type: "keyword_unordered",
    sort_by: sortBy === "relevancy" ? "relevancy_monthly_grouped" : "total_impressions",
  });
  if (language) q.set("language", language);
  if (startDate) q.set("start_date", startDate);
  if (endDate) q.set("end_date", endDate);
  if (cursor) q.set("cursor", cursor);

  const json = await scGet(ENDPOINT, Object.fromEntries(q), { signal: ctx.signal, fonte: FONTE });
  const rows = Array.isArray(json.searchResults) ? json.searchResults : [];
  ctx.log?.(
    `scrapecreators: ${rows.length} anúncios` +
      (json.credits_remaining != null ? ` (créditos restantes: ${json.credits_remaining})` : "")
  );
  const ads = rows.map(normalize);
  const invalid = ads.filter((a) => !a.externalId).length;
  if (invalid) ctx.log?.(`scrapecreators: ${invalid} anúncio(s) sem id válido descartado(s)`);
  return {
    ads: ads.filter((a) => a.externalId),
    cursor: rows.length && json.cursor ? json.cursor : null,
    creditsRemaining: json.credits_remaining ?? null,
  };
}

/**
 * Detalhe de um anúncio pelo id (1 crédito). Usado só para renovar links de mídia expirados: a
 * CDN da Meta assina as URLs com validade de horas, e entre "achar o anúncio" e "o usuário
 * selecionar para transcrever" pode passar mais que isso.
 */
export async function fetchAdById(externalId, ctx = {}) {
  const json = await scGet(AD_ENDPOINT, { id: String(externalId) }, { signal: ctx.signal, fonte: FONTE });
  // A rota de detalhe devolve o anúncio na raiz ou embrulhado; aceita os dois formatos.
  const row = json && json.ad_archive_id ? json : json?.ad || json?.data || null;
  return row ? normalize(row) : null;
}

/**
 * Uma página de TODOS os anúncios de um anunciante — ativos e inativos — pelo id da página na
 * Biblioteca (1 crédito). Usada pelo experimento em experimentos/jev para comparar criativos
 * dentro do mesmo anunciante: lá, verba, segmento e público ficam quase fixos, e o anúncio inativo
 * traz a vida inteira dele (`end_date`), em vez da idade de um anúncio que ainda roda.
 *
 * @returns {Promise<{ ads: MinedAd[], cursor: string|null, credits: number }>}
 */
export async function fetchCompanyPage(pageId, cursor, ctx = {}) {
  const json = await scGet(
    COMPANY_ENDPOINT,
    { pageId: String(pageId), status: "ALL", cursor },
    { signal: ctx.signal, fonte: FONTE }
  );
  const rows = Array.isArray(json.results) ? json.results : Array.isArray(json.searchResults) ? json.searchResults : [];
  const ads = rows.map(normalize).filter((a) => a.externalId);
  return {
    ads,
    cursor: rows.length && json.cursor ? String(json.cursor) : null,
    credits: Number.isFinite(Number(json.credits_charged)) ? Number(json.credits_charged) : 1,
  };
}

/** Gerador sobre fetchPage, mantido para o CLI (`sources/cli.js`). */
export async function* search(params, ctx = {}) {
  const limit = params.limit || 20;
  let cursor = null;
  let yielded = 0;
  const seen = new Set();
  for (let pages = 0; pages < MAX_PAGES && yielded < limit; pages += 1) {
    if (ctx.signal?.aborted) throw new Error("cancelado");
    const page = await fetchPage(params, cursor, ctx);
    for (const ad of page.ads) {
      if (yielded >= limit || seen.has(ad.externalId)) continue;
      seen.add(ad.externalId);
      yield ad;
      yielded += 1;
      ctx.onProgress?.(1);
    }
    if (!page.cursor) break;
    cursor = page.cursor;
  }
}
