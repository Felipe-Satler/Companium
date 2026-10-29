/**
 * YouTube Shorts — conteúdo ORGÂNICO, via Scrape Creators.
 *
 *   busca    GET /v1/youtube/search          ?query=<tema>&type=shorts&region=&sortBy=&uploadDate=
 *   hashtag  GET /v1/youtube/search/hashtag  ?hashtag=<#>&type=shorts&continuationToken=
 *   canal    GET /v1/youtube/channel/shorts  ?handle=|channelId=&sort=popular&continuationToken=
 *   detalhe  GET /v1/youtube/video           ?url=            (um short colado; completa descrição)
 *   legenda  GET /v1/youtube/video/transcript ?url=           (0 crédito quando não há legenda)
 *
 * A diferença que muda o pipeline: NENHUMA rota devolve o link do arquivo de vídeo. Sem mp4 não há
 * Whisper, então a transcrição de um short é a LEGENDA do próprio YouTube (manual ou automática),
 * buscada só para os selecionados, no mesmo passo que completa o texto das outras fontes
 * (`fetchAdById` -> `transcript`). Por isso `downloadable = false`: o runner não tenta baixar.
 */

import { hasKey, scGet } from "./scrapecreators.js";
import { daysRunningFrom, intOrNull, organicSignals, toIsoDate } from "./shared.js";

export const platform = "youtube";
/** O runner não baixa vídeo desta fonte — ver o cabeçalho. */
export const downloadable = false;
const FONTE = "YouTube Shorts";

const ID_RE = /^[A-Za-z0-9_-]{6,20}$/;

/**
 * Um alvo do campo "Canais e links", normalizado para `settings.youtubeChannels`:
 *   "@handle"            canal pelo @ (ou URL youtube.com/@handle)
 *   "channel:UC…"        canal pelo id (URL youtube.com/channel/UC…)
 *   "short:<id>"         um short/vídeo (youtube.com/shorts/<id>, youtu.be/<id>, watch?v=<id>)
 * @returns {string|null}
 */
export function parseYoutubeTarget(raw) {
  const v = String(raw || "").trim();
  if (!v) return null;
  const video =
    /youtube\.com\/shorts\/([A-Za-z0-9_-]{6,20})/i.exec(v) ||
    /youtu\.be\/([A-Za-z0-9_-]{6,20})/i.exec(v) ||
    /[?&]v=([A-Za-z0-9_-]{6,20})/i.exec(v);
  if (video) return `short:${video[1]}`;
  const canalId = /youtube\.com\/channel\/(UC[A-Za-z0-9_-]{10,})/i.exec(v);
  if (canalId) return `channel:${canalId[1]}`;
  const handleUrl = /youtube\.com\/@([A-Za-z0-9._-]{2,100})/i.exec(v);
  if (handleUrl) return `@${handleUrl[1].toLowerCase()}`;
  const handle = /^@([A-Za-z0-9._-]{2,100})$/.exec(v);
  return handle ? `@${handle[1].toLowerCase()}` : null;
}

/** Janela `uploadDate` da busca, a partir da data inicial do formulário. */
export function uploadDateFrom(startDate) {
  const dias = daysRunningFrom(startDate);
  if (dias === null) return null;
  if (dias <= 1) return "today";
  if (dias <= 7) return "this_week";
  if (dias <= 31) return "this_month";
  if (dias <= 366) return "this_year";
  return null;
}

/**
 * Qualquer item de vídeo das rotas acima -> MinedAd.
 *
 * `canal` entra quando a rota não traz o canal em cada item (a de shorts do canal).
 */
