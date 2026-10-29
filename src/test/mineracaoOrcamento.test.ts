/**
 * Alvo de anúncios e orçamento de créditos da busca.
 *
 * A Scrape Creators cobra por REQUISIÇÃO, e os filtros que mais importam só podem ser aplicados
 * DEPOIS da resposta. Com filtro apertado, uma página pode não trazer nada que preste — então o
 * gasto tem de ter teto, e o teto é amarrado ao tamanho do pedido: (N/4) * 10.
 */
import { describe, it, expect, vi } from "vitest";
import { creditBudget, fetchNextBlock, targetAds } from "../../apps/ad-spy-worker/search.js";

function fakeAd(i: number, over: Record<string, unknown> = {}) {
  return {
    source: "meta",
    externalId: String(1000000 + i),
    pageName: `Anunciante ${i}`,
    pageId: `p${i}`,
    adCopy: "x".repeat(80),
    daysRunning: 200,
    collationCount: 9,
    mediaType: "video",
    ...over,
  };
}

/** Provider de mentira: cada página devolve `porPagina` anúncios, para sempre. */
function providerFake(porPagina: number, over: Record<string, unknown> = {}) {
  let n = 0;
  return {
    implName: "scrapecreators",
    fetchPage: vi.fn(async () => {
      const ads = Array.from({ length: porPagina }, () => fakeAd(n++, over));
      return { ads, cursor: `c${n}`, creditsRemaining: null };
    }),
  };
}

const deps = {
  upsertAds: async (_runId: string, ads: unknown[]) => ads.map((a, i) => ({ ...(a as object), id: i })),
  rehostImages: async () => {},
};

const run = (settings: Record<string, unknown>) => ({
  id: "run-1",
  tema: "transplante capilar",
  settings,
  search_state: {},
});

describe("alvo de anúncios", () => {
  it("arredonda para o múltiplo de 4 mais próximo, dentro dos limites", () => {
    expect(targetAds({ targetAds: 12 })).toBe(12);
    expect(targetAds({ targetAds: 13 })).toBe(12);
    expect(targetAds({ targetAds: 14 })).toBe(16);
    expect(targetAds({ targetAds: 1 })).toBe(4);
    expect(targetAds({ targetAds: 9999 })).toBe(40);
  });

  it("orçamento é 10 créditos por grupo de 4", () => {
    expect(creditBudget(4)).toBe(10);
    expect(creditBudget(12)).toBe(30);
    expect(creditBudget(40)).toBe(100);
  });
});

describe("busca com alvo e orçamento", () => {
  it("para assim que junta o alvo, sem gastar crédito à toa", async () => {
    const provider = providerFake(5);
    const { added, state } = await fetchNextBlock({
      run: run({ targetAds: 12, minDaysRunning: 0, minCollationCount: 0 }),
      provider,
      userId: "u1",
      deps,
    });
    expect(added).toBe(12);
    // 3 páginas de 5 = 15 >= 12. A 15ª sobra vai para o buffer e sai de graça na próxima.
    expect(provider.fetchPage).toHaveBeenCalledTimes(3);
    expect(state.creditsUsed).toBe(3);
    expect(state.buffer).toHaveLength(3);
    expect(state.totalFound).toBe(12);
  });

  it("estoura o orçamento antes do alvo quando o filtro reprova tudo, e conta os descartados", async () => {
    // Todo anúncio roda há 1 dia: nenhum passa num filtro de 90.
    const provider = providerFake(5, { daysRunning: 1 });
    const { added, state, note } = await fetchNextBlock({
      run: run({ targetAds: 4, minDaysRunning: 90 }),
      provider,
      userId: "u1",
      deps,
    });
    expect(added).toBe(0);
    // Orçamento de 4 anúncios = 10 créditos, e para exatamente aí em vez de seguir drenando.
    expect(provider.fetchPage).toHaveBeenCalledTimes(10);
    expect(state.creditsUsed).toBe(10);
    expect(state.totalRejected).toBe(50);
    expect(note).toMatch(/orçamento/i);
    expect(note).toMatch(/descartado/i);
  });

  it("o gasto acumula entre buscas, mas o orçamento é de cada uma", async () => {
    const provider = providerFake(5, { daysRunning: 1 });
    const primeira = await fetchNextBlock({
      run: run({ targetAds: 4, minDaysRunning: 90 }),
      provider,
      userId: "u1",
      deps,
    });
    const segunda = await fetchNextBlock({
      run: { ...run({ targetAds: 4, minDaysRunning: 90 }), search_state: primeira.state },
      provider,
      userId: "u1",
      deps,
    });
    expect(segunda.state.creditsUsed).toBe(20);
    expect(segunda.state.totalRejected).toBe(100);
  });
});
