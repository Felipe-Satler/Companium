/**
 * TikTok orgânico como fonte: vídeos por palavra-chave, hashtag, perfil e link colado.
 *
 * O que estes testes prendem:
 *
 *   - o vídeo orgânico NÃO pode ser tratado como anúncio do TikTok: com o mesmo `source`, cairia no
 *     filtro de longevidade e no de alcance estimado, e a fonte inteira sumiria em silêncio;
 *   - o mesmo vídeo achado por duas rotas (com e sem o embrulho `aweme_info`) vira uma peça só;
 *   - "0 seguidores" é dado ausente, não zero;
 *   - cada rota pagina com o SEU cursor — trocar `cursor` por `max_cursor` relê a primeira página
 *     para sempre, gastando crédito;
 *   - o que a pessoa cola no campo de links vira parâmetro de chamada paga, então só passa o que
 *     for reconhecidamente um perfil ou vídeo do TikTok.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const scGet = vi.fn();
vi.mock("../../apps/ad-spy-worker/sources/scrapecreators.js", () => ({
  scGet: (...a: unknown[]) => scGet(...a),
  hasKey: () => true,
  requireKey: () => {},
}));

import { fetchNextBlock } from "../../apps/ad-spy-worker/search.js";
import { lanesFor, probeLaneFor, providerForAd } from "../../apps/ad-spy-worker/sources/index.js";
import { isOrganic, makeQualityGate } from "../../apps/ad-spy-worker/sources/shared.js";
import {
  datePostedFrom,
  fetchAdById,
  normalize,
  parseTiktokTarget,
  urlDoAlvo,
} from "../../apps/ad-spy-worker/sources/tiktok-organic.js";
import { fontesAtivas } from "@/components/marketing/mineracao/filtroFontes";
import { adOpenLinks, isOrganicAd, type SpyAd } from "@/lib/adSpyApi";

/** Um "aweme" no formato do app, com só os campos que o normalizador lê. */
const aweme = (id: string, over: Record<string, unknown> = {}) => ({
  aweme_id: id,
  desc: "Lente de contato dental: antes e depois #lentedecontato",
  create_time: 1_758_362_400, // 2025-09-20
  is_ads: false,
  author: {
    unique_id: "dra.exemplo",
    nickname: "Dra. Exemplo",
    uid: "6659752019493208069",
    follower_count: 12_000,
    avatar_thumb: { url_list: ["https://p16.tiktokcdn.com/avatar.jpeg"] },
  },
  statistics: { play_count: 48_000, digg_count: 3_000, comment_count: 120, share_count: 80, collect_count: 400 },
  video: {
    duration: 42_300,
    play_addr: { url_list: ["https://v16.tiktokcdn.com/play.mp4"] },
    download_addr: { url_list: ["https://v16.tiktokcdn.com/marca-dagua.mp4"] },
    cover: { url_list: ["https://p16.tiktokcdn.com/cover.jpeg"] },
  },
  ...over,
});

const ID = "7334621391758642478";

const deps = {
  upsertAds: async (_runId: string, ads: unknown[]) => ads.map((a, i) => ({ ...(a as object), id: i })),
  rehostImages: async () => {},
};

beforeEach(() => {
  scGet.mockReset();
});

