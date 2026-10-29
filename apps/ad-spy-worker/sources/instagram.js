/**
 * Instagram — conteúdo ORGÂNICO (posts e reels), via Scrape Creators.
 *
 * Não é biblioteca de anúncios: é o que o nicho publica e o que engaja. Entra na Mineração porque o
 * gancho que funciona no orgânico costuma ser o mesmo que vira anúncio depois, e porque o
 * concorrente pequeno muitas vezes nem anuncia — publica.
 *
 * Quatro modos de busca, cada um uma "trilha" (lane) da busca em blocos (ver ../search.js):
 *
 *   reels      GET /v2/instagram/reels/search   ?query=<tema>&page=1..11
 *   hashtag    GET /v1/instagram/search/hashtag ?hashtag=<#>&media_type=all|reels&cursor=
 *   perfil     GET /v2/instagram/user/posts     ?handle=&next_max_id=&require_play_counts=true (posts + reels, com legenda)
 *              GET /v1/instagram/user/reels     ?handle=&max_id=&require_play_counts=true      (quando só vídeo interessa)
 *   link       GET /v1/instagram/post           ?url=                   (um post colado pela pessoa)
 *
 * O Post/Reel Info serve também para COMPLETAR a peça depois de selecionada (`fetchAdById`): a rota
 * de reels do perfil quase nunca traz a legenda, e o link do vídeo na CDN expira em horas.
 *
 * Os dois primeiros modos vêm de resultados indexados pelo Google — por isso as páginas vão só até
 * 11 e o filtro de data é uma janela relativa ("última semana"), não um intervalo.
 */

import { scGet, hasKey } from "./scrapecreators.js";
import { daysRunningFrom, intOrNull, organicSignals, toIsoDate } from "./shared.js";

export const platform = "instagram";
const FONTE = "Instagram";
// As buscas indexadas pelo Google respondem 400 a partir da página 12.
const MAX_GOOGLE_PAGE = 11;

