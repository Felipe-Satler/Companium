/**
 * TikTok — conteúdo ORGÂNICO (vídeos e carrosséis de foto), via Scrape Creators.
 *
 * O par orgânico do `tiktok-ads.js`, pelo mesmo motivo do Instagram: o gancho que engaja no
 * orgânico costuma virar anúncio depois, e muito concorrente pequeno só publica.
 *
 * Quatro modos de busca, cada um uma "trilha" (lane) da busca em blocos (ver ../search.js):
 *
 *   busca    GET /v1/tiktok/search/keyword   ?query=<tema>&region=&sort_by=&date_posted=&cursor=
 *   hashtag  GET /v1/tiktok/search/hashtag   ?hashtag=<sem #>&region=&cursor=
 *   perfil   GET /v3/tiktok/profile/videos   ?handle=&sort_by=popular&region=&max_cursor=
 *   link     GET /v2/tiktok/video            ?url=                      (um vídeo colado pela pessoa)
 *
 * A PLATAFORMA gravada é `tiktok_organic`, e não `tiktok`: `tiktok` já é a Biblioteca de Anúncios,
 * e os filtros de qualidade decidem pelo `source` — um vídeo orgânico marcado como `tiktok` cairia
 * no filtro de longevidade de anúncio e no de alcance estimado, que ele não tem como passar.
 *
 * `region` NÃO filtra por país: só diz de onde a Scrape Creators faz a consulta (o que muda o que o
 * TikTok mostra, mas não garante nada). A documentação é explícita nisso.
 *
 * Todas as rotas devolvem o mesmo objeto do app ("aweme"): `aweme_id`, `desc`, `author`,
 * `statistics`, `video`. A busca por palavra-chave embrulha cada um em `{ aweme_info }`.
 */

import { hasKey, scGet } from "./scrapecreators.js";
import { daysRunningFrom, intOrNull, organicSignals, toIsoDate } from "./shared.js";

export const platform = "tiktok_organic";
const FONTE = "TikTok";

const HANDLE_RE = /^@?([A-Za-z0-9._]{2,24})$/;
const VIDEO_URL_RE = /tiktok\.com\/@([A-Za-z0-9._]{2,24})\/(video|photo)\/(\d{8,25})/i;
const SHORT_URL_RE = /^https?:\/\/(?:vm|vt)\.tiktok\.com\/([A-Za-z0-9]{5,20})\/?/i;
const SHORT_T_RE = /^https?:\/\/(?:www\.)?tiktok\.com\/t\/([A-Za-z0-9]{5,20})\/?/i;

/**
 * Um alvo do campo "Perfis e links": `@perfil` ou o link de um vídeo.
 *
 * Normaliza para a forma guardada em `settings.tiktokProfiles`:
 *   "@handle"                      perfil
 *   "video:<handle>/<id>"          link completo de vídeo ou carrossel
 *   "curto:<vm|vt|t>/<código>"     link curto de compartilhamento (o do botão "copiar link" do app)
 *
 * O link curto é guardado como código, não como URL: o que entra em `settings` vira parâmetro de
 * uma chamada paga, e remontar a URL a partir de partes validadas é o que impede um texto
 * arbitrário de chegar lá.
 *
 * @returns {string|null} null quando não é nenhum deles.
 */
export function parseTiktokTarget(raw) {
  const v = String(raw || "").trim();
  if (!v) return null;
  const video = VIDEO_URL_RE.exec(v);
  if (video) return `video:${video[1].toLowerCase()}/${video[3]}`;
  const vm = SHORT_URL_RE.exec(v);
  if (vm) return `curto:${/^https?:\/\/vt\./i.test(v) ? "vt" : "vm"}/${vm[1]}`;
  const t = SHORT_T_RE.exec(v);
  if (t) return `curto:t/${t[1]}`;
  const perfilUrl = /tiktok\.com\/@([A-Za-z0-9._]{2,24})\/?(?:\?.*)?$/i.exec(v);
  if (perfilUrl) return `@${perfilUrl[1].toLowerCase()}`;
  const handle = HANDLE_RE.exec(v);
  return handle ? `@${handle[1].toLowerCase()}` : null;
}

/** A URL que a rota de detalhe recebe, a partir de um alvo "video:…" ou "curto:…". */
export function urlDoAlvo(alvo) {
  const video = /^video:([A-Za-z0-9._]{2,24})\/(\d{8,25})$/.exec(alvo || "");
  if (video) return `https://www.tiktok.com/@${video[1]}/video/${video[2]}`;
  const curto = /^curto:(vm|vt|t)\/([A-Za-z0-9]{5,20})$/.exec(alvo || "");
  if (!curto) return null;
  return curto[1] === "t"
    ? `https://www.tiktok.com/t/${curto[2]}/`
    : `https://${curto[1]}.tiktok.com/${curto[2]}/`;
}