describe("normalização", () => {
  it("lê o vídeo do app: texto, autor, números, arquivo sem marca d'água e duração em segundos", () => {
    expect(normalize(aweme(ID), "videos")).toMatchObject({
      source: "tiktok_organic",
      foundVia: "videos",
      externalId: ID,
      pageName: "Dra. Exemplo",
      pageId: "dra.exemplo",
      pageProfileUri: "https://www.tiktok.com/@dra.exemplo",
      permalink: `https://www.tiktok.com/@dra.exemplo/video/${ID}`,
      adCopy: "Lente de contato dental: antes e depois #lentedecontato",
      startedRunningOn: "2025-09-20",
      mediaType: "video",
      mediaUrl: "https://v16.tiktokcdn.com/play.mp4",
      thumbUrl: "https://p16.tiktokcdn.com/cover.jpeg",
      durationSec: 42,
      metrics: { views: 48_000, likes: 3_000, comments: 120, shares: 80, saves: 400, followers: 12_000 },
    });
  });

  it("o embrulho `aweme_info` da busca dá a MESMA peça que o objeto solto das outras rotas", () => {
    expect(normalize({ aweme_info: aweme(ID) }, "videos")).toEqual(normalize(aweme(ID), "videos"));
  });

  it("calcula o engajamento sobre as visualizações", () => {
    const m = normalize(aweme(ID))!.metrics;
    expect(m.engagementRate).toBeCloseTo((3_000 + 120) / 48_000, 4);
    expect(m.engagementBasis).toBe("views");
  });

  it("0 seguidores é 'não informado': não vira multiplicador nem engajamento por seguidor", () => {
    const a = aweme(ID);
    const m = normalize({ ...a, author: { ...a.author, follower_count: 0 } })!.metrics;
    expect(m.followers).toBeNull();
    expect(m.viewsPerFollower).toBeNull();
  });

  it("carrossel de fotos é imagem, sem vídeo para transcrever, e o link é /photo/", () => {
    const ad = normalize(
      aweme(ID, { image_post_info: { images: [{ display_image: { url_list: ["https://p16.tiktokcdn.com/1.jpeg"] } }] } }),
    )!;
    expect(ad).toMatchObject({
      mediaType: "image",
      mediaUrl: "https://p16.tiktokcdn.com/1.jpeg",
      displayFormat: "CAROUSEL",
      permalink: `https://www.tiktok.com/@dra.exemplo/photo/${ID}`,
    });
  });

  it("sem id válido não há peça — não daria para deduplicar nem montar o link", () => {
    expect(normalize({ desc: "x" })).toBeNull();
    expect(normalize({ aweme_id: "abc" })).toBeNull();
    expect(normalize(null)).toBeNull();
  });

  it("marca o vídeo que o TikTok sinaliza como anúncio", () => {
    expect(normalize(aweme(ID, { is_ads: true }))!.metrics.paidPartnership).toBe(true);
    expect(normalize(aweme(ID))!.metrics.paidPartnership).toBeNull();
  });
});

describe("filtros de qualidade", () => {
  const video = { ...normalize(aweme(ID))!, daysRunning: 3 };

  it("é orgânico para o gate, e a Biblioteca de Anúncios continua não sendo", () => {
    expect(isOrganic("tiktok_organic")).toBe(true);
    expect(isOrganic("tiktok")).toBe(false);
  });

  it("os filtros de ANÚNCIO não tocam nele: longevidade, replicação e alcance estimado do TikTok Ads", () => {
    const gate = makeQualityGate({ minDaysRunning: 90, minCollationCount: 5, minTikTokAudience: 1_000_000 });
    expect(gate(video).ok).toBe(true);
  });

  it("os de orgânico valem: visualizações e engajamento", () => {
    expect(makeQualityGate({ minViews: 100_000 })(video)).toMatchObject({ ok: false });
    expect(makeQualityGate({ minViews: 10_000 })(video).ok).toBe(true);
    expect(makeQualityGate({ minEngagementPct: 20 })(video)).toMatchObject({ ok: false });
  });

  it("o multiplicador sobre seguidores é só do Instagram — o TikTok manda 0 seguidores em várias rotas", () => {
    expect(makeQualityGate({ minViewsPerFollower: 50 })(video).ok).toBe(true);
  });
});

describe("alvos colados (perfis e links)", () => {
  it("aceita @perfil, link de perfil, link de vídeo/carrossel e links curtos", () => {
    expect(parseTiktokTarget("@Dra.Exemplo")).toBe("@dra.exemplo");
    expect(parseTiktokTarget("https://www.tiktok.com/@dra.exemplo?lang=pt-BR")).toBe("@dra.exemplo");
    expect(parseTiktokTarget(`https://www.tiktok.com/@Dra.Exemplo/video/${ID}?is_from_webapp=1`)).toBe(
      `video:dra.exemplo/${ID}`,
    );
    expect(parseTiktokTarget(`https://www.tiktok.com/@dra.exemplo/photo/${ID}`)).toBe(`video:dra.exemplo/${ID}`);
    expect(parseTiktokTarget("https://vm.tiktok.com/ZMabc123/")).toBe("curto:vm/ZMabc123");
    expect(parseTiktokTarget("https://vt.tiktok.com/ZSxyz987/")).toBe("curto:vt/ZSxyz987");
    expect(parseTiktokTarget("https://www.tiktok.com/t/ZTabc123/")).toBe("curto:t/ZTabc123");
  });

  it("recusa o que não é do TikTok", () => {
    expect(parseTiktokTarget("https://www.instagram.com/reel/abc123/")).toBeNull();
    expect(parseTiktokTarget("https://evil.example/@x/video/123456789")).toBeNull();
    expect(parseTiktokTarget("uma frase qualquer")).toBeNull();
    expect(parseTiktokTarget("")).toBeNull();
  });

  it("a URL da chamada é remontada de partes validadas — texto arbitrário não chega à API", () => {
    expect(urlDoAlvo(`video:dra.exemplo/${ID}`)).toBe(`https://www.tiktok.com/@dra.exemplo/video/${ID}`);
    expect(urlDoAlvo("curto:vm/ZMabc123")).toBe("https://vm.tiktok.com/ZMabc123/");
    expect(urlDoAlvo("curto:t/ZTabc123")).toBe("https://www.tiktok.com/t/ZTabc123/");
    expect(urlDoAlvo("video:x/../../etc")).toBeNull();
    expect(urlDoAlvo("curto:vm/a b")).toBeNull();
    expect(urlDoAlvo("@perfil")).toBeNull();
  });

  it("a janela de data segue os degraus que a rota aceita", () => {
    const ha = (dias: number) => new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
    expect(datePostedFrom(ha(5))).toBe("this-week");
    expect(datePostedFrom(ha(20))).toBe("this-month");
    expect(datePostedFrom(ha(80))).toBe("last-3-months");
    expect(datePostedFrom(ha(150))).toBe("last-6-months");
    expect(datePostedFrom(ha(400))).toBeNull();
    expect(datePostedFrom(null)).toBeNull();
  });
});

