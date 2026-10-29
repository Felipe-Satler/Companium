/**
 * Meta Ad Library provider — real browser, GraphQL interception.
 *
 * WHY THIS SHAPE
 * --------------
 * Three approaches were possible and two are dead ends:
 *
 *   1. The official Ad Library API (ads_archive) — DEAD END for us. `ad_type=ALL` only returns
 *      commercial ads when `ad_reached_countries` is an EU state or the UK. For country=BR it
 *      yields nothing but political/issue ads. Do not spend time on it.
 *   2. Scraping the rendered DOM — brittle. Meta ships obfuscated, frequently-rotated class
 *      names; a selector-based scraper breaks silently and returns empty runs.
 *   3. Letting the page make its OWN signed GraphQL calls and reading the JSON responses — what
 *      this file does. The payload shape is far more stable than the markup, and we never have
 *      to forge a signature, session or token: the page does it for us.
 *
 * No login is required — the Ad Library is public.
 *
 * THE RISK, STATED PLAINLY
 * ------------------------
 * Meta runs a WAF that fingerprints the TLS/HTTP2 handshake and scores scroll/mouse behaviour,
 * and it is hostile to datacenter IPs — which is exactly what the prod server has. The
 * mitigations below (real Chrome, pt-BR locale, persistent profile, randomized human-ish scroll,
 * optional residential proxy) reduce but do not eliminate that. If this provider proves
 * unreliable in production, `SPY_META_PROVIDER=scrapecreators` swaps it out wholesale — which is
 * why the sibling adapter shipped at the same time rather than being deferred.
 */

import { chromium } from "playwright";
import {
  BROWSER_PROFILE,
  CHROME_BIN,
  SPY_PROXY,
} from "../config.js";
import {
  adLibraryPermalink,
  metaDaysRunning,
  intOrNull,
  parseJsonKeepingIds,
  pickAdArchiveId,
  unixToIsoDate,
} from "./shared.js";

export const id = "meta";
export const label = "Meta Ads (Biblioteca de Anúncios)";
export const implName = "playwright";
export const available = true;

const BASE = "https://www.facebook.com/ads/library/";

// Stop scrolling after this many consecutive scrolls that produce no new ad. The library happily
// keeps a spinner up forever at the end of a result set, so "no growth" is the only real signal.
const MAX_IDLE_SCROLLS = 4;
// Hard ceiling on scrolls, so a pathological page cannot spin indefinitely.
const MAX_SCROLLS = 60;

function buildSearchUrl({ tema, country, status, mediaType, startDate, endDate }) {
  const p = new URLSearchParams();
  p.set("active_status", status === "ALL" ? "all" : status === "INACTIVE" ? "inactive" : "active");
  p.set("ad_type", "all");
  p.set("country", country || "BR");
  p.set("q", tema);
  p.set("search_type", "keyword_unordered");
  p.set("media_type", (mediaType || "all").toLowerCase());
  if (startDate && endDate) {
    p.set("start_date[min]", startDate);
    p.set("start_date[max]", endDate);
  }
  return `${BASE}?${p.toString()}`;
}

/**
 * Walk an arbitrary decoded GraphQL payload and yield anything that looks like an ad node.
 *
 * Deliberately shape-agnostic rather than pinned to a known path: Meta renames and re-nests the
 * wrapper keys around these nodes regularly, but the leaf node has kept a recognisable fingerprint
 * (`ad_archive_id` + a `snapshot`). Matching on the fingerprint survives re-nesting; matching on
 * `data.ad_library_main.search_results_connection.edges[]` does not.
 */
function* findAdNodes(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 12) return;
  if (Array.isArray(value)) {
    for (const item of value) yield* findAdNodes(item, depth + 1);
    return;
  }
  if (value.ad_archive_id && typeof value.snapshot === "object" && value.snapshot) {
    yield value;
    // An ad node can still contain nested collation children; keep walking.
  }
  for (const key of Object.keys(value)) {
    yield* findAdNodes(value[key], depth + 1);
  }
}

/**
 * Meta's GraphQL endpoint answers with one JSON object per line when a query is streamed
 * (`:has_next_page` multipart responses), so a single JSON.parse of the body often fails. Parse
 * per line and keep whatever succeeds.
 */
function parseLoosely(text) {
  const out = [];
  const trimmed = (text || "").trim();
  if (!trimmed) return out;
  try {
    out.push(parseJsonKeepingIds(trimmed));
    return out;
  } catch {
    /* fall through to line-by-line */
  }
  for (const line of trimmed.split("\n")) {
    const s = line.trim();
    if (!s.startsWith("{")) continue;
    try {
      out.push(parseJsonKeepingIds(s));
    } catch {
      /* partial chunk; ignore */
    }
  }
  return out;
}

