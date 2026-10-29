/**
 * Source registry.
 *
 * Every provider is an async generator with the same signature, so nothing downstream of this
 * directory knows which platform a row came from:
 *
 *   async function* search(params, ctx) -> yields MinedAd
 *
 *   params: { tema, country, language, status, mediaType, startDate, endDate,
 *             limit, minDaysRunning, maxPerAdvertiser, sortBy, minCopyChars }
 *   ctx:    { signal, log, onProgress }
 *
 * That uniformity is the whole point: swapping the Meta implementation (Playwright <-> Scrape
 * Creators) is one env var, and a new source is a new file plus a case in `lanesFor`.
 *
 * The paged contract that `search.js` actually drives is `fetchPage(params, cursor, ctx)` ->
 * `{ ads, cursor }`, with `creditsPerPage` saying what each call costs. Only the Playwright Meta
 * provider still uses the generator form.
 *
 * @typedef {Object} MinedAd
 * @property {'meta'|'instagram'|'tiktok'|'tiktok_organic'|'youtube'|'google'} source   platform, not the lane
 * @property {string}   [foundVia]          which lane found it (reels, hashtag:x, perfil:@x, link)
 * @property {object}   [metrics]           platform-specific numbers (views, likes, ctr, audience…)
 * @property {number}   [durationSec]
 * @property {string}   externalId          platform ad id (ad_archive_id on Meta)
 * @property {string}   [pageName]          advertiser
 * @property {string}   [pageId]
 * @property {string}   [permalink]         link back to the ad in the public library
 * @property {string}   [adCopy]            primary text
 * @property {string}   [title]
 * @property {string}   [ctaText]
 * @property {string}   [linkUrl]
 * @property {string}   [displayFormat]
 * @property {string[]} [publisherPlatform]
 * @property {string}   [startedRunningOn]  YYYY-MM-DD
 * @property {number}   [daysRunning]
 * @property {'video'|'image'} [mediaType]
 * @property {string}   [mediaUrl]          transient: the URL to download, never persisted
 * @property {string}   [thumbUrl]          transient
 */

import { META_PROVIDER } from "../config.js";
import * as google from "./google.js";
import * as instagram from "./instagram.js";
import * as metaPlaywright from "./meta-playwright.js";
import * as metaScrapeCreators from "./meta-scrapecreators.js";
import * as tiktokAds from "./tiktok-ads.js";
import * as tiktokOrganic from "./tiktok-organic.js";
import * as youtube from "./youtube.js";

export function metaProvider() {
  return META_PROVIDER === "scrapecreators" ? metaScrapeCreators : metaPlaywright;
}

/**
 * Só os anúncios da Biblioteca da Meta que rodam num posicionamento (ex.: INSTAGRAM).
 *
 * A Scrape Creators não filtra posicionamento na requisição — `publisher_platform` só existe na
 * resposta —, então o filtro é aplicado depois, página a página, e a página custa o mesmo crédito.
 * Posicionamento desconhecido fica de fora: é um filtro de "roda no Instagram", e "não sei" não é
 * isso. As peças continuam `source: "meta"` (são anúncios da Biblioteca da Meta, com id, link e
 * replicação de lá); `foundVia` é o que diz que vieram por esta trilha.
 */
export function onlyPlacement(provider, placement, foundVia) {
  const roda = (ad) => Array.isArray(ad.publisherPlatform) && ad.publisherPlatform.includes(placement);
  const marca = (ad) => ({ ...ad, foundVia });
  const out = {
    implName: provider.implName,
    creditsPerPage: provider.creditsPerPage,
    available: provider.available,
    fetchAdById: provider.fetchAdById,
  };
  if (typeof provider.fetchPage === "function") {
    out.fetchPage = async (params, cursor, ctx) => {
      const page = await provider.fetchPage(params, cursor, ctx);
      const ads = page.ads.filter(roda).map(marca);
      if (ads.length < page.ads.length) {
        ctx?.log?.(`${placement}: ${ads.length} de ${page.ads.length} anúncio(s) rodam no posicionamento`);
      }
      return { ...page, ads };
    };
  } else {
    out.search = async function* (params, ctx) {
      for await (const ad of provider.search(params, ctx)) if (roda(ad)) yield marca(ad);
    };
  }
  return out;
}

/**
 * Os anúncios de UM anunciante, pelo id da página dele na Biblioteca da Meta ("minerar este
 * anunciante").
 *
 * Sempre pela Scrape Creators, qualquer que seja o provedor da busca por palavra-chave: a rota
 * "Company Ads" não tem equivalente no Playwright. O `tema` não entra — aqui não há palavra-chave,
 * quem define o resultado é a página.
 */