describe("trilhas", () => {
  const run = (sources: string[], settings: Record<string, unknown> = {}, search_state: unknown = {}) => ({
    id: "r",
    tema: "lente de contato dental",
    sources,
    settings: { targetAds: 4, country: "BR", ...settings },
    search_state,
  });

  it("cada modo vira a sua trilha; perfil e link viram uma por alvo", () => {
    const { lanes, skipped } = lanesFor(
      run(["tiktok", "tiktok_videos", "tiktok_hashtag", "tiktok_profile"], {
        tiktokProfiles: ["@dra.exemplo", `video:dra.exemplo/${ID}`, "curto:vm/ZMabc123"],
      }),
    );
    expect(skipped).toEqual([]);
    expect(lanes.map((l: { id: string }) => l.id)).toEqual([
      "tiktok",
      "tiktok_videos",
      "tiktok_hashtag",
      "tiktok_profile:dra.exemplo",
      `tiktok_video:dra.exemplo/${ID}`,
      "tiktok_video:vm/ZMabc123",
    ]);
    // A hashtag sai do tema quando o campo fica vazio.
    expect(lanes[2].params).toEqual({ hashtag: "lentedecontatodental" });
    expect(lanes[4].params).toEqual({ url: `https://www.tiktok.com/@dra.exemplo/video/${ID}` });
  });

  it("busca por palavra-chave: manda tema, país e ordenação, e continua pelo `cursor`", async () => {
    scGet.mockResolvedValueOnce({
      search_item_list: [1, 2, 3].map((i) => ({ aweme_info: aweme(`733462139175864247${i}`) })),
      cursor: 12,
      credits_charged: 1,
    });
    const r = run(["tiktok_videos"], { targetAds: 4 });
    const { lanes } = lanesFor(r);
    const b1 = await fetchNextBlock({ run: r, lanes, userId: "u", deps });
    // Faltou 1 para a cota: buscou a 2ª página, com o cursor da 1ª.
    expect(scGet.mock.calls[0]).toEqual([
      "/v1/tiktok/search/keyword",
      expect.objectContaining({ query: "lente de contato dental", region: "BR", sort_by: "most-liked" }),
      expect.anything(),
    ]);
    expect(scGet.mock.calls[0][1].cursor ?? null).toBeNull();
    expect(scGet.mock.calls[1][1].cursor).toBe("12");
    expect(b1.added).toBe(3);
  });

  it("`has_more: 0` encerra a hashtag mesmo com cursor na resposta", async () => {
    scGet.mockResolvedValueOnce({ aweme_list: [aweme(ID)], cursor: 20, has_more: 0, credits_charged: 1 });
    const r = run(["tiktok_hashtag"], { tiktokHashtag: "lentes" });
    const { lanes } = lanesFor(r);
    const b = await fetchNextBlock({ run: r, lanes, userId: "u", deps });
    expect(scGet).toHaveBeenCalledTimes(1);
    expect(scGet.mock.calls[0][1]).toMatchObject({ hashtag: "lentes", region: "BR" });
    expect(b.state.lanes.tiktok_hashtag.exhausted).toBe(true);
  });

  it("perfil pagina por `max_cursor`, pede os populares e deixa os fixados de fora", async () => {
    scGet
      .mockResolvedValueOnce({ aweme_list: [aweme("7334621391758642001")], has_more: 1, max_cursor: 1738435195000 })
      .mockResolvedValueOnce({ aweme_list: [aweme("7334621391758642002")], has_more: 0, max_cursor: 0 });
    const r = run(["tiktok_profile"], { tiktokProfiles: ["@dra.exemplo"] });
    const { lanes } = lanesFor(r);
    const b = await fetchNextBlock({ run: r, lanes, userId: "u", deps });
    expect(scGet.mock.calls[0][0]).toBe("/v3/tiktok/profile/videos");
    expect(scGet.mock.calls[0][1]).toMatchObject({ handle: "dra.exemplo", sort_by: "popular", include_pinned: false });
    expect(scGet.mock.calls[1][1].max_cursor).toBe("1738435195000");
    expect(b.added).toBe(2);
    expect(b.state.lanes["tiktok_profile:dra.exemplo"].exhausted).toBe(true);
  });

  it("perfil: página vazia com `has_more` ligado não encerra (os fixados foram tirados)", async () => {
    scGet
      .mockResolvedValueOnce({ aweme_list: [], has_more: 1, max_cursor: 111 })
      .mockResolvedValueOnce({ aweme_list: [aweme(ID)], has_more: 0 });
    const r = run(["tiktok_profile"], { tiktokProfiles: ["@dra.exemplo"] });
    const b = await fetchNextBlock({ run: r, lanes: lanesFor(r).lanes, userId: "u", deps });
    expect(scGet).toHaveBeenCalledTimes(2);
    expect(b.added).toBe(1);
  });

  it("vídeo colado: uma chamada ao detalhe, uma peça, fim", async () => {
    scGet.mockResolvedValueOnce({ aweme_detail: aweme(ID) });
    const r = run(["tiktok_profile"], { tiktokProfiles: [`video:dra.exemplo/${ID}`] });
    const b = await fetchNextBlock({ run: r, lanes: lanesFor(r).lanes, userId: "u", deps });
    expect(scGet.mock.calls[0]).toEqual([
      "/v2/tiktok/video",
      { url: `https://www.tiktok.com/@dra.exemplo/video/${ID}` },
      expect.anything(),
    ]);
    expect(b.added).toBe(1);
    expect(b.state.lanes[`tiktok_video:dra.exemplo/${ID}`].exhausted).toBe(true);
  });

  it("o mesmo vídeo achado pela busca e pela hashtag vira uma peça só", async () => {
    scGet.mockImplementation(async (rota: string) =>
      rota.endsWith("/keyword")
        ? { search_item_list: [{ aweme_info: aweme(ID) }], cursor: 1, has_more: 0 }
        : { aweme_list: [aweme(ID)], cursor: 1, has_more: 0 },
    );
    const r = run(["tiktok_videos", "tiktok_hashtag"]);
    const b = await fetchNextBlock({ run: r, lanes: lanesFor(r).lanes, userId: "u", deps });
    expect(b.added).toBe(1);
  });

  it("renovar o link de um vídeo salvo usa o detalhe pelo id; id inválido não gasta crédito", async () => {
    expect(providerForAd("tiktok_organic").fetchAdById).toBe(fetchAdById);
    scGet.mockResolvedValueOnce({ aweme_detail: aweme(ID) });
    const ad = await fetchAdById(ID);
    expect(scGet.mock.calls[0][1].url).toContain(`/video/${ID}`);
    expect(ad).toMatchObject({ externalId: ID, mediaUrl: "https://v16.tiktokcdn.com/play.mp4" });
    expect(await fetchAdById("../x")).toBeNull();
    expect(scGet).toHaveBeenCalledTimes(1);
  });

  it("a sonda testa a palavra-chave nos vídeos e na hashtag DO TERMO, não na do formulário", () => {
    expect(probeLaneFor("tiktok_videos", "lentes", {}).lane?.id).toBe("tiktok_videos");
    expect(probeLaneFor("tiktok_hashtag", "lentes dentais", { tiktokHashtag: "outracoisa" }).lane?.params).toEqual({
      hashtag: "lentesdentais",
    });
    expect(probeLaneFor("tiktok_profile", "lentes", {}).lane).toBeNull();
  });
});

describe("tela", () => {
  const ad = { source: "tiktok_organic", external_id: ID, page_id: "dra.exemplo",
    permalink: `https://www.tiktok.com/@dra.exemplo/video/${ID}`, page_profile_uri: "https://www.tiktok.com/@dra.exemplo",
  } as SpyAd;

  it("é orgânico no card, e os links são o vídeo e o perfil — não a Biblioteca de Anúncios", () => {
    expect(isOrganicAd(ad)).toBe(true);
    expect(isOrganicAd({ source: "tiktok" })).toBe(false);
    expect(adOpenLinks(ad).map((l) => l.label)).toEqual(["Vídeo no TikTok", "Perfil @dra.exemplo"]);
  });

  it("as tags dos filtros separam TikTok Ads de TikTok orgânico", () => {
    expect([...fontesAtivas(["tiktok", "tiktok_videos", "tiktok_profile"])].sort()).toEqual(["tiktok", "tiktok_organic"]);
  });
});