/** Pick the best video/image URL out of a snapshot. */
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
  // Carousel / multi-card creatives keep their assets one level down.
  const cards = Array.isArray(snapshot.cards) ? snapshot.cards : [];
  for (const c of cards) {
    const vurl = c?.video_hd_url || c?.video_sd_url;
    if (vurl) {
      return { mediaType: "video", mediaUrl: vurl, thumbUrl: c?.video_preview_image_url || null };
    }
    const iurl = c?.original_image_url || c?.resized_image_url;
    if (iurl) return { mediaType: "image", mediaUrl: iurl, thumbUrl: iurl };
  }
  return { mediaType: null, mediaUrl: null, thumbUrl: null };
}

/** Raw GraphQL ad node -> MinedAd. */
function normalize(node) {
  const snap = node.snapshot || {};
  const startedRunningOn = unixToIsoDate(node.start_date || snap.creation_time);
  const media = pickMedia(snap);
  const cards = Array.isArray(snap.cards) ? snap.cards : [];
  const first = cards[0] || {};

  // The body text lives in different places depending on the creative format; take the first
  // non-empty in order of how close it is to "the thing the user reads first".
  const adCopy =
    snap.body?.text ||
    snap.body?.markup?.__html ||
    first.body ||
    snap.caption ||
    "";

  return {
    source: "meta",
    externalId: pickAdArchiveId(node),
    pageName: snap.page_name || node.page_name || null,
    pageId: node.page_id ? String(node.page_id) : null,
    permalink: adLibraryPermalink(pickAdArchiveId(node)),
    adCopy: typeof adCopy === "string" ? adCopy.trim() : "",
    title: snap.title || first.title || null,
    ctaText: snap.cta_text || first.cta_text || null,
    linkUrl: snap.link_url || first.link_url || null,
    displayFormat: snap.display_format || null,
    publisherPlatform: Array.isArray(node.publisher_platform) ? node.publisher_platform : null,
    // Quantos anúncios usam este mesmo criativo+texto ("13 anúncios usam esse criativo"). Um
    // anunciante replicando a mesma peça em muitos anúncios é sinal forte de que ela performa.
    collationCount: intOrNull(node.collation_count),
    isActive: typeof node.is_active === "boolean" ? node.is_active : null,
    pageProfileUri: node?.snapshot?.page_profile_uri || null,
    pageProfilePictureUrl: snap.page_profile_picture_url || null,
    startedRunningOn,
    daysRunning: metaDaysRunning(startedRunningOn, unixToIsoDate(node.end_date), node.is_active),
    metrics: snap.page_like_count != null ? { pageLikes: intOrNull(snap.page_like_count) } : null,
    ...media,
  };
}

async function launch() {
  const launchOpts = {
    headless: true,
    // Reuse the Chrome that render.js already requires on this box rather than downloading a
    // second browser. Real Chrome also has a far less bot-like fingerprint than bundled Chromium.
    ...(CHROME_BIN ? { executablePath: CHROME_BIN } : { channel: "chrome" }),
    ...(SPY_PROXY ? { proxy: { server: SPY_PROXY } } : {}),
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-dev-shm-usage",
    ],
  };
  const contextOpts = {
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    viewport: { width: 1440, height: 900 },
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/140.0.0.0 Safari/537.36",
  };

  // A persistent profile carries cookies and history between runs, which reads far more like a
  // returning human than a pristine context every time.
  if (BROWSER_PROFILE) {
    const context = await chromium.launchPersistentContext(BROWSER_PROFILE, {
      ...launchOpts,
      ...contextOpts,
    });
    return { browser: null, context };
  }
  const browser = await chromium.launch(launchOpts);
  const context = await browser.newContext(contextOpts);
  return { browser, context };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Randomized pause — a fixed cadence is itself a bot signal. */
const humanPause = (min, max) => sleep(min + Math.random() * (max - min));

/**
 * @param {object} params see sources/index.js
 * @param {{ signal?: AbortSignal, log?: (msg: string) => void, onProgress?: (n: number) => void }} ctx
 */