/** Hashtag a partir do tema: "Harmonização facial" -> "harmonizacaofacial". */
export function hashtagFromTema(tema) {
  return String(tema || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
}

/** Hashtag digitada pela pessoa: aceita com ou sem "#", e com acento (o Instagram aceita). */
export function cleanHashtag(raw) {
  return String(raw || "")
    .trim()
    .replace(/^#+/, "")
    .replace(/[^\p{L}\p{N}_]/gu, "")
    .slice(0, 100);
}

const SHORTCODE_RE = /instagram\.com\/(?:[A-Za-z0-9._]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/i;
const HANDLE_RE = /^@?([A-Za-z0-9._]{1,30})$/;

/**
 * Um alvo do campo "Perfis e links": `@perfil` ou o link de um post/reel.
 *
 * Normaliza para a forma guardada em `settings.instagramProfiles`: "@handle" ou "post:SHORTCODE".
 * Uma URL de PERFIL (instagram.com/handle) também vira "@handle".
 * @returns {string|null} null quando não é nenhum dos dois.
 */
export function parseInstagramTarget(raw) {
  const v = String(raw || "").trim();
  if (!v) return null;
  const post = SHORTCODE_RE.exec(v);
  if (post) return `post:${post[1]}`;
  const perfilUrl = /instagram\.com\/([A-Za-z0-9._]{1,30})\/?(?:\?.*)?$/i.exec(v);
  if (perfilUrl) return `@${perfilUrl[1].toLowerCase()}`;
  const handle = HANDLE_RE.exec(v);
  return handle ? `@${handle[1].toLowerCase()}` : null;
}

/** Janela de data das buscas do Google, a partir da data inicial do formulário. */
export function datePostedFrom(startDate) {
  const dias = daysRunningFrom(startDate);
  if (dias === null) return null;
  if (dias <= 7) return "last-week";
  if (dias <= 31) return "last-month";
  if (dias <= 366) return "last-year";
  return null;
}

function legendaDe(m) {
  if (typeof m.caption === "string") return m.caption;
  if (m.caption && typeof m.caption.text === "string") return m.caption.text;
  return m.edge_media_to_caption?.edges?.[0]?.node?.text ?? "";
}

function formatoDe(m, isVideo) {
  const pt = String(m.product_type || "").toLowerCase();
  if (pt === "clips" || (isVideo && !pt)) return "REEL";
  if (pt.includes("carousel") || m.media_type === 8 || m.edge_sidecar_to_children) return "CAROUSEL";
  return isVideo ? "VIDEO" : "IMAGE";
}

/**
 * Qualquer forma de post que a Scrape Creators devolve -> MinedAd.
 *
 * São duas famílias de resposta: a "web/GraphQL" (busca de reels, hashtag, Post Info: `shortcode`,
 * `owner`, `video_url`, `edge_*`) e a "app/v1" (posts e reels do perfil: `code`, `user`,
 * `video_versions`, `image_versions2`). Um normalizador só, que lê as duas, é o que impede um mesmo
 * post de virar duas linhas diferentes conforme a trilha que o achou.
 *
 * O id é o SHORTCODE, não o `id`/`pk`: o `id` numérico vem com e sem o sufixo `_<userid>`
 * dependendo da rota, e o shortcode é o mesmo em todas — além de ser o que monta o link.
 */
export function normalize(raw, foundVia = null, donoPadrao = null) {
  const m = raw?.media && typeof raw.media === "object" ? raw.media : raw || {};
  const shortcode = m.shortcode || m.code || null;
  if (!shortcode) return null;

  const carousel = Array.isArray(m.carousel_media) ? m.carousel_media : [];
  const first = carousel[0] || null;
  const videoVersions = m.video_versions || first?.video_versions || [];
  const videoUrl = m.video_url || videoVersions[0]?.url || null;
  const isVideo = Boolean(m.is_video ?? (m.media_type === 2 || videoUrl));
  const thumbUrl =
    m.thumbnail_src ||
    m.display_url ||
    m.image_versions2?.candidates?.[0]?.url ||
    first?.image_versions2?.candidates?.[0]?.url ||
    null;

  // `donoPadrao`: o feed do perfil manda o perfil (com seguidores) uma vez, na raiz, e não em
  // cada post — sem ele, o multiplicador sobre seguidores não existiria justo para os perfis.
  const owner = { ...(donoPadrao || {}), ...(m.owner || m.user || {}) };
  const username = owner.username || null;
  const postedOn = toIsoDate(m.taken_at_timestamp ?? m.taken_at ?? m.created_at);
  const formato = formatoDe(m, isVideo);

  return {
    source: "instagram",
    foundVia,
    externalId: String(shortcode),
    pageName: owner.full_name || username || null,
    // O @ é o que identifica a conta para o "máximo por anunciante" — estável entre rotas, ao
    // contrário do id numérico, que algumas respostas nem trazem.
    pageId: username,
    pageProfileUri: username ? `https://www.instagram.com/${username}/` : null,
    pageProfilePictureUrl: owner.profile_pic_url || null,
    permalink:
      m.url || `https://www.instagram.com/${formato === "REEL" ? "reel" : "p"}/${shortcode}/`,
    adCopy: legendaDe(m).trim(),
    title: null,
    ctaText: null,
    linkUrl: null,
    displayFormat: formato,
    publisherPlatform: ["INSTAGRAM"],
    collationCount: null,
    isActive: null,
    // Para o orgânico, a "data de início" é a da publicação e `daysRunning` é a idade do post. O
    // filtro de longevidade não se aplica a ele (ver makeQualityGate), e o card e o prompt dizem
    // "publicado há", não "no ar há".
    startedRunningOn: postedOn,
    daysRunning: daysRunningFrom(postedOn),
    mediaType: isVideo ? "video" : thumbUrl ? "image" : null,
    mediaUrl: isVideo ? videoUrl : thumbUrl,
    thumbUrl,
    durationSec: Number.isFinite(Number(m.video_duration)) ? Number(m.video_duration) : null,
    metrics: comSinais({
      views: intOrNull(
        m.video_play_count ?? m.play_count ?? m.ig_play_count ?? m.video_view_count ?? m.view_count
      ),
      likes: intOrNull(m.like_count ?? m.edge_media_preview_like?.count ?? m.edge_liked_by?.count),
      comments: intOrNull(
        m.comment_count ?? m.edge_media_to_parent_comment?.count ?? m.edge_media_to_comment?.count
      ),
      followers: intOrNull(owner.follower_count ?? owner.edge_followed_by?.count),
      // "Parceria paga" é o publi marcado: orgânico que na verdade foi pago.
      paidPartnership: m.is_paid_partnership === true ? true : null,
    }),
  };
}

/** Os números crus mais os sinais derivados (engajamento, multiplicador). */
const comSinais = (m) => ({ ...m, ...organicSignals(m) });

function normalizeAll(rows, foundVia, donoPadrao = null) {
  return (Array.isArray(rows) ? rows : []).map((r) => normalize(r, foundVia, donoPadrao)).filter(Boolean);
}

function logPage(ctx, rotulo, n, json) {
  ctx.log?.(
    `instagram ${rotulo}: ${n} post(s)` +
      (json?.credits_remaining != null ? ` (créditos restantes: ${json.credits_remaining})` : "")
  );
}

/** Próxima página das buscas indexadas pelo Google: número, de 1 a 11. */
function proximaPaginaGoogle(cursor, veio) {
  const atual = Number(cursor) || 1;
  return veio > 0 && atual < MAX_GOOGLE_PAGE ? String(atual + 1) : null;
}

const base = { platform, implName: "scrapecreators", creditsPerPage: 1, available: hasKey() };

/** Reels por palavra-chave (o tema). */
export const reelsSearch = {
  ...base,
  async fetchPage(params, cursor, ctx = {}) {
    const page = Number(cursor) || 1;
    const json = await scGet(
      "/v2/instagram/reels/search",
      { query: params.tema, page, date_posted: datePostedFrom(params.startDate) },
      { signal: ctx.signal, fonte: `${FONTE} (reels)` }
    );
    const ads = normalizeAll(json.reels, "reels");
    logPage(ctx, "reels", ads.length, json);
    return { ads, cursor: proximaPaginaGoogle(page, ads.length) };
  },
};

/** Posts e reels de uma hashtag. */
export const hashtagSearch = {
  ...base,
  async fetchPage(params, cursor, ctx = {}) {
    const json = await scGet(
      "/v1/instagram/search/hashtag",
      {
        hashtag: params.hashtag,
        media_type: params.mediaType === "video" ? "reels" : "all",
        date_posted: datePostedFrom(params.startDate),
        cursor,
      },
      { signal: ctx.signal, fonte: `${FONTE} (#${params.hashtag})` }
    );
    const ads = normalizeAll(json.posts, `hashtag:${params.hashtag}`);
    logPage(ctx, `#${params.hashtag}`, ads.length, json);
    // A rota devolve o próximo cursor mesmo na última página; página vazia encerra.
    const next = ads.length && json.cursor ? String(json.cursor) : null;
    return { ads, cursor: next && Number(next) <= MAX_GOOGLE_PAGE ? next : null };
  },
};

/**
 * Uma página do perfil pedindo as visualizações de todos os vídeos (`require_play_counts=true`).
 *
 * Sem o parâmetro, a Scrape Creators devolve 200 e cobra mesmo quando não conseguiu a contagem de
 * parte dos reels — e um reel sem visualizações cai em qualquer filtro de visualizações. Com ele, a
 * página incompleta volta 503 SEM cobrar. Aí pedimos de novo sem o parâmetro: a contagem às vezes
 * vem na segunda tentativa, e quando não vem, o resto da página (legenda, curtidas) ainda serve. No
 * pior caso custa o mesmo crédito de antes; só a demora é maior.
 */
async function paginaDoPerfil(path, query, opts, ctx) {
  try {
    return await scGet(path, { ...query, require_play_counts: true }, opts);
  } catch (err) {
    if (err?.status !== 503) throw err;
    ctx.log?.(`${opts.fonte}: página sem todas as visualizações (503, sem custo); repetindo sem exigir`);
    return scGet(path, query, opts);
  }
}

/**
 * O feed de um perfil. Com "só vídeo", usa a rota de reels, que traz os reels que o feed às vezes
 * omite — e não traz legenda: ela é completada depois, só para os que forem selecionados.
 */
export const profileFeed = {
  ...base,
  async fetchPage(params, cursor, ctx = {}) {
    const handle = params.handle;
    const soReels = params.mediaType === "video";
    const opts = { signal: ctx.signal, fonte: `${FONTE} (@${handle})` };
    const json = soReels
      ? await paginaDoPerfil("/v1/instagram/user/reels", { handle, max_id: cursor }, opts, ctx)
      : await paginaDoPerfil("/v2/instagram/user/posts", { handle, next_max_id: cursor }, opts, ctx);
    const ads = normalizeAll(json.items, `perfil:@${handle}`, json.user || null);
    logPage(ctx, `@${handle}`, ads.length, json);
    const more = soReels ? json.paging_info?.more_available : json.more_available;
    const next = soReels ? json.paging_info?.max_id : json.next_max_id;
    return { ads, cursor: ads.length && more !== false && next ? String(next) : null };
  },
};

/** Um post colado pela pessoa. Uma página, um post, fim. */
export const singlePost = {
  ...base,
  async fetchPage(params, _cursor, ctx = {}) {
    const ad = await fetchAdById(params.shortcode, ctx, "link");
    return { ads: ad ? [ad] : [], cursor: null };
  },
};

/**
 * Post/Reel Info pelo shortcode (1 crédito). Renova o link do vídeo e completa a legenda.
 * O formato `/p/<code>/` resolve reels também.
 */
export async function fetchAdById(shortcode, ctx = {}, foundVia = null) {
  const json = await scGet(
    "/v1/instagram/post",
    { url: `https://www.instagram.com/p/${shortcode}/` },
    { signal: ctx.signal, fonte: FONTE }
  );
  const media = json?.data?.xdt_shortcode_media || json?.xdt_shortcode_media || json?.data || null;
  return media ? normalize(media, foundVia) : null;
}

/**
 * Vale gastar 1 crédito para completar esta peça antes de analisar? Só quando falta a legenda —
 * reel sem texto é o caso normal da rota de reels do perfil — e nunca duas vezes.
 */
export function needsHydration(row) {
  return !row.metrics?.hydrated && !(row.ad_copy && row.ad_copy.trim());
}
