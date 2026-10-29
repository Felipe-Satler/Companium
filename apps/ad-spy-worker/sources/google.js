/**
 * Google Ads — Centro de Transparência de Anúncios do Google, via Scrape Creators.
 *
 *   anunciantes  GET /v1/google/adLibrary/advertisers/search ?query=<nome>&region=
 *   anúncios     GET /v1/google/company/ads                 ?advertiser_id=|domain=&region=&format=
 *                                                             &start_date=&end_date=&cursor=
 *   detalhe      GET /v1/google/ad                           ?url=<adUrl>
 *
 * O Centro de Transparência NÃO busca por palavra-chave — só por anunciante (nome, id ou domínio).
 * Por isso esta fonte tem dois modos, e nenhum deles é "busque o tema nos anúncios":
 *
 *   - `google`            procura ANUNCIANTES cujo nome tem o tema ("implante dentário" acha a
 *                         "Clínica Implante Dentário X") e varre os anúncios dos mais ativos. É
 *                         descoberta pelo nome, não pelo conteúdo: um anunciante que não tem o tema
 *                         no nome não aparece.
 *   - `google_advertiser` varre os anunciantes que a pessoa informou: domínio, id "AR…" ou o link
 *                         da página do anunciante no Centro de Transparência.
 *
 * A listagem custa 1 crédito por página e traz pouco: id, formato, datas e, às vezes, a imagem do
 * criativo. O texto e o vídeo vêm do DETALHE (1 crédito por anúncio), chamado só para os
 * selecionados, antes da análise — o mesmo desenho do TikTok. `get_ad_details=true` na listagem
 * traria tudo de uma vez, mas a 25 créditos por página.
 *
 * Não há arquivo de vídeo para baixar: vídeo de Google Ads é vídeo do YouTube. Quando o detalhe
 * aponta para um, a transcrição é a legenda do YouTube, como nos Shorts (`downloadable = false`).
 */

import { hasKey, scGet } from "./scrapecreators.js";
import { intOrNull, toIsoDate } from "./shared.js";

export const platform = "google";
export const downloadable = false;
const FONTE = "Google Ads";
const DIA_MS = 86400000;
/** Quantos anunciantes o modo "pelo tema" varre. Cada um pagina à parte, então é teto de gasto. */
export const MAX_ANUNCIANTES_DO_TEMA = 3;

const ADVERTISER_ID_RE = /^AR\d{10,30}$/;
const CREATIVE_ID_RE = /^CR\d{10,30}$/;
const DOMINIO_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

/**
 * Um alvo do campo "Anunciantes e sites": `AR…`, o link do anunciante no Centro de Transparência,
 * um domínio ou um link de site.
 *
 * Normaliza para a forma guardada em `settings.googleAdvertisers`: "id:AR…" ou "site:dominio.com".
 * @returns {string|null}
 */
export function parseGoogleTarget(raw) {
  const v = String(raw || "").trim();
  if (!v) return null;
  const doLink = /adstransparency\.google\.com\/advertiser\/(AR\d{10,30})/i.exec(v);
  if (doLink) return `id:${doLink[1].toUpperCase()}`;
  if (ADVERTISER_ID_RE.test(v.toUpperCase())) return `id:${v.toUpperCase()}`;
  let host = v.toLowerCase();
  try {
    if (/^https?:\/\//.test(host)) host = new URL(host).hostname;
  } catch {
    return null;
  }
  host = host.replace(/^www\./, "").replace(/\/.*$/, "");
  return DOMINIO_RE.test(host) ? `site:${host}` : null;
}

function urlOuNull(v) {
  return typeof v === "string" && /^https?:\/\//i.test(v) ? v : null;
}

/** Faixa de impressões ("250 mil – 300 mil" fica para a tela; aqui, os números). */
function faixa(obj) {
  if (!obj || typeof obj !== "object") return null;
  const min = intOrNull(obj.min ?? obj.lower);
  const max = intOrNull(obj.max ?? obj.upper);
  return min === null && max === null ? null : { min, max };
}

/** Todas as strings de um objeto, em profundidade — para achar texto e vídeo nas `variations`. */
function textos(v, out = [], depth = 0) {
  if (depth > 4 || v == null) return out;
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) textos(x, out, depth + 1);
  else if (typeof v === "object") for (const x of Object.values(v)) textos(x, out, depth + 1);
  return out;
}

const YOUTUBE_ID_RE = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

/**
 * O que dá para ler das `variations` do detalhe. Os campos dependem do tipo de criativo e a doc só
 * garante `images` — então o resto é lido por nome provável, sem quebrar se não vier.
 */