export const advertiserProvider = {
  implName: "scrapecreators",
  creditsPerPage: 1,
  available: metaScrapeCreators.available,
  fetchAdById: metaScrapeCreators.fetchAdById,
  async fetchPage(params, cursor, ctx) {
    const page = await metaScrapeCreators.fetchCompanyPage(params.pageId, cursor, ctx);
    return { ...page, ads: page.ads.map((ad) => ({ ...ad, foundVia: "anunciante" })) };
  },
};

/**
 * O anunciante de uma busca "minerar este anunciante", validado. `null` = não é um.
 *
 * O id da página é numérico na Biblioteca da Meta; o que não for (o @ de um perfil do Instagram, o
 * id de canal do YouTube) não serve para a rota e é recusado aqui, antes de gastar crédito.
 * `fromRunId` é a busca de onde a pessoa veio, para a tela oferecer o caminho de volta.
 */
export function parseAdvertiser(raw) {
  const pageId = String(raw?.pageId ?? "").trim();
  if (!/^\d{5,25}$/.test(pageId)) return null;
  const fromRunId = String(raw?.fromRunId ?? "").trim();
  return {
    pageId,
    pageName: String(raw?.pageName ?? "").trim().slice(0, 200) || null,
    fromRunId: /^[0-9a-f-]{36}$/i.test(fromRunId) ? fromRunId : null,
  };
}

export const PROVIDERS = {
  meta: metaProvider(),
  instagram,
  tiktok: tiktokAds,
  tiktok_organic: tiktokOrganic,
  youtube,
  google,
};

/**
 * O que a pessoa pode pedir em `run.sources`. Uma fonte de PLATAFORMA (meta, tiktok) ou um MODO do
 * Instagram — os três modos são escolhas independentes no formulário, e cada um vira trilha própria.
 */
export const SOURCE_IDS = [
  "meta",
  "tiktok",
  "tiktok_videos",
  "tiktok_hashtag",
  "tiktok_profile",
  "instagram_ads",
  "instagram_reels",
  "instagram_hashtag",
  "instagram_profile",
  "youtube_shorts",
  "youtube_hashtag",
  "youtube_channel",
  // Não é uma opção do formulário: nasce do botão "minerar este anunciante" de um card.
  "meta_advertiser",
  // Google Ads: o Centro de Transparência só busca por anunciante, então os dois modos são isso.
  "google",
  "google_advertiser",
];

/** Para as notas da busca e para os logs. */
export const SOURCE_LABELS = {
  meta: "Meta Ads",
  tiktok: "TikTok Ads",
  tiktok_videos: "TikTok (vídeos)",
  tiktok_hashtag: "TikTok (hashtag)",
  tiktok_profile: "TikTok (perfis)",
  instagram_ads: "Instagram (anúncios)",
  instagram_reels: "Instagram (reels)",
  instagram_hashtag: "Instagram (hashtag)",
  instagram_profile: "Instagram (perfis)",
  youtube_shorts: "YouTube Shorts",
  youtube_hashtag: "YouTube Shorts (hashtag)",
  youtube_channel: "YouTube Shorts (canais)",
  meta_advertiser: "Meta Ads (anunciante)",
  google: "Google Ads (anunciantes do tema)",
  google_advertiser: "Google Ads (anunciantes e sites)",
};

/**
 * As trilhas de busca de uma run.
 *
 * Uma trilha = uma consulta paginada a uma rota: tem cursor próprio, se esgota sozinha e gasta
 * crédito por página. `search.js` só conhece trilhas; quem decide quantas e quais é esta função.
 * "instagram_profile" vira uma trilha POR alvo (cada perfil tem seu próprio cursor).
 *
 * @returns {{ lanes: { id: string, label: string, provider: object, params: object }[],
 *             skipped: string[] }}
 *   `skipped` explica trilhas pedidas que não fazem sentido com estes filtros — vira nota na tela,
 *   em vez de a trilha gastar crédito para devolver só o que o filtro vai descartar.
 */