/** Janela de data da busca por palavra-chave, a partir da data inicial do formulário. */
export function datePostedFrom(startDate) {
  const dias = daysRunningFrom(startDate);
  if (dias === null) return null;
  if (dias <= 1) return "yesterday";
  if (dias <= 7) return "this-week";
  if (dias <= 31) return "this-month";
  if (dias <= 92) return "last-3-months";
  if (dias <= 183) return "last-6-months";
  return null;
}

const primeira = (lista) => (Array.isArray(lista?.url_list) ? lista.url_list.find(Boolean) || null : null);

/** Os números crus mais os sinais derivados (engajamento, multiplicador). */
const comSinais = (m) => ({ ...m, ...organicSignals(m) });

/**
 * Um "aweme" (ou o embrulho `{ aweme_info }` da busca) -> MinedAd.
 *
 * O id é o `aweme_id`: é o mesmo em todas as rotas e é o que monta o link, então o mesmo vídeo
 * achado pela busca e pela hashtag vira uma linha só.
 */
export function normalize(raw, foundVia = null) {
  const a = raw?.aweme_info && typeof raw.aweme_info === "object" ? raw.aweme_info : raw || {};
  const externalId = String(a.aweme_id ?? "").trim();
  if (!/^\d{8,25}$/.test(externalId)) return null;

  const autor = a.author || {};
  const handle = autor.unique_id ? String(autor.unique_id) : null;
  const st = a.statistics || {};
  const v = a.video || {};

  // Carrossel de fotos: `image_post_info.images[]`. Não tem vídeo para transcrever.
  const fotos = Array.isArray(a.image_post_info?.images) ? a.image_post_info.images : [];
  const fotoUrl = primeira(fotos[0]?.display_image) || primeira(fotos[0]?.owner_watermark_image);
  // `play_addr` é o arquivo sem marca d'água; `download_addr` vem com ela e é a reserva.
  const videoUrl = fotos.length ? null : primeira(v.play_addr) || primeira(v.download_addr);
  const thumbUrl = primeira(v.cover) || primeira(v.origin_cover) || fotoUrl || null;

  // `video.duration` vem em milissegundos; segundos aparecem em respostas aparadas.
  const dur = Number(v.duration);
  const durationSec = Number.isFinite(dur) && dur > 0 ? Math.round(dur > 1000 ? dur / 1000 : dur) : null;

  const postedOn = toIsoDate(a.create_time);
  // 0 seguidores é "não informado": a rota de hashtag e a de detalhe mandam 0 até para contas de
  // dezenas de milhões. Tratar como zero daria engajamento infinito por seguidor.
  const followers = intOrNull(autor.follower_count) || null;

  return {
    source: platform,
    foundVia,
    externalId,
    pageName: autor.nickname || handle || null,
    // O @ identifica a conta para o "máximo por anunciante", como no Instagram.
    pageId: handle,
    pageProfileUri: handle ? `https://www.tiktok.com/@${handle}` : null,
    pageProfilePictureUrl: primeira(autor.avatar_thumb) || primeira(autor.avatar_medium),
    // Montado, e não o `share_url` da resposta: ele vem vazio em várias rotas.
    permalink: handle ? `https://www.tiktok.com/@${handle}/${fotos.length ? "photo" : "video"}/${externalId}` : null,
    adCopy: String(a.desc || "").trim(),
    title: null,
    ctaText: null,
    linkUrl: null,
    displayFormat: fotos.length ? "CAROUSEL" : "VIDEO",
    publisherPlatform: ["TIKTOK"],
    collationCount: null,
    isActive: null,
    // Como no Instagram: a "data de início" é a da publicação, e o filtro de longevidade não vale.
    startedRunningOn: postedOn,
    daysRunning: daysRunningFrom(postedOn),
    mediaType: videoUrl ? "video" : fotoUrl ? "image" : null,
    mediaUrl: videoUrl || fotoUrl || null,
    thumbUrl,
    durationSec,
    metrics: comSinais({
      views: intOrNull(st.play_count),
      likes: intOrNull(st.digg_count),
      comments: intOrNull(st.comment_count),
      shares: intOrNull(st.share_count),
      saves: intOrNull(st.collect_count),
      followers,
      // Vídeo orgânico que o próprio TikTok marca como anúncio (impulsionado).
      paidPartnership: a.is_ads === true ? true : null,
    }),
  };
}

function normalizeAll(rows, foundVia) {
  return (Array.isArray(rows) ? rows : []).map((r) => normalize(r, foundVia)).filter(Boolean);
}

