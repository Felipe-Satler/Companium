/**
 * TikTok — Biblioteca de Anúncios, via Scrape Creators.
 *
 *   busca    GET /v1/tiktok/ad-library/search ?query=<tema>&region=<país>&cursor=
 *   detalhe  GET /v1/tiktok/ad-library/ad     ?ad_id=<id>
 *
 * A documentação mostra DOIS formatos de anúncio, e a rota escolhe entre eles conforme os
 * parâmetros e a origem:
 *
 *   - Biblioteca pública (library.tiktok.com): `id`, `name` (anunciante), `first_shown_date` /
 *     `last_shown_date` em ms, `videos[{video_url, cover_img}]`, `estimated_audience`. SEM texto.
 *   - Creative Center "Top Ads": `ad_title`, `brand_name`, `ctr`, `like`, `comment`, `share`,
 *     `landing_page`, `video_info{cover, duration, video_url{"720p": …}}`. Sem datas.
 *
 * O normalizador lê os dois. Não deu para confirmar contra a API qual vem para `query` no Brasil, e
 * um adapter que só entendesse um formato devolveria anúncios vazios em silêncio no outro.
 *
 * A busca pública não traz o texto do anúncio; o detalhe às vezes traz (`ad_title`). Como custa 1
 * crédito por anúncio, ele é chamado só para os SELECIONADOS, antes da transcrição — e o vídeo, que
 * é onde o anúncio de TikTok de fato fala, vem pela transcrição de qualquer jeito.
 */

import { hasKey, scGet } from "./scrapecreators.js";
import { daysRunningFrom, intOrNull, toIsoDate } from "./shared.js";

export const platform = "tiktok";
const FONTE = "TikTok Ads";
const DIA_MS = 86400000;

function melhorVideo(videoUrl) {
  if (!videoUrl) return null;
  if (typeof videoUrl === "string") return videoUrl;
  // Top Ads: { "540p": url, "720p": url } — a maior resolução que existir.
  const chaves = Object.keys(videoUrl).sort((a, b) => parseInt(b, 10) - parseInt(a, 10));
  return chaves.length ? videoUrl[chaves[0]] : null;
}

function linkDaBiblioteca(id) {
  return /^\d{6,}$/.test(id) ? `https://library.tiktok.com/ads/detail/?ad_id=${id}` : null;
}

function urlOuNull(v) {
  return typeof v === "string" && /^https?:\/\//i.test(v) ? v : null;
}

/** Um anúncio em qualquer dos dois formatos -> MinedAd. */
export function normalize(row, foundVia = "busca") {
  if (!row || typeof row !== "object") return null;
  const externalId = String(row.id ?? row.ad_id ?? row.material_id ?? "").trim();
  if (!externalId || externalId === "undefined") return null;

  const video = Array.isArray(row.videos) ? row.videos[0] || {} : {};
  const vi = row.video_info || {};
  const videoUrl = video.video_url || melhorVideo(vi.video_url);
  const imagens = Array.isArray(row.image_urls) ? row.image_urls.filter(Boolean) : [];
  const thumbUrl = video.cover_img || vi.cover || imagens[0] || null;

  const inicio = toIsoDate(row.first_shown_date);
  const fim = toIsoDate(row.last_shown_date);
  // Longevidade = a janela em que o anúncio foi visto. Com as duas datas, é ela; só com o início,
  // conta até hoje (como na Meta, que só manda o início).
  const dias =
    inicio && fim
      ? Math.max(0, Math.round((Date.parse(fim) - Date.parse(inicio)) / DIA_MS))
      : daysRunningFrom(inicio);

  const permalink = urlOuNull(row.url) || linkDaBiblioteca(externalId) || urlOuNull(row.creative_center_url);

  return {
    source: "tiktok",
    foundVia,
    externalId,
    pageName: row.name || row.brand_name || row.advertiser_name || null,
    pageId: row.adv_biz_ids ? String(row.adv_biz_ids) : null,
    pageProfileUri: null,
    pageProfilePictureUrl: null,
    permalink,
    adCopy: String(row.ad_title || row.ad_text || "").trim(),
    title: null,
    ctaText: row.cta_text || null,
    linkUrl: urlOuNull(row.landing_page),
    displayFormat: videoUrl ? "VIDEO" : imagens.length ? "IMAGE" : null,
    publisherPlatform: ["TIKTOK"],
    collationCount: null,
    isActive: null,
    startedRunningOn: inicio,
    daysRunning: dias,
    mediaType: videoUrl ? "video" : imagens.length ? "image" : null,
    mediaUrl: videoUrl || imagens[0] || null,
    thumbUrl,
    durationSec: Number.isFinite(Number(vi.duration)) ? Number(vi.duration) : null,
    metrics: {
      lastShownOn: fim,
      estimatedAudience: row.estimated_audience || null,
      // `impression: 0` e `spent: ""` são "não informado" na biblioteca pública, não zero.
      impressions: intOrNull(row.impression) || null,
      spent: row.spent ? String(row.spent) : null,
      likes: intOrNull(row.like),
      comments: intOrNull(row.comment),
      shares: intOrNull(row.share),
      ctr: Number.isFinite(Number(row.ctr)) && row.ctr !== null && row.ctr !== "" ? Number(row.ctr) : null,
      creativeCenterUrl: urlOuNull(row.creative_center_url),
    },
  };
}

function linhasDa(json) {
  for (const c of [json?.ads, json?.data?.materials, json?.materials, json?.data?.ads, json?.data]) {
    if (Array.isArray(c)) return c;
  }
  return [];
}

export const search = {
  platform,
  implName: "scrapecreators",
  creditsPerPage: 1,
  available: hasKey(),
  async fetchPage(params, cursor, ctx = {}) {
    const json = await scGet(
      "/v1/tiktok/ad-library/search",
      { query: params.tema, region: params.country || "BR", cursor },
      { signal: ctx.signal, fonte: FONTE }
    );
    const ads = linhasDa(json).map((r) => normalize(r, "busca")).filter(Boolean);
    ctx.log?.(
      `tiktok: ${ads.length} anúncio(s)` +
        (json.credits_remaining != null ? ` (créditos restantes: ${json.credits_remaining})` : "")
    );
    const next = ads.length && json.has_more !== false && json.cursor ? String(json.cursor) : null;
    return { ads, cursor: next };
  },
};

/** Detalhe de um anúncio (1 crédito): completa o texto e renova o link do vídeo. */
export async function fetchAdById(externalId, ctx = {}) {
  const json = await scGet(
    "/v1/tiktok/ad-library/ad",
    { ad_id: String(externalId) },
    { signal: ctx.signal, fonte: FONTE }
  );
  const row = json?.ad || json?.data || json;
  const ad = normalize(row && (row.id || row.ad_id) ? row : { ...row, id: externalId }, "busca");
  // O detalhe pode vir de outro formato que não o da busca; sem o id original, não é o mesmo anúncio.
  if (ad) ad.externalId = String(externalId);
  return ad;
}

export function needsHydration(row) {
  return !row.metrics?.hydrated && !(row.ad_copy && row.ad_copy.trim());
}