export function lanesFor(run) {
  const settings = run.settings || {};
  const lanes = [];
  const skipped = [];
  for (const src of run.sources?.length ? run.sources : ["meta"]) {
    switch (src) {
      case "meta":
        lanes.push({ id: "meta", label: SOURCE_LABELS.meta, provider: metaProvider(), params: {} });
        break;
      case "tiktok":
        lanes.push({ id: "tiktok", label: SOURCE_LABELS.tiktok, provider: tiktokAds.search, params: {} });
        break;
      case "tiktok_videos":
        lanes.push({
          id: "tiktok_videos",
          label: SOURCE_LABELS.tiktok_videos,
          provider: tiktokOrganic.keywordSearch,
          params: {},
        });
        break;
      case "tiktok_hashtag": {
        const hashtag = instagram.cleanHashtag(settings.tiktokHashtag) || instagram.hashtagFromTema(run.tema);
        if (!hashtag) {
          skipped.push("TikTok (hashtag) ficou de fora: o tema não forma uma hashtag.");
          break;
        }
        lanes.push({
          id: "tiktok_hashtag",
          label: `TikTok #${hashtag}`,
          provider: tiktokOrganic.hashtagSearch,
          params: { hashtag },
        });
        break;
      }
      case "tiktok_profile":
        for (const alvo of settings.tiktokProfiles || []) {
          if (alvo.startsWith("@")) {
            const handle = alvo.slice(1);
            lanes.push({
              id: `tiktok_profile:${handle}`,
              label: `TikTok @${handle}`,
              provider: tiktokOrganic.profileVideos,
              params: { handle },
            });
            continue;
          }
          const url = tiktokOrganic.urlDoAlvo(alvo);
          if (url) {
            lanes.push({
              id: `tiktok_video:${alvo.split(":")[1]}`,
              label: "TikTok (vídeo colado)",
              provider: tiktokOrganic.singleVideo,
              params: { url },
            });
          }
        }
        break;
      case "instagram_ads":
        // Com Meta Ads marcada, a mesma Biblioteca já está sendo varrida, e estes anúncios vêm nela
        // (com o ícone do Instagram). Uma segunda trilha pagaria as mesmas páginas de novo para
        // devolver só repetidos — o "já vi" descartaria todos.
        if (run.sources.includes("meta")) {
          skipped.push(
            "Anúncios do Instagram já vêm na busca Meta Ads — é a mesma Biblioteca. Os que rodam no " +
              "Instagram têm o ícone dele no card; para ver só esses, busque sem Meta Ads marcada."
          );
          break;
        }
        lanes.push({
          id: "instagram_ads",
          label: SOURCE_LABELS.instagram_ads,
          provider: onlyPlacement(metaProvider(), "INSTAGRAM", "instagram_ads"),
          params: {},
        });
        break;
      case "instagram_reels":
        if (settings.mediaType === "image") {
          skipped.push("Instagram (reels) ficou de fora: o filtro pede só imagem, e reel é vídeo.");
          break;
        }
        lanes.push({
          id: "instagram_reels",
          label: SOURCE_LABELS.instagram_reels,
          provider: instagram.reelsSearch,
          params: {},
        });
        break;
      case "instagram_hashtag": {
        const hashtag = instagram.cleanHashtag(settings.instagramHashtag) || instagram.hashtagFromTema(run.tema);
        if (!hashtag) {
          skipped.push("Instagram (hashtag) ficou de fora: o tema não forma uma hashtag.");
          break;
        }
        lanes.push({
          id: "instagram_hashtag",
          label: `Instagram #${hashtag}`,
          provider: instagram.hashtagSearch,
          params: { hashtag },
        });
        break;
      }
      case "instagram_profile":
        for (const alvo of settings.instagramProfiles || []) {
          if (alvo.startsWith("post:")) {
            const shortcode = alvo.slice(5);
            lanes.push({
              id: `instagram_post:${shortcode}`,
              label: `Instagram (post ${shortcode})`,
              provider: instagram.singlePost,
              params: { shortcode },
            });
          } else if (alvo.startsWith("@")) {
            const handle = alvo.slice(1);
            lanes.push({
              id: `instagram_profile:${handle}`,
              label: `Instagram @${handle}`,
              provider: instagram.profileFeed,
              params: { handle },
            });
          }
        }
        break;
      case "youtube_shorts":
      case "youtube_hashtag":
      case "youtube_channel": {
        // Short é vídeo: com "só imagem" a trilha só pagaria por descarte.
        if (settings.mediaType === "image") {
          skipped.push(`${SOURCE_LABELS[src]} ficou de fora: o filtro pede só imagem, e short é vídeo.`);
          break;
        }
        if (src === "youtube_shorts") {
          lanes.push({ id: src, label: SOURCE_LABELS[src], provider: youtube.search, params: {} });
        } else if (src === "youtube_hashtag") {
          const hashtag = instagram.cleanHashtag(settings.youtubeHashtag) || instagram.hashtagFromTema(run.tema);
          if (!hashtag) {
            skipped.push("YouTube Shorts (hashtag) ficou de fora: o tema não forma uma hashtag.");
            break;
          }
          lanes.push({ id: src, label: `YouTube #${hashtag}`, provider: youtube.hashtagSearch, params: { hashtag } });
        } else {
          for (const alvo of settings.youtubeChannels || []) {
            if (alvo.startsWith("short:")) {
              const videoId = alvo.slice(6);
              lanes.push({
                id: `youtube_short:${videoId}`,
                label: `YouTube (short ${videoId})`,
                provider: youtube.singleShort,
                params: { videoId },
              });
            } else if (alvo.startsWith("channel:")) {
              const channelId = alvo.slice(8);
              lanes.push({
                id: `youtube_channel:${channelId}`,
                label: `YouTube (canal ${channelId})`,
                provider: youtube.channelShorts,
                params: { channelId },
              });
            } else if (alvo.startsWith("@")) {
              const handle = alvo.slice(1);
              lanes.push({
                id: `youtube_channel:@${handle}`,
                label: `YouTube @${handle}`,
                provider: youtube.channelShorts,
                params: { handle },
              });
            }
          }
        }
        break;
      }
      case "meta_advertiser": {
        const anunciante = parseAdvertiser(settings.advertiser);
        if (!anunciante) {
          skipped.push("Esta busca não tem o id da página do anunciante na Biblioteca da Meta.");
          break;
        }
        lanes.push({
          id: `meta_advertiser:${anunciante.pageId}`,
          label: `Anúncios de ${anunciante.pageName || anunciante.pageId}`,
          provider: advertiserProvider,
          params: { pageId: anunciante.pageId },
        });
        break;
      }
      case "google":
        lanes.push({ id: "google", label: SOURCE_LABELS.google, provider: google.themeAdvertisers, params: {} });
        break;
      case "google_advertiser":
        for (const alvo of settings.googleAdvertisers || []) {
          lanes.push({
            id: `google_advertiser:${alvo.slice(alvo.indexOf(":") + 1)}`,
            label: `Google Ads (${alvo.slice(alvo.indexOf(":") + 1)})`,
            provider: google.advertiserAds,
            params: { alvo },
          });
        }
        break;
      default:
        skipped.push(`Fonte desconhecida ignorada: ${src}.`);
    }
  }
  return { lanes, skipped };
}