function logPage(ctx, rotulo, n, json) {
  ctx.log?.(
    `tiktok ${rotulo}: ${n} vídeo(s)` +
      (json?.credits_remaining != null ? ` (créditos restantes: ${json.credits_remaining})` : "")
  );
}

/** `credits_charged`, quando a rota diz: página vazia e cache podem custar diferente de 1. */
const creditos = (json) =>
  Number.isFinite(Number(json?.credits_charged)) && json.credits_charged !== null
    ? Number(json.credits_charged)
    : undefined;

/** `has_more` vem como 1/0 (ou nem vem, na busca por palavra-chave). Só o "não" explícito encerra. */
const temMais = (json) => json?.has_more !== 0 && json?.has_more !== false;

const base = { platform, implName: "scrapecreators", creditsPerPage: 1, available: hasKey() };

/** Vídeos por palavra-chave (o tema). */
export const keywordSearch = {
  ...base,
  async fetchPage(params, cursor, ctx = {}) {
    const json = await scGet(
      "/v1/tiktok/search/keyword",
      {
        query: params.tema,
        region: params.country || "BR",
        // "Mais curtidos" é o equivalente de "maior alcance" aqui: a rota não ordena por visualização.
        sort_by: params.sortBy === "relevancy" ? "relevance" : "most-liked",
        date_posted: datePostedFrom(params.startDate),
        cursor,
      },
      { signal: ctx.signal, fonte: `${FONTE} (busca)` }
    );
    const ads = normalizeAll(json.search_item_list, "videos");
    logPage(ctx, "busca", ads.length, json);
    const next = ads.length && temMais(json) && json.cursor != null ? String(json.cursor) : null;
    return { ads, cursor: next, credits: creditos(json) };
  },
};

/** Vídeos de uma hashtag. */
export const hashtagSearch = {
  ...base,
  async fetchPage(params, cursor, ctx = {}) {
    const json = await scGet(
      "/v1/tiktok/search/hashtag",
      { hashtag: params.hashtag, region: params.country || "BR", cursor },
      { signal: ctx.signal, fonte: `${FONTE} (#${params.hashtag})` }
    );
    const ads = normalizeAll(json.aweme_list, `hashtag:${params.hashtag}`);
    logPage(ctx, `#${params.hashtag}`, ads.length, json);
    const next = ads.length && temMais(json) && json.cursor != null ? String(json.cursor) : null;
    return { ads, cursor: next, credits: creditos(json) };
  },
};

/** Os vídeos de um perfil, dos mais populares para os menos. */
export const profileVideos = {
  ...base,
  async fetchPage(params, cursor, ctx = {}) {
    const handle = params.handle;
    const json = await scGet(
      "/v3/tiktok/profile/videos",
      {
        handle,
        sort_by: "popular",
        region: params.country || "BR",
        // Fixado é escolha do dono do perfil, não desempenho; e a doc pede o mesmo valor em todas
        // as páginas.
        include_pinned: false,
        max_cursor: cursor,
      },
      { signal: ctx.signal, fonte: `${FONTE} (@${handle})` }
    );
    const ads = normalizeAll(json.aweme_list, `perfil:@${handle}`);
    logPage(ctx, `@${handle}`, ads.length, json);
    // Sem fixados a página pode vir vazia com mais adiante: quem manda é `has_more`, não o tamanho.
    const mais = json?.has_more === 1 || json?.has_more === true;
    return { ads, cursor: mais && json.max_cursor ? String(json.max_cursor) : null, credits: creditos(json) };
  },
};

async function detalhe(url, ctx, foundVia) {
  const json = await scGet("/v2/tiktok/video", { url }, { signal: ctx.signal, fonte: FONTE });
  return json?.aweme_detail ? normalize(json.aweme_detail, foundVia) : null;
}

/** Um vídeo colado pela pessoa. Uma página, um vídeo, fim. */
export const singleVideo = {
  ...base,
  async fetchPage(params, _cursor, ctx = {}) {
    const ad = await detalhe(params.url, ctx, "link");
    return { ads: ad ? [ad] : [], cursor: null };
  },
};

/**
 * Detalhe de um vídeo pelo id (1 crédito). Serve para renovar o link do arquivo, que a CDN do
 * TikTok assina com validade de horas. A URL não precisa do @ certo: o TikTok resolve pelo id.
 */
export async function fetchAdById(externalId, ctx = {}, foundVia = null) {
  if (!/^\d{8,25}$/.test(String(externalId))) return null;
  return detalhe(`https://www.tiktok.com/@_/video/${externalId}`, ctx, foundVia);
}
