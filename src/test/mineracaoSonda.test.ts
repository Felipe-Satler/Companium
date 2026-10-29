/**
 * Sonda de palavras-chave.
 *
 * Mede, com 1 crédito por termo, quantos anúncios daquela página passariam nos MESMOS filtros da
 * busca de verdade. É o que substitui o palpite na escolha do termo — e o palpite errado custa o
 * orçamento inteiro, (N/4)*10 créditos.
 */
import { describe, it, expect, vi } from "vitest";
import { MAX_PROBE_TERMS, parseProbeTerms, probeTerms } from "../../apps/ad-spy-worker/probe.js";

function ad(i: number, over: Record<string, unknown> = {}) {
  return {
    externalId: String(1000 + i),
    pageId: `p${i}`,
    pageName: `Clínica ${i}`,
    adCopy: "x".repeat(80),
    daysRunning: 100,
    collationCount: 9,
    ...over,
  };
}

/** Devolve páginas fixas por termo. */
function provider(porTermo: Record<string, unknown[]>, over: Record<string, unknown> = {}) {
  return {
    implName: "scrapecreators",
    fetchPage: vi.fn(async (params: { tema: string }) => ({
      ads: porTermo[params.tema] ?? [],
      cursor: "c1",
      creditsRemaining: null,
    })),
    ...over,
  };
}

describe("parseProbeTerms", () => {
  it("tira repetido, vazio e curto demais, e respeita o teto", () => {
    const termos = parseProbeTerms(
      ["capilar", " capilar ", "", "a", "fue", "longhair", "implante", "turbo", "extra"],
      100,
    );
    expect(termos).toEqual(["capilar", "fue", "longhair", "implante", "turbo"]);
    expect(termos).toHaveLength(MAX_PROBE_TERMS);
  });

  it("corta termo acima do limite de caracteres", () => {
    expect(parseProbeTerms(["ok", "x".repeat(50)], 10)).toEqual(["ok"]);
  });
});

describe("probeTerms", () => {
  it("conta quantos passariam nos filtros, e por que os outros caíram", async () => {
    const p = provider({
      capilar: [
        ad(1, { daysRunning: 200 }),
        ad(2, { daysRunning: 10 }), // reprova na longevidade
        ad(3, { collationCount: 1 }), // reprova na replicação
      ],
    });
    const { resultados, creditsUsed } = await probeTerms({
      termos: ["capilar"],
      settings: { minDaysRunning: 90, minCollationCount: 5 },
      provider: p,
    });

    expect(creditsUsed).toBe(1);
    expect(resultados[0]).toMatchObject({ termo: "capilar", retornados: 3, passaram: 1 });
    expect(resultados[0].motivos).toEqual({
      "roda há pouco tempo": 1,
      "poucos anúncios com o criativo": 1,
    });
  });

  it("conta anunciantes DISTINTOS: oito anúncios de uma clínica não valem oito clínicas", async () => {
    const mesmaClinica = [1, 2, 3].map((i) => ad(i, { pageId: "p-unica" }));
    const p = provider({ a: mesmaClinica, b: [ad(1), ad(2), ad(3)] });
    const { resultados } = await probeTerms({
      termos: ["a", "b"],
      settings: {},
      provider: p,
    });
    expect(resultados[0].anunciantes).toBe(1);
    expect(resultados[1].anunciantes).toBe(3);
  });

  it("usa mediana, não média: um anúncio antigo não disfarça um termo fraco", async () => {
    const p = provider({ x: [ad(1, { daysRunning: 10 }), ad(2, { daysRunning: 20 }), ad(3, { daysRunning: 900 })] });
    const { resultados } = await probeTerms({ termos: ["x"], settings: {}, provider: p });
    expect(resultados[0].medianaDias).toBe(20);
  });

  it("o limite por anunciante não vaza de um termo para o outro", async () => {
    // Com a contagem compartilhada, o segundo termo pareceria pior só por vir depois.
    const tres = [1, 2, 3].map((i) => ad(i, { pageId: "p-unica" }));
    const p = provider({ a: tres, b: tres });
    const { resultados } = await probeTerms({
      termos: ["a", "b"],
      settings: { maxPerAdvertiser: 2 },
      provider: p,
    });
    expect(resultados[0].passaram).toBe(2);
    expect(resultados[1].passaram).toBe(2);
  });

  it("um termo que falha não derruba os outros", async () => {
    const p = provider({ bom: [ad(1)] });
    p.fetchPage = vi.fn(async (params: { tema: string }) => {
      if (params.tema === "ruim") throw new Error("Scrape Creators 402");
      return { ads: [ad(1)], cursor: null, creditsRemaining: null };
    });
    const { resultados } = await probeTerms({
      termos: ["ruim", "bom"],
      settings: {},
      provider: p,
    });
    expect(resultados[0].erro).toMatch(/402/);
    expect(resultados[1].passaram).toBe(1);
  });

  it("fonte sem paginação por cursor não é sondável, e diz isso", async () => {
    await expect(
      probeTerms({ termos: ["x"], settings: {}, provider: { implName: "playwright" } }),
    ).rejects.toThrow(/uma página só/i);
  });
});

describe("probeTerms com várias fontes", () => {
  it("fonte de perfil não é sondável e vira linha de erro, sem gastar", async () => {
    const { resultados, creditsUsed } = await probeTerms({
      termos: ["fue"],
      settings: {},
      fontes: ["instagram_profile"],
    });
    expect(creditsUsed).toBe(0);
    expect(resultados[0]).toMatchObject({ fonte: "instagram_profile", passaram: 0 });
    expect(resultados[0].erro).toMatch(/palavra-chave/);
  });

  it("reels com o filtro só imagem: explica em vez de gastar 1 crédito à toa", async () => {
    const { resultados, creditsUsed } = await probeTerms({
      termos: ["fue"],
      settings: { mediaType: "image" },
      fontes: ["instagram_reels"],
    });
    expect(creditsUsed).toBe(0);
    expect(resultados[0].erro).toMatch(/só imagem/);
  });
});
