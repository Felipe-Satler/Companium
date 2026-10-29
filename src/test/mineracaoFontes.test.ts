/**
 * Várias fontes na mesma busca: Meta, Instagram (orgânico) e TikTok Ads.
 *
 * O que estes testes prendem é o que daria errado EM SILÊNCIO — nenhum destes casos quebra a busca,
 * só a empobrece sem ninguém perceber:
 *
 *   - um filtro de uma fonte vetando outra inteira (replicação ligada em 5 reprovaria todo reel);
 *   - a primeira fonte da lista enchendo o bloco e as outras nunca sendo consultadas;
 *   - uma trilha com erro levando a busca inteira junto;
 *   - uma run de antes das trilhas recomeçando do zero no "carregar mais";
 *   - o mesmo post virando duas linhas conforme a rota que o achou.
 */
import { describe, it, expect, vi } from "vitest";
import { fetchNextBlock, isExhausted, loadState } from "../../apps/ad-spy-worker/search.js";
import { makeQualityGate } from "../../apps/ad-spy-worker/sources/shared.js";
import {
  hashtagFromTema,
  normalize as normalizeInstagram,
  parseInstagramTarget,
} from "../../apps/ad-spy-worker/sources/instagram.js";
import { normalize as normalizeTikTok } from "../../apps/ad-spy-worker/sources/tiktok-ads.js";
import { lanesFor, onlyPlacement } from "../../apps/ad-spy-worker/sources/index.js";

const deps = {
  upsertAds: async (_runId: string, ads: unknown[]) => ads.map((a, i) => ({ ...(a as object), id: i })),
  rehostImages: async () => {},
};

function fakeAd(source: string, i: number, over: Record<string, unknown> = {}) {
  return {
    source,
    externalId: `${source}-${i}`,
    pageName: `${source} ${i}`,
    pageId: `${source}-p${i}`,
    adCopy: "x".repeat(80),
    daysRunning: 200,
    collationCount: source === "meta" ? 9 : null,
    mediaType: "video",
    metrics: source === "instagram" ? { views: 50_000 } : null,
    ...over,
  };
}

/** Trilha de mentira: `porPagina` peças por página, até `paginas` páginas (ou para sempre). */
function lane(id: string, source: string, porPagina: number, paginas = Infinity, over = {}) {
  let n = 0;
  let p = 0;
  const provider = {
    implName: "scrapecreators",
    creditsPerPage: 1,
    fetchPage: vi.fn(async () => {
      p += 1;
      const ads = Array.from({ length: porPagina }, () => fakeAd(source, n++, over));
      return { ads, cursor: p < paginas ? `c${p}` : null };
    }),
  };
  return { id, label: id, provider, params: {} };
}

const run = (settings: Record<string, unknown>, search_state: unknown = {}) => ({
  id: "run-1",
  tema: "harmonização facial",
  sources: ["meta"],
  settings,
  search_state,
});

describe("filtro de qualidade por fonte", () => {
  it("replicação só vale para a Meta — não veta o Instagram nem o TikTok", () => {
    const gate = makeQualityGate({ minCollationCount: 5 });
    expect(gate(fakeAd("meta", 1, { collationCount: 1 })).ok).toBe(false);
    expect(gate(fakeAd("instagram", 1)).ok).toBe(true);
    expect(gate(fakeAd("tiktok", 1)).ok).toBe(true);
  });

  it("longevidade não se aplica a post orgânico — a idade de um post não é prova de verba", () => {
    const gate = makeQualityGate({ minDaysRunning: 90 });
    expect(gate(fakeAd("instagram", 1, { daysRunning: 2 })).ok).toBe(true);
    expect(gate(fakeAd("tiktok", 1, { daysRunning: 2 })).ok).toBe(false);
  });

  it("mínimo de visualizações vale só para o orgânico, e desconhecido reprova", () => {
    const gate = makeQualityGate({ minViews: 10_000 });
    expect(gate(fakeAd("instagram", 1, { metrics: { views: 500 } })).ok).toBe(false);
    expect(gate(fakeAd("instagram", 2, { metrics: {} })).ok).toBe(false);
    expect(gate(fakeAd("instagram", 3, { metrics: { views: 20_000 } })).ok).toBe(true);
    expect(gate(fakeAd("meta", 1)).ok).toBe(true);
  });

  it("o limite por anunciante não confunde contas de plataformas diferentes", () => {
    const gate = makeQualityGate({ maxPerAdvertiser: 1 });
    expect(gate(fakeAd("meta", 1, { pageId: "clinica" })).ok).toBe(true);
    expect(gate(fakeAd("instagram", 1, { pageId: "clinica" })).ok).toBe(true);
    expect(gate(fakeAd("meta", 2, { pageId: "clinica" })).ok).toBe(false);
  });
});