/** Fontes que buscam por palavra-chave — as únicas que a sonda sabe testar. */
export const PROBE_SOURCE_IDS = [
  "meta",
  "instagram_ads",
  "instagram_reels",
  "instagram_hashtag",
  "tiktok",
  "tiktok_videos",
  "tiktok_hashtag",
  "youtube_shorts",
  "youtube_hashtag",
];

/**
 * A trilha que a busca de verdade usaria para este termo nesta fonte — pela MESMA função
 * (`lanesFor`), para a sonda medir com a régua da busca. A hashtag é sempre a do termo testado,
 * nunca a digitada no formulário: testar "fue" contra #outracoisa não diria nada sobre "fue".
 *
 * @returns {{ lane: object|null, motivo: string|null }}
 */
export function probeLaneFor(fonte, termo, settings = {}) {
  if (!PROBE_SOURCE_IDS.includes(fonte)) {
    return { lane: null, motivo: `${SOURCE_LABELS[fonte] || fonte} não busca por palavra-chave.` };
  }
  const { lanes, skipped } = lanesFor({
    tema: termo,
    sources: [fonte],
    settings: { ...settings, instagramHashtag: null, youtubeHashtag: null, tiktokHashtag: null },
  });
  return { lane: lanes[0] || null, motivo: lanes[0] ? null : skipped[0] || "Fonte indisponível." };
}

/**
 * Quem sabe renovar/completar uma linha já gravada, pela plataforma (`ad_spy_ads.source`).
 * Expõe `fetchAdById` e, opcionalmente, `needsHydration`.
 */
export function providerForAd(source) {
  if (source === "instagram") return instagram;
  if (source === "tiktok") return tiktokAds;
  if (source === "tiktok_organic") return tiktokOrganic;
  if (source === "youtube") return youtube;
  if (source === "meta") return metaProvider();
  if (source === "google") return google;
  return null;
}

/** Kept for the keyword probe, which is Meta-only. */
export function providerFor(sourceId) {
  return PROVIDERS[sourceId] || null;
}

/** For GET /api/spy/health — what this instance can actually do right now. */
export function providerStatus() {
  return [
    { id: "meta", impl: metaProvider().implName, available: metaProvider().available !== false },
    { id: "instagram", impl: "scrapecreators", available: instagram.reelsSearch.available },
    { id: "tiktok", impl: "scrapecreators", available: tiktokAds.search.available },
    { id: "tiktok_organic", impl: "scrapecreators", available: tiktokOrganic.keywordSearch.available },
    { id: "youtube", impl: "scrapecreators", available: youtube.search.available },
    { id: "google", impl: "scrapecreators", available: google.advertiserAds.available },
  ];
}

// Re-exported so callers have a single import surface for the source layer.
export {
  adLibraryPermalink,
  daysRunningFrom,
  isOrganic,
  makeQualityGate,
  unixToIsoDate,
} from "./shared.js";
