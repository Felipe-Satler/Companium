/**
 * YouTube Shorts como fonte orgânica.
 *
 * O que muda em relação às outras fontes, e é o que estes testes prendem: não há arquivo de vídeo
 * (a transcrição vem da legenda), o texto principal é o TÍTULO, e a busca tem um parâmetro de custo
 * não documentado — então vale o crédito que a API diz ter cobrado.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const scGet = vi.fn();
vi.mock("../../apps/ad-spy-worker/sources/scrapecreators.js", () => ({
  scGet: (...a: unknown[]) => scGet(...a),
  hasKey: () => true,
  requireKey: () => {},
}));

import { fetchNextBlock } from "../../apps/ad-spy-worker/search.js";
import { probeTerms } from "../../apps/ad-spy-worker/probe.js";
import { lanesFor } from "../../apps/ad-spy-worker/sources/index.js";
import { makeQualityGate } from "../../apps/ad-spy-worker/sources/shared.js";
import {
  fetchAdById,
  normalize,
  parseYoutubeTarget,
  search,
} from "../../apps/ad-spy-worker/sources/youtube.js";

const short = (id: string, over: Record<string, unknown> = {}) => ({
  type: "short",
  id,
  url: `https://www.youtube.com/shorts/${id}`,
  title: "Harmonização: antes e depois",
  thumbnail: `https://i.ytimg.com/vi/${id}/hq.jpg`,
  channel: { id: "UCabc", title: "Dra X", handle: "@draX", thumbnail: "https://yt/a.jpg" },
  viewCountInt: 48000,
  publishedTime: "2026-09-20T10:00:00.000Z",
  lengthSeconds: 42,
  ...over,
});

const deps = {
  upsertAds: async (_r: string, ads: unknown[]) => ads.map((a, i) => ({ ...(a as object), id: i })),
  rehostImages: async () => {},
};

beforeEach(() => {
  scGet.mockReset();
});

describe("normalizador", () => {
  it("short da busca vira peça orgânica sem link de arquivo", () => {
    const ad = normalize(short("abcDEF12345"), "shorts");
    expect(ad).toMatchObject({
      source: "youtube",
      externalId: "abcDEF12345",
      pageName: "Dra X",
      pageId: "draX",
      pageProfileUri: "https://www.youtube.com/@draX",
      permalink: "https://www.youtube.com/shorts/abcDEF12345",
      title: "Harmonização: antes e depois",
      mediaType: "video",
      mediaUrl: null,
      startedRunningOn: "2026-09-20",
      durationSec: 42,
      displayFormat: "SHORT",
    });
    expect(ad!.metrics.views).toBe(48000);
  });

  it("short de canal não traz o canal no item: usa o canal da trilha", () => {
    const ad = normalize(
      { id: "abcDEF12345", title: "x", viewCountInt: 1, publishDate: "2026-09-01T00:00:00-03:00", durationMs: 30000 },
      "canal:@draX",
      { handle: "draX", title: "@draX" }
    );
    expect(ad).toMatchObject({ pageId: "draX", durationSec: 30, startedRunningOn: "2026-09-01" });
  });

  it("id inválido não vira peça", () => {
    expect(normalize({ id: "" })).toBeNull();
  });
});

describe("alvos", () => {
  it("@canal, URL de canal, short, youtu.be e watch?v=", () => {
    expect(parseYoutubeTarget("@DraX")).toBe("@drax");
    expect(parseYoutubeTarget("https://www.youtube.com/@DraX/shorts")).toBe("@drax");
    expect(parseYoutubeTarget("https://www.youtube.com/channel/UC1234567890abcdef")).toBe("channel:UC1234567890abcdef");
    expect(parseYoutubeTarget("https://www.youtube.com/shorts/abcDEF12345?feature=share")).toBe("short:abcDEF12345");
    expect(parseYoutubeTarget("https://youtu.be/abcDEF12345")).toBe("short:abcDEF12345");
    expect(parseYoutubeTarget("https://www.youtube.com/watch?v=abcDEF12345")).toBe("short:abcDEF12345");
    expect(parseYoutubeTarget("qualquer coisa")).toBeNull();
  });

  it("canais e links viram uma trilha cada; com 'só imagem' as trilhas de short saem com nota", () => {
    const { lanes } = lanesFor({
      tema: "x",
      sources: ["youtube_channel"],
      settings: { youtubeChannels: ["@drax", "short:abcDEF12345"] },
    });
    expect(lanes.map((l: { id: string }) => l.id)).toEqual(["youtube_channel:@drax", "youtube_short:abcDEF12345"]);

    const img = lanesFor({ tema: "x", sources: ["youtube_shorts"], settings: { mediaType: "image" } });
    expect(img.lanes).toHaveLength(0);
    expect(img.skipped[0]).toMatch(/short é vídeo/);
  });
});

describe("filtros", () => {
  it("replicação não veta short; texto mínimo aceita o título", () => {
    const ad = normalize(short("abcDEF12345"), "shorts");
    expect(makeQualityGate({ minCollationCount: 5 })(ad).ok).toBe(true);
    expect(makeQualityGate({ minCopyChars: 10 })(ad).ok).toBe(true);
    expect(makeQualityGate({ minDaysRunning: 365 })(ad).ok).toBe(true);
  });
});

describe("busca e crédito", () => {
  it("pede só shorts, com extras, e lê também shorts misturados em `videos`", async () => {
    scGet.mockResolvedValue({
      shorts: [short("aaaaaaaaaa1")],
      videos: [short("aaaaaaaaaa2"), { ...short("aaaaaaaaaa3"), type: "video" }],
      continuationToken: "tok",
      credits_charged: 1,
    });
    const page = await search.fetchPage({ tema: "harmonização", country: "BR", sortBy: "impressions" }, null, {});
    expect(scGet.mock.calls[0][1]).toMatchObject({ query: "harmonização", type: "shorts", includeExtras: "true", sortBy: "popular", region: "BR" });
    expect(page.ads.map((a: { externalId: string }) => a.externalId)).toEqual(["aaaaaaaaaa1", "aaaaaaaaaa2"]);
    expect(page.cursor).toBe("tok");
  });

  it("vale o crédito que a API diz ter cobrado, não a estimativa", async () => {
    scGet.mockResolvedValue({ shorts: [short("aaaaaaaaaa1")], continuationToken: null, credits_charged: 3 });
    const { lanes } = lanesFor({ tema: "x", sources: ["youtube_shorts"], settings: {} });
    const { state } = await fetchNextBlock({
      run: { id: "r", tema: "x", sources: ["youtube_shorts"], settings: { targetAds: 4 }, search_state: {} },
      lanes,
      userId: "u",
      deps,
    });
    expect(state.creditsUsed).toBe(3);

    scGet.mockResolvedValue({ shorts: [short("aaaaaaaaaa1")], continuationToken: null, credits_charged: 3 });
    const sonda = await probeTerms({ termos: ["x"], settings: {}, fontes: ["youtube_shorts"] });
    expect(sonda.creditsUsed).toBe(3);
    expect(sonda.resultados[0]).not.toHaveProperty("credits");
    expect(sonda.resultados[0].medianaViews).toBe(48000);
  });
});

describe("completar o selecionado", () => {
  it("a transcrição é a legenda do YouTube", async () => {
    scGet.mockImplementation(async (path: string) =>
      path === "/v1/youtube/video"
        ? { ...short("abcDEF12345"), description: "descrição longa", likeCountInt: 900 }
        : { transcript_only_text: "olá, hoje vou mostrar", language: "Portuguese" }
    );
    const ad = await fetchAdById("abcDEF12345");
    expect(ad).toMatchObject({ adCopy: "descrição longa", transcript: "olá, hoje vou mostrar", transcriptLang: "Portuguese" });
    expect(ad.metrics.likes).toBe(900);
  });

  it("sem legenda, segue com título e descrição — não é erro", async () => {
    scGet.mockImplementation(async (path: string) =>
      path === "/v1/youtube/video"
        ? short("abcDEF12345")
        : { transcript: null, transcript_only_text: null, language: null }
    );
    const ad = await fetchAdById("abcDEF12345");
    expect(ad.transcript).toBeNull();
    expect(ad.title).toBe("Harmonização: antes e depois");
  });
});