export async function* search(params, ctx = {}) {
  const { tema, limit = 20 } = params;
  const log = ctx.log || (() => {});
  const seen = new Set();
  // Quantas respostas do /api/graphql chegaram. É o sinal que separa "a página nem falou com a
  // API" (bloqueio/erro de carregamento) de "a API respondeu, só que sem anúncios" (busca
  // genuinamente vazia OU limitação por IP). Sem isso os três casos viram a mesma mensagem.
  let graphqlSeen = 0;
  /** @type {import('./index.js').MinedAd[]} */
  const queue = [];

  const { browser, context } = await launch();
  try {
    const page = await context.newPage();

    page.on("response", async (res) => {
      const url = res.url();
      if (!url.includes("/api/graphql")) return;
      graphqlSeen += 1;
      let text;
      try {
        text = await res.text();
      } catch {
        return; // body already consumed or the request was aborted
      }
      for (const payload of parseLoosely(text)) {
        for (const node of findAdNodes(payload)) {
          const key = pickAdArchiveId(node);
          if (!key) continue; // sem id válido não dá para deduplicar nem linkar
          if (seen.has(key)) continue;
          seen.add(key);
          try {
            queue.push(normalize(node));
          } catch (err) {
            log(`normalize falhou para ad ${key}: ${err.message}`);
          }
        }
      }
    });

    const url = buildSearchUrl(params);
    log(`abrindo ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    // The first batch arrives with the initial render; give it a moment before judging emptiness.
    await humanPause(2500, 4000);

    let idle = 0;
    let scrolls = 0;
    let lastCount = 0;
    let yielded = 0;

    while (yielded < limit && idle < MAX_IDLE_SCROLLS && scrolls < MAX_SCROLLS) {
      if (ctx.signal?.aborted) throw new Error("cancelado");

      // Drain whatever the interceptor has collected so far.
      while (queue.length && yielded < limit) {
        yield queue.shift();
        yielded += 1;
        ctx.onProgress?.(1);
      }
      if (yielded >= limit) break;

      const before = seen.size;
      await page.mouse.wheel(0, 1200 + Math.floor(Math.random() * 800));
      // >= 3s between scrolls: aggressive throttling is the single most effective thing against
      // behavioural scoring, and a mining run is not latency-sensitive.
      await humanPause(3000, 5000);
      scrolls += 1;

      if (seen.size === before) {
        idle += 1;
        log(`scroll ${scrolls}: sem novos anúncios (${idle}/${MAX_IDLE_SCROLLS})`);
      } else {
        idle = 0;
        if (seen.size !== lastCount) {
          log(`scroll ${scrolls}: ${seen.size} anúncios vistos`);
          lastCount = seen.size;
        }
      }
    }

    // Anything collected after the last drain.
    while (queue.length && yielded < limit) {
      yield queue.shift();
      yielded += 1;
      ctx.onProgress?.(1);
    }

    if (seen.size === 0) {
      // Três causas MUITO diferentes produzem "zero anúncios", e mandar o usuário "tentar um tema
      // mais amplo" nas três é mentira em duas delas. A ordem abaixo vai do sinal mais forte para
      // o mais fraco.
      log(`zero anúncios após ${scrolls} scroll(s); respostas graphql vistas: ${graphqlSeen}`);

      // (a) Parede de login/checkpoint: bloqueio explícito.
      const blocked = await page
        .locator('input[name="pass"], form[action*="login"], #checkpoint_title')
        .count()
        .catch(() => 0);
      if (blocked > 0) {
        throw new Error(
          "A Meta respondeu com login/checkpoint em vez dos resultados — bloqueio de IP. " +
            "Configure SPY_BROWSER_PROFILE e/ou SPY_PROXY (proxy residencial), ou troque para " +
            "SPY_META_PROVIDER=scrapecreators."
        );
      }

      // (b) A página não chegou a falar com a API: carregamento barrado antes disso.
      if (graphqlSeen === 0) {
        throw new Error(
          "A página da Biblioteca de Anúncios não emitiu nenhuma chamada GraphQL — provavelmente " +
            "a Meta barrou o carregamento a partir deste IP. Espere alguns minutos, configure " +
            "SPY_BROWSER_PROFILE/SPY_PROXY, ou troque para SPY_META_PROVIDER=scrapecreators."
        );
      }

      // (c) A API respondeu, mas sem anúncios. Pode ser busca realmente vazia OU limitação leve
      // (a Meta devolve conjunto vazio em vez de bloquear). O estado vazio da própria página é o
      // que desempata.
      const emptyState = await page
        .getByText(/nenhum resultado|nenhum anúncio|no results|0 resultados/i)
        .count()
        .catch(() => 0);
      if (emptyState > 0) {
        log(`a Meta declarou busca vazia para "${tema}"`);
        return; // zero anúncios de verdade; o runner mostra a mensagem de tema/filtros
      }
      throw new Error(
        `A Meta respondeu ${graphqlSeen} vez(es) sem nenhum anúncio para "${tema}", e a página não ` +
          "declarou busca vazia — sinal típico de limitação por IP depois de várias buscas " +
          "seguidas. Espere alguns minutos e tente de novo; se persistir, configure " +
          "SPY_BROWSER_PROFILE/SPY_PROXY ou troque para SPY_META_PROVIDER=scrapecreators."
      );
    }
  } finally {
    await context.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}