export function normalize(item, foundVia = null, canal = null) {
  if (!item || typeof item !== "object") return null;
  const id = String(item.id || item.videoId || "").trim();
  if (!ID_RE.test(id)) return null;

  const ch = item.channel || canal || {};
  const handle = ch.handle ? String(ch.handle).replace(/^@/, "") : null;
  const postedOn = toIsoDate(item.publishDate || item.publishedTime || item.uploadDate);
  const duracao = Number.isFinite(Number(item.lengthSeconds))
    ? Number(item.lengthSeconds)
    : Number.isFinite(Number(item.durationMs))
      ? Number(item.durationMs) / 1000
      : null;
  // A legenda vem no detalhe às vezes (`transcript_only_text`); vale como transcrição.
  const legenda = typeof item.transcript_only_text === "string" ? item.transcript_only_text.trim() : "";

  return {
    source: "youtube",
    foundVia,
    externalId: id,
    pageName: ch.title || (handle ? `@${handle}` : null),
    pageId: handle || ch.id || null,
    pageProfileUri: handle
      ? `https://www.youtube.com/@${handle}`
      : ch.id
        ? `https://www.youtube.com/channel/${ch.id}`
        : null,
    pageProfilePictureUrl: ch.thumbnail || null,
    permalink: `https://www.youtube.com/shorts/${id}`,
    // O título é a manchete do short; a descrição faz o papel da legenda do post.
    title: item.title ? String(item.title).trim() : null,
    adCopy: String(item.description || "").trim(),
    ctaText: null,
    linkUrl: null,
    displayFormat: "SHORT",
    publisherPlatform: ["YOUTUBE"],
    collationCount: null,
    isActive: null,
    startedRunningOn: postedOn,
    daysRunning: daysRunningFrom(postedOn),
    mediaType: "video",
    // Sem link de arquivo: as rotas não o expõem (ver o cabeçalho).
    mediaUrl: null,
    thumbUrl: item.thumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    durationSec: duracao,
    transcript: legenda || null,
    metrics: (() => {
      const m = {
        views: intOrNull(item.viewCountInt),
        likes: intOrNull(item.likeCountInt),
        comments: intOrNull(item.commentCountInt),
        followers: intOrNull(ch.subscriberCount ?? ch.subscriberCountInt),
        paidPartnership: item.isPaidPromotion === true ? true : null,
      };
      return { ...m, ...organicSignals(m) };
    })(),
  };
}

/** Os shorts de uma resposta de busca: o array `shorts`, mais o que vier marcado como short em outros. */
function shortsDa(json) {
  const vistos = new Set();
  const out = [];
  const add = (it) => {
    if (it && !vistos.has(it.id)) {
      vistos.add(it.id);
      out.push(it);
    }
  };
  for (const it of json?.shorts || []) add(it);
  for (const it of json?.videos || []) if (it?.type === "short") add(it);
  for (const shelf of json?.shelves || []) for (const it of shelf?.items || []) if (it?.type === "short") add(it);
  return out;
}

function logPage(ctx, rotulo, n, json) {
  ctx.log?.(
    `youtube ${rotulo}: ${n} short(s)` +
      (json?.credits_remaining != null ? ` (créditos restantes: ${json.credits_remaining})` : "")
  );
}

const base = { platform, implName: "scrapecreators", creditsPerPage: 1, available: hasKey() };

/** O crédito que a rota diz ter cobrado; a busca com `includeExtras` não documenta o custo. */
const cobrado = (json) => (Number.isFinite(Number(json?.credits_charged)) ? Number(json.credits_charged) : undefined);

export const search = {
  ...base,
  async fetchPage(params, cursor, ctx = {}) {
    const json = await scGet(
      "/v1/youtube/search",
      {
        query: params.tema,
        type: "shorts",
        region: params.country || "BR",
        // "impressions" do formulário é "o que mais circulou" — no YouTube, o mais visto.
        sortBy: params.sortBy === "relevancy" ? "relevance" : "popular",
        uploadDate: uploadDateFrom(params.startDate),
        // Curtidas, comentários e descrição já na busca: sem isso o short chega sem texto nenhum
        // além do título, e o filtro de texto mínimo e o card ficariam cegos.
        includeExtras: "true",
        continuationToken: cursor,
      },
      { signal: ctx.signal, fonte: FONTE }
    );
    const ads = shortsDa(json).map((it) => normalize(it, "shorts")).filter(Boolean);
    logPage(ctx, "busca", ads.length, json);
    return { ads, cursor: ads.length && json.continuationToken ? String(json.continuationToken) : null, credits: cobrado(json) };
  },
};

