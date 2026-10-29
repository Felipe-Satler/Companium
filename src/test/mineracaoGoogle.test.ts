/**
 * Google Ads como fonte: Centro de Transparência de Anúncios, via Scrape Creators.
 *
 * O Google não busca anúncio por palavra-chave — só por anunciante. O que estes testes prendem:
 *
 *   - o modo "pelo tema" paga a busca de ANUNCIANTES uma vez só e depois varre um anunciante de cada
 *     vez, retomando do ponto certo no "carregar mais";
 *   - o que a pessoa cola vira parâmetro de chamada paga, então só passa domínio ou id "AR…";
 *   - o detalhe precisa do anunciante (não só do criativo) — sem ele, a peça selecionada nunca
 *     ganharia texto;
 *   - o anúncio do Google é PAGO: vale a longevidade, não valem os filtros de orgânico.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const scGet = vi.fn();
vi.mock("../../apps/ad-spy-worker/sources/scrapecreators.js", () => ({
  scGet: (...a: unknown[]) => scGet(...a),
  hasKey: () => true,
  requireKey: () => {},
}));

import { fetchNextBlock } from "../../apps/ad-spy-worker/search.js";
import { lanesFor, providerForAd } from "../../apps/ad-spy-worker/sources/index.js";
import { isOrganic, makeQualityGate } from "../../apps/ad-spy-worker/sources/shared.js";
import {
  escolherAnunciantes,
  fetchAdById,
  lerVariacoes,
  needsHydration,
  normalize,
  parseGoogleTarget,
} from "../../apps/ad-spy-worker/sources/google.js";
import { fontesAtivas } from "@/components/marketing/mineracao/filtroFontes";
import { adOpenLinks, type SpyAd } from "@/lib/adSpyApi";

const AR = "AR01614014350098432001";
const CR = "CR08567627846124568577";

const linha = (i: number, over: Record<string, unknown> = {}) => ({
  advertiserId: AR,
  creativeId: `CR0856762784612456${String(8000 + i)}`,
  format: "text",
  adUrl: `https://adstransparency.google.com/advertiser/${AR}/creative/CR0856762784612456${String(8000 + i)}`,
  advertiserName: "Clínica Exemplo Ltda",
  imageUrl: `https://tpc.googlesyndication.com/archive/simgad/${7468813441689462696n + BigInt(i)}`,
  firstShown: "2026-03-11T17:08:22.000Z",
  lastShown: "2026-05-04T17:59:12.000Z",
  ...over,
});

const deps = {
  upsertAds: async (_runId: string, ads: unknown[]) => ads.map((a, i) => ({ ...(a as object), id: i })),
  rehostImages: async () => {},
};

beforeEach(() => {
  scGet.mockReset();
});

describe("normalização", () => {
  it("lê a linha da listagem: anunciante, links, datas e a imagem do criativo", () => {
    expect(normalize(linha(1), "anunciante")).toMatchObject({
      source: "google",
      foundVia: "anunciante",
      externalId: "CR08567627846124568001",
      pageName: "Clínica Exemplo Ltda",
      pageId: AR,
      pageProfileUri: `https://adstransparency.google.com/advertiser/${AR}`,
      startedRunningOn: "2026-03-11",
      daysRunning: 54,
      mediaType: "image",
      thumbUrl: expect.stringContaining("simgad"),
      metrics: { lastShownOn: "2026-05-04", googleFormat: "text" },
    });
  });

  it("vídeo não tem arquivo para baixar: é do YouTube", () => {
    const ad = normalize(linha(1, { format: "video", imageUrl: null }))!;
    expect(ad.mediaType).toBe("video");
    expect(ad.mediaUrl).toBeNull();
    expect(providerForAd("google").downloadable).toBe(false);
  });

  it("sem id de criativo válido não há peça", () => {
    expect(normalize({ advertiserId: AR })).toBeNull();
    expect(normalize({ creativeId: "123" })).toBeNull();
  });

  it("lê das variações o texto, as imagens, o vídeo do YouTube e o site — com o que vier", () => {
    const v = lerVariacoes([
      { headline: "Implante em 1 dia", description: "Avaliação gratuita", destinationUrl: "https://clinica.com.br/implante" },
      { images: ["https://tpc.googlesyndication.com/archive/simgad/1"] },
      { video: { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" } },
      null,
    ]);
    expect(v).toEqual({
      texto: "Implante em 1 dia\nAvaliação gratuita",
      imagens: ["https://tpc.googlesyndication.com/archive/simgad/1"],
      youtubeId: "dQw4w9WgXcQ",
      link: "https://clinica.com.br/implante",
    });
    expect(lerVariacoes(undefined)).toEqual({ imagens: [], texto: "", youtubeId: null, link: null });
  });
});

describe("alvos colados", () => {
  it("aceita id AR…, link do Centro de Transparência, domínio e link de site", () => {
    expect(parseGoogleTarget(AR.toLowerCase())).toBe(`id:${AR}`);
    expect(parseGoogleTarget(`https://adstransparency.google.com/advertiser/${AR}?region=BR`)).toBe(`id:${AR}`);
    expect(parseGoogleTarget("ClinicaExemplo.com.br")).toBe("site:clinicaexemplo.com.br");
    expect(parseGoogleTarget("https://www.clinicaexemplo.com.br/implante?x=1")).toBe("site:clinicaexemplo.com.br");
  });

  it("recusa o que não é nenhum dos dois", () => {
    expect(parseGoogleTarget("clínica exemplo")).toBeNull();
    expect(parseGoogleTarget("https://")).toBeNull();
    expect(parseGoogleTarget("a.b")).toBeNull();
    expect(parseGoogleTarget("")).toBeNull();
  });
});

describe("filtros de qualidade", () => {
  const ad = normalize(linha(1))!;
  it("é anúncio pago: vale a longevidade (do primeiro ao último dia visto)", () => {
    expect(isOrganic("google")).toBe(false);
    expect(makeQualityGate({ minDaysRunning: 30 })(ad).ok).toBe(true);
    expect(makeQualityGate({ minDaysRunning: 90 })(ad)).toMatchObject({ ok: false });
  });
  it("não sofre os filtros que ele não tem como passar: replicação, alcance do TikTok, orgânicos", () => {
    const gate = makeQualityGate({ minCollationCount: 5, minTikTokAudience: 1_000_000, minViews: 1000, minEngagementPct: 1 });
    expect(gate(ad).ok).toBe(true);
  });
});

describe("trilhas", () => {
  const run = (sources: string[], settings: Record<string, unknown> = {}, search_state: unknown = {}) => ({
    id: "r",
    tema: "implante dentário",
    sources,
    settings: { targetAds: 4, country: "BR", ...settings },
    search_state,
  });

  it("anunciantes e sites: uma trilha por alvo, com o filtro de formato e período na listagem", async () => {
    scGet.mockResolvedValueOnce({ ads: [linha(1), linha(2)], cursor: null, credits_charged: 1 });
    const r = run(["google_advertiser"], {
      googleAdvertisers: ["site:clinicaexemplo.com.br", `id:${AR}`],
      mediaType: "image",
      startDate: "2026-01-01",
    });
    const { lanes } = lanesFor(r);
    expect(lanes.map((l: { id: string }) => l.id)).toEqual([
      "google_advertiser:clinicaexemplo.com.br",
      `google_advertiser:${AR}`,
    ]);
    scGet.mockResolvedValueOnce({ ads: [linha(3)], cursor: null });
    await fetchNextBlock({ run: r, lanes, userId: "u", deps });
    expect(scGet.mock.calls[0]).toEqual([
      "/v1/google/company/ads",
      expect.objectContaining({ domain: "clinicaexemplo.com.br", region: "BR", format: "image", start_date: "2026-01-01" }),
      expect.anything(),
    ]);
    expect(scGet.mock.calls[1][1]).toMatchObject({ advertiser_id: AR });
  });

  it("pelo tema: acha os anunciantes do país, os mais ativos primeiro, e varre um de cada vez", () => {
    const json = {
      advertisers: [
        { name: "Implante HK", advertiser_id: "AR01382517811867287553", region: "HK", number_of_ads_estimate: 900 },
        { name: "Implante Pequeno", advertiser_id: "AR12317441102226391041", region: "BR", number_of_ads_estimate: 4 },
        { name: "Implante Grande", advertiser_id: "AR01614014350098432001", region: "BR", number_of_ads_estimate: 700 },
        { name: "id inválido", advertiser_id: "x", region: "BR", number_of_ads_estimate: 9999 },
      ],
    };
    expect(escolherAnunciantes(json, "BR").map((a: { nome: string }) => a.nome)).toEqual([
      "Implante Grande",
      "Implante Pequeno",
    ]);
    // Sem ninguém do país, usa os que houver em vez de voltar vazio.
    expect(escolherAnunciantes(json, "PT")).toHaveLength(3);
  });

  it("pelo tema: paga a busca de anunciantes uma vez, e o 'carregar mais' continua do anunciante certo", async () => {
    const A1 = "AR01614014350098432001";
    const A2 = "AR12317441102226391041";
    scGet.mockImplementation(async (rota: string, params: Record<string, unknown>) => {
      if (rota.endsWith("/advertisers/search")) {
        return {
          credits_charged: 1,
          advertisers: [
            { name: "A1", advertiser_id: A1, region: "BR", number_of_ads_estimate: 50 },
            { name: "A2", advertiser_id: A2, region: "BR", number_of_ads_estimate: 10 },
          ],
        };
      }
      if (params.advertiser_id === A1) {
        return params.cursor
          ? { ads: [linha(3, { advertiserId: A1 })], cursor: null }
          : { ads: [linha(1, { advertiserId: A1 }), linha(2, { advertiserId: A1 })], cursor: "p2" };
      }
      return { ads: [linha(10, { advertiserId: A2 }), linha(11, { advertiserId: A2 })], cursor: null };
    });

    const r = run(["google"], { targetAds: 4 });
    const { lanes } = lanesFor(r);
    const b1 = await fetchNextBlock({ run: r, lanes, userId: "u", deps });
    const rotas = scGet.mock.calls.map((c) => c[0]);
    expect(rotas.filter((x) => x.endsWith("/advertisers/search"))).toHaveLength(1);
    expect(scGet.mock.calls[0][1]).toMatchObject({ query: "implante dentário", region: "BR" });
    // A1 página 1 (2), A1 página 2 (1), A2 (2) -> 4 no bloco, 1 guardado.
    expect(b1.added).toBe(4);

    // "Carregar mais": nada de nova busca de anunciantes, e a trilha já terminou.
    const antes = scGet.mock.calls.length;
    const b2 = await fetchNextBlock({ run: { ...r, search_state: b1.state }, lanes, userId: "u", deps });
    expect(scGet.mock.calls.length).toBe(antes);
    expect(b2.added).toBe(1);
    expect(b2.note).toMatch(/fim da busca/i);
  });

  it("pelo tema, sem anunciante com o tema no nome: a trilha acaba sem gastar mais", async () => {
    scGet.mockResolvedValueOnce({ advertisers: [], credits_charged: 1 });
    const r = run(["google"]);
    const b = await fetchNextBlock({ run: r, lanes: lanesFor(r).lanes, userId: "u", deps });
    expect(scGet).toHaveBeenCalledTimes(1);
    expect(b.added).toBe(0);
    expect(b.state.lanes.google.exhausted).toBe(true);
  });
});

describe("detalhe (peça selecionada)", () => {
  it("usa o anunciante gravado na peça para montar o link do detalhe, e completa o texto", async () => {
    scGet.mockResolvedValueOnce({
      advertiserId: AR,
      creativeId: CR,
      format: "text",
      firstShown: null,
      lastShown: "2025-06-18T18:09:00.000Z",
      overallImpressions: { min: "250000", max: "300000" },
      variations: [{ headline: "Implante em 1 dia", description: "Agende sua avaliação" }],
    });
    const ad = await fetchAdById(CR, { ad: { page_id: AR } });
    expect(scGet.mock.calls[0]).toEqual([
      "/v1/google/ad",
      { url: `https://adstransparency.google.com/advertiser/${AR}/creative/${CR}` },
      expect.anything(),
    ]);
    expect(ad).toMatchObject({
      adCopy: "Implante em 1 dia\nAgende sua avaliação",
      metrics: { impressionsRange: { min: 250000, max: 300000 } },
    });
    // `firstShown: null` no detalhe: sem início, sem longevidade inventada.
    expect(ad!.daysRunning).toBeNull();
  });

  it("vídeo do YouTube: a legenda vira a transcrição", async () => {
    scGet
      .mockResolvedValueOnce({ advertiserId: AR, creativeId: CR, format: "video", variations: [{ videoUrl: "https://youtu.be/dQw4w9WgXcQ" }] })
      .mockResolvedValueOnce({ transcript_only_text: "Oi, eu sou a doutora.", language: "pt" });
    const ad = await fetchAdById(CR, { ad: { page_id: AR } });
    expect(scGet.mock.calls[1]).toEqual([
      "/v1/youtube/video/transcript",
      { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
      expect.anything(),
    ]);
    expect(ad).toMatchObject({ transcript: "Oi, eu sou a doutora.", transcriptLang: "pt" });
  });

  it("sem o anunciante (ou com ids inválidos) não gasta crédito", async () => {
    expect(await fetchAdById(CR, {})).toBeNull();
    expect(await fetchAdById("x", { ad: { page_id: AR } })).toBeNull();
    expect(await fetchAdById(CR, { ad: { page_id: "@perfil" } })).toBeNull();
    expect(scGet).not.toHaveBeenCalled();
  });

  it("todo anúncio selecionado vale o detalhe, uma vez", () => {
    expect(needsHydration({ metrics: {} })).toBe(true);
    expect(needsHydration({ metrics: { hydrated: true } })).toBe(false);
  });
});

describe("tela", () => {
  it("os links são o anúncio, o anunciante e, quando houver, o vídeo e o site", () => {
    const ad = {
      source: "google",
      permalink: `https://adstransparency.google.com/advertiser/${AR}/creative/${CR}`,
      page_profile_uri: `https://adstransparency.google.com/advertiser/${AR}`,
      link_url: "https://clinica.com.br/implante",
      metrics: { youtubeId: "dQw4w9WgXcQ" },
    } as SpyAd;
    expect(adOpenLinks(ad).map((l) => l.label)).toEqual([
      "Anúncio no Centro de Transparência",
      "Todos os anúncios do anunciante",
      "Vídeo no YouTube",
      "Site do anúncio (clinica.com.br)",
    ]);
  });

  it("as duas trilhas do Google acendem a mesma tag de filtro", () => {
    expect([...fontesAtivas(["google", "google_advertiser"])]).toEqual(["google"]);
  });
});