export function lerVariacoes(variations) {
  const lista = Array.isArray(variations) ? variations : [];
  const imagens = [];
  const linhas = [];
  let youtubeId = null;
  let link = null;
  for (const v of lista) {
    if (!v || typeof v !== "object") continue;
    for (const im of Array.isArray(v.images) ? v.images : []) if (urlOuNull(im)) imagens.push(im);
    for (const k of ["headline", "title", "description", "body", "text", "longHeadline", "callToAction"]) {
      const t = typeof v[k] === "string" ? v[k].trim() : "";
      if (t && !linhas.includes(t)) linhas.push(t);
    }
    for (const k of ["headlines", "descriptions"]) {
      for (const t of Array.isArray(v[k]) ? v[k] : []) {
        const s = typeof t === "string" ? t.trim() : "";
        if (s && !linhas.includes(s)) linhas.push(s);
      }
    }
    for (const s of textos(v)) {
      const yt = YOUTUBE_ID_RE.exec(s);
      if (yt && !youtubeId) youtubeId = yt[1];
    }
    for (const k of ["destinationUrl", "landingPage", "url", "link"]) {
      if (!link && urlOuNull(v[k]) && !/googlesyndication|adstransparency|youtube|youtu\.be/.test(v[k])) link = v[k];
    }
  }
  return { imagens, texto: linhas.join("\n"), youtubeId, link };
}

/** Uma linha da listagem (ou o detalhe) -> MinedAd. */
export function normalize(row, foundVia = null) {
  if (!row || typeof row !== "object") return null;
  const externalId = String(row.creativeId ?? row.creative_id ?? "").trim();
  if (!CREATIVE_ID_RE.test(externalId)) return null;
  const advertiserId = String(row.advertiserId ?? row.advertiser_id ?? "").trim() || null;

  const inicio = toIsoDate(row.firstShown);
  const fim = toIsoDate(row.lastShown);
  // Longevidade = a janela em que o anúncio foi visto, como no TikTok. Sem o início (o detalhe às
  // vezes manda `firstShown: null`), não há como dizer.
  const dias =
    inicio && fim ? Math.max(0, Math.round((Date.parse(fim) - Date.parse(inicio)) / DIA_MS)) : null;

  const formato = String(row.format || "").toLowerCase();
  const variacoes = lerVariacoes(row.variations);
  const imagem = urlOuNull(row.imageUrl) || variacoes.imagens[0] || null;

  return {
    source: platform,
    foundVia,
    externalId,
    pageName: row.advertiserName || row.advertiser_name || null,
    // O id do anunciante é o que identifica a conta para o "máximo por anunciante".
    pageId: advertiserId && ADVERTISER_ID_RE.test(advertiserId) ? advertiserId : null,
    pageProfileUri:
      advertiserId && ADVERTISER_ID_RE.test(advertiserId)
        ? `https://adstransparency.google.com/advertiser/${advertiserId}`
        : null,
    pageProfilePictureUrl: null,
    permalink:
      urlOuNull(row.adUrl) ||
      (advertiserId ? `https://adstransparency.google.com/advertiser/${advertiserId}/creative/${externalId}` : null),
    adCopy: variacoes.texto,
    title: null,
    ctaText: null,
    linkUrl: variacoes.link,
    // "text" no Google é anúncio de busca: o Centro de Transparência o mostra RENDERIZADO como
    // imagem, e é essa imagem que vem em `imageUrl`.
    displayFormat: formato ? formato.toUpperCase() : null,
    publisherPlatform: ["GOOGLE"],
    collationCount: null,
    isActive: null,
    startedRunningOn: inicio,
    daysRunning: dias,
    mediaType: formato === "video" ? "video" : imagem ? "image" : null,
    // Imagem é a própria mídia; vídeo não tem arquivo (é do YouTube).
    mediaUrl: formato === "video" ? null : imagem,
    thumbUrl: imagem,
    durationSec: null,
    metrics: {
      lastShownOn: fim,
      googleFormat: formato || null,
      impressionsRange: faixa(row.overallImpressions),
      regions: Array.isArray(row.creativeRegions)
        ? row.creativeRegions.map((r) => r?.regionCode).filter(Boolean)
        : null,
      youtubeId: variacoes.youtubeId,
    },
  };
}

function logPage(ctx, rotulo, n, json) {
  ctx.log?.(
    `google ${rotulo}: ${n} anúncio(s)` +
      (json?.credits_remaining != null ? ` (créditos restantes: ${json.credits_remaining})` : "")
  );
}

const creditos = (json) =>
  json && json.credits_charged !== null && Number.isFinite(Number(json.credits_charged))
    ? Number(json.credits_charged)
    : undefined;

/** Os parâmetros da listagem que vêm dos filtros da busca. */
function filtrosDaListagem(params) {
  const out = { region: params.country || undefined };
  if (params.mediaType === "video" || params.mediaType === "image") out.format = params.mediaType;
  if (params.startDate) out.start_date = params.startDate;
  if (params.endDate) out.end_date = params.endDate;
  return out;
}

async function paginaDoAnunciante(alvo, cursor, params, ctx, foundVia) {
  const quem = alvo.startsWith("id:") ? { advertiser_id: alvo.slice(3) } : { domain: alvo.slice(5) };
  const json = await scGet(
    "/v1/google/company/ads",
    { ...quem, ...filtrosDaListagem(params), cursor },
    { signal: ctx.signal, fonte: `${FONTE} (${alvo.slice(alvo.indexOf(":") + 1)})` }
  );
  const ads = (Array.isArray(json?.ads) ? json.ads : []).map((r) => normalize(r, foundVia)).filter(Boolean);
  logPage(ctx, alvo, ads.length, json);
  return { ads, cursor: ads.length && json?.cursor ? String(json.cursor) : null, credits: creditos(json) };
}