export const hashtagSearch = {
  ...base,
  async fetchPage(params, cursor, ctx = {}) {
    const json = await scGet(
      "/v1/youtube/search/hashtag",
      { hashtag: params.hashtag, type: "shorts", continuationToken: cursor },
      { signal: ctx.signal, fonte: `${FONTE} (#${params.hashtag})` }
    );
    // Com type=shorts a rota ainda pode misturar vídeo longo; só o que for short entra.
    const itens = (json?.videos || []).filter((it) => !it?.type || it.type === "short");
    const ads = itens.map((it) => normalize(it, `hashtag:${params.hashtag}`)).filter(Boolean);
    logPage(ctx, `#${params.hashtag}`, ads.length, json);
    return { ads, cursor: ads.length && json.continuationToken ? String(json.continuationToken) : null, credits: cobrado(json) };
  },
};

/** Os shorts de um canal, dos mais vistos para os menos — é o que interessa numa pesquisa. */
export const channelShorts = {
  ...base,
  async fetchPage(params, cursor, ctx = {}) {
    const json = await scGet(
      "/v1/youtube/channel/shorts",
      {
        handle: params.handle || null,
        channelId: params.channelId || null,
        sort: "popular",
        continuationToken: cursor,
      },
      { signal: ctx.signal, fonte: `${FONTE} (${params.handle ? `@${params.handle}` : params.channelId})` }
    );
    // Esta rota não manda o canal em cada item.
    const canal = { handle: params.handle || null, id: params.channelId || null, title: params.handle ? `@${params.handle}` : null };
    const ads = (json?.shorts || []).map((it) => normalize(it, `canal:${params.handle ? `@${params.handle}` : params.channelId}`, canal)).filter(Boolean);
    logPage(ctx, params.handle || params.channelId, ads.length, json);
    return { ads, cursor: ads.length && json.continuationToken ? String(json.continuationToken) : null, credits: cobrado(json) };
  },
};

/** Um short colado. Uma página, um short, fim. */
export const singleShort = {
  ...base,
  async fetchPage(params, _cursor, ctx = {}) {
    const json = await scGet(
      "/v1/youtube/video",
      { url: `https://www.youtube.com/shorts/${params.videoId}` },
      { signal: ctx.signal, fonte: FONTE }
    );
    const ad = normalize(json?.video || json?.data || json, "link");
    return { ads: ad ? [ad] : [], cursor: null };
  },
};

/**
 * Completa um short selecionado: descrição e números pelo detalhe (1 crédito) e a LEGENDA, que é a
 * transcrição desta fonte (1 crédito; 0 quando o vídeo não tem legenda). Sem legenda, `transcript`
 * fica nulo e a análise diz "(não disponível)" — o mesmo de um anúncio sem fala.
 */
export async function fetchAdById(videoId, ctx = {}) {
  const url = `https://www.youtube.com/shorts/${videoId}`;
  const det = await scGet("/v1/youtube/video", { url }, { signal: ctx.signal, fonte: FONTE });
  const ad = normalize(det?.video || det?.data || det, null) || { externalId: String(videoId), metrics: {} };
  if (!ad.transcript) {
    try {
      const leg = await scGet("/v1/youtube/video/transcript", { url }, { signal: ctx.signal, fonte: FONTE });
      const texto = typeof leg?.transcript_only_text === "string" ? leg.transcript_only_text.trim() : "";
      if (texto) {
        ad.transcript = texto;
        ad.transcriptLang = leg.language || null;
      }
    } catch (err) {
      // Sem legenda não é erro da peça: ela segue com título e descrição.
      ctx.log?.(`legenda do short ${videoId}: ${err.message}`);
    }
  }
  return ad;
}

/** Todo short selecionado passa uma vez pelo detalhe: é dali que vem a transcrição. */
export function needsHydration(row) {
  return !row.metrics?.hydrated;
}