describe("busca com várias trilhas", () => {
  it("consulta TODAS as trilhas e intercala as peças no bloco", async () => {
    const meta = lane("meta", "meta", 30);
    const ig = lane("instagram_reels", "instagram", 10);
    const { added, state } = await fetchNextBlock({
      run: run({ targetAds: 8 }),
      lanes: [meta, ig],
      userId: "u1",
      deps,
    });
    expect(added).toBe(8);
    expect(meta.provider.fetchPage).toHaveBeenCalledTimes(1);
    expect(ig.provider.fetchPage).toHaveBeenCalledTimes(1);
    expect(state.creditsUsed).toBe(2);
    // O que sobrou fica guardado, por trilha, para sair de graça na próxima.
    expect(state.buffer.filter((a: { lane: string }) => a.lane === "meta")).toHaveLength(26);
    expect(state.buffer.filter((a: { lane: string }) => a.lane === "instagram_reels")).toHaveLength(6);
  });

  it("o bloco alterna as fontes em vez de vir em fatias", async () => {
    let gravados: { source: string }[] = [];
    await fetchNextBlock({
      run: run({ targetAds: 4 }),
      lanes: [lane("meta", "meta", 30), lane("tiktok", "tiktok", 10)],
      userId: "u1",
      deps: {
        ...deps,
        upsertAds: async (_r: string, ads: unknown[]) => {
          gravados = ads as { source: string }[];
          return deps.upsertAds(_r, ads);
        },
      },
    });
    expect(gravados.map((a) => a.source)).toEqual(["meta", "tiktok", "meta", "tiktok"]);
  });

  it("quando uma trilha se esgota cedo, a cota dela passa para as outras", async () => {
    // Perfil com 2 posts e fim: sem redistribuir, o bloco voltaria com 2 + 6 = 8 de 12. A Meta
    // rende 1 por página aqui de propósito — com páginas grandes ela passaria da cota por acaso e o
    // teste não pegaria a falta da redistribuição.
    const perfil = lane("instagram_profile:x", "instagram", 2, 1);
    const meta = lane("meta", "meta", 1);
    const { added } = await fetchNextBlock({
      run: run({ targetAds: 12 }),
      lanes: [perfil, meta],
      userId: "u1",
      deps,
    });
    expect(added).toBe(12);
  });

  it("uma trilha com erro vira nota; as outras seguem", async () => {
    const quebrada = {
      id: "instagram_hashtag",
      label: "Instagram #x",
      provider: { creditsPerPage: 1, fetchPage: vi.fn(async () => Promise.reject(new Error("400 hashtag"))) },
      params: {},
    };
    const { added, note, state } = await fetchNextBlock({
      run: run({ targetAds: 4 }),
      lanes: [quebrada, lane("meta", "meta", 30)],
      userId: "u1",
      deps,
    });
    expect(added).toBe(4);
    expect(note).toMatch(/Instagram #x falhou/);
    // Falha de um bloco não condena a trilha: o próximo "carregar mais" tenta de novo.
    expect(state.lanes.instagram_hashtag.exhausted).toBe(false);
  });

  it("se TODAS as trilhas falham e nada veio, o erro sobe", async () => {
    const quebrada = (id: string) => ({
      id,
      label: id,
      provider: { creditsPerPage: 1, fetchPage: async () => Promise.reject(new Error(`falhou ${id}`)) },
      params: {},
    });
    await expect(
      fetchNextBlock({ run: run({ targetAds: 4 }), lanes: [quebrada("a"), quebrada("b")], userId: "u1", deps })
    ).rejects.toThrow(/falhou a.*falhou b/);
  });

  it("o fim da busca é o fim de TODAS as trilhas", async () => {
    const { state } = await fetchNextBlock({
      run: run({ targetAds: 4 }),
      lanes: [lane("tiktok", "tiktok", 1, 1), lane("meta", "meta", 30)],
      userId: "u1",
      deps,
    });
    expect(state.lanes.tiktok.exhausted).toBe(true);
    expect(isExhausted(state, ["tiktok", "meta"])).toBe(false);
  });
});

describe("runs de antes das trilhas", () => {
  it("o cursor da raiz vira a trilha da primeira fonte, e os vistos ganham prefixo", () => {
    const st = loadState(
      { cursor: "abc", exhausted: false, seen: ["123"], buffer: [{ externalId: "9" }], creditsUsed: 4 },
      ["meta"]
    );
    expect(st.lanes.meta).toMatchObject({ cursor: "abc", exhausted: false });
    expect(st.seen).toEqual(["meta:123"]);
    expect(st.buffer[0].lane).toBe("meta");
    expect(st.creditsUsed).toBe(4);
    expect("cursor" in st).toBe(false);
  });

  it("run antiga esgotada continua esgotada", () => {
    const st = loadState({ cursor: null, exhausted: true, buffer: [] }, ["meta"]);
    expect(isExhausted(st, ["meta"])).toBe(true);
  });
});

describe("Instagram", () => {
  it("o mesmo post vira a mesma peça pelas duas famílias de resposta", () => {
    // Busca de reels / hashtag (formato web).
    const web = normalizeInstagram(
      {
        id: "3714950709444987377",
        shortcode: "DOOJ_zSjcnx",
        url: "https://www.instagram.com/reel/DOOJ_zSjcnx/",
        caption: "Legenda #harmonizacao",
        video_url: "https://cdn/v.mp4",
        thumbnail_src: "https://cdn/t.jpg",
        is_video: true,
        video_duration: 65.7,
        owner: { username: "dra.x", full_name: "Dra X", follower_count: 2000, profile_pic_url: "https://cdn/a.jpg" },
        taken_at: "2025-09-05T12:51:42.000Z",
        like_count: 35854,
        comment_count: 1263,
      },
      "reels"
    );
    // Feed do perfil (formato app/v1).
    const app = normalizeInstagram(
      {
        id: "3714950709444987377_13582495760",
        code: "DOOJ_zSjcnx",
        taken_at: 1757076702,
        media_type: 2,
        product_type: "clips",
        caption: { text: "Legenda #harmonizacao" },
        user: { username: "dra.x", full_name: "Dra X" },
        like_count: 35854,
        play_count: 120000,
        video_versions: [{ url: "https://cdn/v.mp4" }],
        image_versions2: { candidates: [{ url: "https://cdn/t.jpg" }] },
      },
      "perfil:@dra.x"
    );
    for (const ad of [web, app]) {
      expect(ad).toMatchObject({
        source: "instagram",
        externalId: "DOOJ_zSjcnx",
        pageId: "dra.x",
        adCopy: "Legenda #harmonizacao",
        mediaType: "video",
        mediaUrl: "https://cdn/v.mp4",
        startedRunningOn: "2025-09-05",
        displayFormat: "REEL",
      });
    }
    expect(web!.metrics).toMatchObject({ likes: 35854, comments: 1263, followers: 2000 });
    expect(app!.metrics.views).toBe(120000);
  });

  it("reel do perfil vem dentro de `.media` na rota de reels", () => {
    const ad = normalizeInstagram({ media: { code: "ABCDE1", media_type: 2, user: { username: "x" } } });
    expect(ad?.externalId).toBe("ABCDE1");
  });

  it("alvos: @perfil, link de perfil e link de post/reel", () => {
    expect(parseInstagramTarget("@Clinica.X")).toBe("@clinica.x");
    expect(parseInstagramTarget("https://www.instagram.com/clinica.x/")).toBe("@clinica.x");
    expect(parseInstagramTarget("https://www.instagram.com/reel/DOq6eV6iIgD/?igsh=1")).toBe("post:DOq6eV6iIgD");
    expect(parseInstagramTarget("https://instagram.com/p/C1a2B3c4D5e/")).toBe("post:C1a2B3c4D5e");
    expect(parseInstagramTarget("não é nada disso")).toBeNull();
  });

  it("hashtag do tema tira acento e espaço", () => {
    expect(hashtagFromTema("Harmonização Facial")).toBe("harmonizacaofacial");
  });

  it("reels ficam fora quando o filtro pede só imagem, e isso vira nota", () => {
    const { lanes, skipped } = lanesFor({
      tema: "x",
      sources: ["instagram_reels", "instagram_hashtag"],
      settings: { mediaType: "image" },
    });
    expect(lanes.map((l: { id: string }) => l.id)).toEqual(["instagram_hashtag"]);
    expect(skipped[0]).toMatch(/reels/);
  });
});

describe("TikTok", () => {
  it("biblioteca pública: datas em ms viram janela de veiculação", () => {
    const ad = normalizeTikTok({
      id: "1871655924410641",
      url: "https://library.tiktok.com/ads/detail/?ad_id=1871655924410641",
      name: "GYMSHARK LTD",
      adv_biz_ids: "7078923208527618049",
      first_shown_date: Date.parse("2026-07-01T00:00:00Z"),
      last_shown_date: Date.parse("2026-07-31T00:00:00Z"),
      videos: [{ video_url: "https://lib/v.mp4", cover_img: "https://lib/c.jpg" }],
      estimated_audience: "1K-10K",
      spent: "",
      impression: 0,
    });
    expect(ad).toMatchObject({
      source: "tiktok",
      externalId: "1871655924410641",
      pageName: "GYMSHARK LTD",
      startedRunningOn: "2026-07-01",
      daysRunning: 30,
      mediaType: "video",
      mediaUrl: "https://lib/v.mp4",
      thumbUrl: "https://lib/c.jpg",
    });
    // 0 e "" são "não informado" na biblioteca pública, não zero.
    expect(ad!.metrics).toMatchObject({ estimatedAudience: "1K-10K", impressions: null, spent: null });
  });

  it("Top Ads do Creative Center: texto, CTR e o vídeo de maior resolução", () => {
    const ad = normalizeTikTok({
      id: "7646829987799334920",
      ad_title: "I thought this was a gimmick",
      ctr: 0.5,
      like: 92,
      landing_page: "https://www.amazon.com/dp/x",
      creative_center_url: "https://ads.tiktok.com/business/creativecenter/x",
      video_info: { cover: "https://c.jpg", duration: 89.7, video_url: { "540p": "https://540", "720p": "https://720" } },
    });
    expect(ad).toMatchObject({
      adCopy: "I thought this was a gimmick",
      linkUrl: "https://www.amazon.com/dp/x",
      mediaUrl: "https://720",
      durationSec: 89.7,
    });
    expect(ad!.metrics).toMatchObject({ ctr: 0.5, likes: 92 });
  });
});

describe("Instagram › Anúncios", () => {
  it("fica só com o que roda no Instagram, e posicionamento desconhecido fica de fora", async () => {
    const meta = {
      implName: "scrapecreators",
      creditsPerPage: 1,
      fetchPage: async () => ({
        ads: [
          fakeAd("meta", 1, { publisherPlatform: ["FACEBOOK", "INSTAGRAM"] }),
          fakeAd("meta", 2, { publisherPlatform: ["FACEBOOK"] }),
          fakeAd("meta", 3, { publisherPlatform: null }),
        ],
        cursor: "c1",
      }),
    };
    const page = await onlyPlacement(meta, "INSTAGRAM", "instagram_ads").fetchPage({}, null, {});
    expect(page.ads.map((a: { externalId: string }) => a.externalId)).toEqual(["meta-1"]);
    // Continua anúncio da Meta — link, id e replicação são de lá; a trilha é que diz Instagram.
    expect(page.ads[0]).toMatchObject({ source: "meta", foundVia: "instagram_ads" });
    expect(page.cursor).toBe("c1");
  });

  it("com Meta Ads marcada, a trilha não roda — pagaria as mesmas páginas por repetidos", () => {
    const { lanes, skipped } = lanesFor({ tema: "x", sources: ["meta", "instagram_ads"], settings: {} });
    expect(lanes.map((l: { id: string }) => l.id)).toEqual(["meta"]);
    expect(skipped[0]).toMatch(/já vêm na busca Meta Ads/);
  });

  it("o filtro de replicação vale para ela (é anúncio Meta)", () => {
    const gate = makeQualityGate({ minCollationCount: 5 });
    expect(gate(fakeAd("meta", 1, { collationCount: 1, foundVia: "instagram_ads" })).ok).toBe(false);
  });
});