const base = { platform, implName: "scrapecreators", creditsPerPage: 1, available: hasKey(), downloadable };

/** Os anúncios de UM anunciante informado (id ou domínio). */
export const advertiserAds = {
  ...base,
  fetchPage(params, cursor, ctx = {}) {
    return paginaDoAnunciante(params.alvo, cursor, params, ctx, "anunciante");
  },
};

/**
 * Os anunciantes do tema, escolhidos pelo nome.
 *
 * Fica entre os do país da busca, os com mais anúncios primeiro: o "número estimado de anúncios" é
 * o único sinal de tamanho que a busca de anunciantes dá, e um anunciante com 3 anúncios não ensina
 * muito sobre criativo.
 */
export function escolherAnunciantes(json, region, max = MAX_ANUNCIANTES_DO_TEMA) {
  const lista = Array.isArray(json?.advertisers) ? json.advertisers : [];
  const validos = lista.filter((a) => ADVERTISER_ID_RE.test(String(a?.advertiser_id || "")));
  const doPais = region ? validos.filter((a) => String(a.region || "").toUpperCase() === region.toUpperCase()) : [];
  const base = doPais.length ? doPais : validos;
  return [...base]
    .sort((a, b) => (Number(b.number_of_ads_estimate) || 0) - (Number(a.number_of_ads_estimate) || 0))
    .slice(0, max)
    .map((a) => ({ id: a.advertiser_id, nome: a.name || null }));
}

/**
 * Modo "pelo tema": a 1ª chamada acha os anunciantes, as seguintes varrem um de cada vez.
 *
 * O cursor carrega a fila de anunciantes, para o "carregar mais" continuar de onde parou sem pagar a
 * busca de anunciantes de novo.
 */
export const themeAdvertisers = {
  ...base,
  async fetchPage(params, cursor, ctx = {}) {
    let estado = null;
    try {
      estado = cursor ? JSON.parse(cursor) : null;
    } catch {
      estado = null;
    }
    if (!estado) {
      const json = await scGet(
        "/v1/google/adLibrary/advertisers/search",
        { query: params.tema, region: params.country || undefined },
        { signal: ctx.signal, fonte: `${FONTE} (anunciantes)` }
      );
      const fila = escolherAnunciantes(json, params.country);
      ctx.log?.(`google: ${fila.length} anunciante(s) com "${params.tema}" no nome`);
      // A busca de anunciantes é uma página paga sem anúncio nenhum: devolve a fila e para por aqui.
      return {
        ads: [],
        cursor: fila.length ? JSON.stringify({ fila, i: 0, c: null }) : null,
        credits: creditos(json),
      };
    }
    const atual = estado.fila[estado.i];
    if (!atual) return { ads: [], cursor: null };
    const page = await paginaDoAnunciante(`id:${atual.id}`, estado.c, params, ctx, "tema");
    const proximo = page.cursor
      ? { ...estado, c: page.cursor }
      : estado.i + 1 < estado.fila.length
        ? { ...estado, i: estado.i + 1, c: null }
        : null;
    return { ...page, cursor: proximo ? JSON.stringify(proximo) : null };
  },
};

/**
 * Detalhe de um anúncio (1 crédito): o texto (lido por OCR pelo Google, então pode vir com erro),
 * as imagens, as impressões e, quando é vídeo do YouTube, a legenda como transcrição.
 */
export async function fetchAdById(externalId, ctx = {}, advertiserId = null) {
  if (!CREATIVE_ID_RE.test(String(externalId))) return null;
  const quem = advertiserId || ctx.ad?.page_id;
  if (!quem || !ADVERTISER_ID_RE.test(String(quem))) return null;
  const json = await scGet(
    "/v1/google/ad",
    { url: `https://adstransparency.google.com/advertiser/${quem}/creative/${externalId}` },
    { signal: ctx.signal, fonte: FONTE }
  );
  const ad = normalize({ ...json, creativeId: json?.creativeId || externalId, advertiserId: json?.advertiserId || quem });
  if (!ad) return null;
  const yt = ad.metrics.youtubeId;
  if (yt) {
    try {
      const leg = await scGet(
        "/v1/youtube/video/transcript",
        { url: `https://www.youtube.com/watch?v=${yt}` },
        { signal: ctx.signal, fonte: FONTE }
      );
      const texto = typeof leg?.transcript_only_text === "string" ? leg.transcript_only_text.trim() : "";
      if (texto) {
        ad.transcript = texto;
        ad.transcriptLang = leg.language || null;
      }
    } catch (err) {
      ctx.log?.(`legenda do vídeo ${yt}: ${err.message}`);
    }
  }
  return ad;
}

/** A listagem não traz texto: todo anúncio selecionado vale o crédito do detalhe, uma vez. */
export function needsHydration(row) {
  return !row.metrics?.hydrated;
}
