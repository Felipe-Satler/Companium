/**
 * Experimento JEV: a comparação DENTRO do mesmo anunciante, e a rota que traz todos os anúncios
 * de um anunciante.
 *
 * O teste principal monta uma confusão de propósito: um anunciante grande que faz anúncios longos e
 * quase não usa prova, e um pequeno que faz anúncios curtos e usa prova sempre — mas DENTRO de cada
 * um, o criativo com prova é o que dura mais. Comparando todos juntos, "prova" parece piorar o
 * anúncio; dentro do anunciante, ela ajuda. Foi esse tipo de confusão que apagou o resultado do
 * corpus de 66 peças.
 */
import { describe, it, expect, vi } from "vitest";

const scGet = vi.fn();
vi.mock("../../apps/ad-spy-worker/sources/scrapecreators.js", () => ({
  scGet: (...a: unknown[]) => scGet(...a),
  hasKey: () => true,
  requireKey: () => {},
}));

import { comparacaoPorAnunciante, correlacao, mediana } from "../../apps/ad-spy-worker/experimentos/jev/jev-lib.js";
import { fetchCompanyPage } from "../../apps/ad-spy-worker/sources/meta-scrapecreators.js";

type Peca = { pagina: string; anunciante: string; dias: number; ativo: boolean; prova: number };
const peca = (pagina: string, dias: number, ativo: boolean, prova: number): Peca => ({ pagina, anunciante: pagina, dias, ativo, prova });
const sinal = [{ rotulo: "prova", valor: (x: Peca) => x.prova }];

describe("comparação dentro do anunciante", () => {
  // Grande: longos, prova rara — mas os com prova duram mais. Pequeno: curtos, prova comum — idem.
  const grande = [
    peca("G", 300, false, 1), peca("G", 280, false, 0), peca("G", 200, false, 0),
    peca("G", 150, false, 0), peca("G", 120, false, 0), peca("G", 400, true, 1),
  ];
  const pequeno = [
    peca("P", 40, false, 1), peca("P", 35, false, 1), peca("P", 20, false, 1),
    peca("P", 8, false, 0), peca("P", 5, false, 0), peca("P", 3, true, 1), // ativo novo: desfecho desconhecido
  ];
  const todas = [...grande, ...pequeno];

  it("entre todos juntos, a prova parece encurtar o anúncio (a confusão)", () => {
    expect(correlacao(todas.map((x) => x.prova), todas.map((x) => Math.log1p(x.dias)))!).toBeLessThan(0);
  });

  it("dentro de cada anunciante, a prova aparece nos que duram — nos dois", () => {
    const { anunciantes, resultados } = comparacaoPorAnunciante(todas, sinal);
    expect(anunciantes.map((a) => a.chave)).toEqual(["G", "P"]);
    expect(resultados[0].diferenca).toBeGreaterThan(0.4);
    expect(resultados[0]).toMatchObject({ positivos: 2, negativos: 0 });
  });

  it("corte pela mediana dos TERMINADOS; ativo abaixo do corte fica de fora, acima conta como longo", () => {
    const { anunciantes } = comparacaoPorAnunciante(todas, sinal);
    const p = anunciantes.find((a) => a.chave === "P")!;
    expect(p.corte).toBe(20);
    expect(p.longos.map((x) => x.dias)).toEqual([40, 35, 20]);
    expect(p.curtos.map((x) => x.dias)).toEqual([8, 5]);
    // O ativo de 3 dias não é longo nem curto. O de 400 do G passou do corte: é longo.
    expect(anunciantes.find((a) => a.chave === "G")!.longos.some((x) => x.ativo)).toBe(true);
  });

  it("anunciante com poucos criativos terminados fica de fora", () => {
    const { anunciantes } = comparacaoPorAnunciante([peca("X", 10, false, 1), peca("X", 90, false, 0)], sinal);
    expect(anunciantes).toHaveLength(0);
  });

  it("mediana", () => {
    expect(mediana([3, 1, 2])).toBe(2);
    expect(mediana([4, 1, 2, 3])).toBe(2.5);
    expect(mediana([])).toBeNull();
  });
});

describe("todos os anúncios de um anunciante (Company Ads)", () => {
  it("pede ativos E inativos pelo page_id, e o inativo vem com a vida inteira", async () => {
    scGet.mockResolvedValue({
      results: [
        {
          ad_archive_id: "1234567890123",
          page_id: "998877665544",
          page_name: "Clínica X",
          is_active: false,
          start_date: Date.parse("2026-01-01T00:00:00Z") / 1000,
          end_date: Date.parse("2026-01-11T00:00:00Z") / 1000,
          collation_count: 2,
          snapshot: { body: { text: "Texto do anúncio" }, page_like_count: 5000 },
        },
      ],
      cursor: "abc",
      credits_charged: 1,
    });
    const pg = await fetchCompanyPage("998877665544", null);
    expect(scGet).toHaveBeenCalledWith(
      "/v1/facebook/adLibrary/company/ads",
      expect.objectContaining({ pageId: "998877665544", status: "ALL" }),
      expect.anything()
    );
    expect(pg.ads[0]).toMatchObject({ externalId: "1234567890123", isActive: false, daysRunning: 10, pageId: "998877665544" });
    expect(pg).toMatchObject({ cursor: "abc", credits: 1 });
  });
});
