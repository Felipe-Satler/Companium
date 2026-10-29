import { describe, it, expect } from "vitest";
import { agregarMarketingConta, montarMarketing, type AnuncioMkt } from "./relatorioSnapshot";

// Anúncios reconstruídos do caso Dr. Diego (V009 vence, V008 é o pior) + ruído de baixo volume e um
// anúncio sem resultado, exercitando seleção, custo/resultado não-calculável e a média ponderada. IM é
// ESTÁTICO otimizado para Conversas — o caso que quebrava quando usávamos só cadastro (resultado 0).
const V009: AnuncioMkt = {
  adId: "9", codigo: "V009", formato: "video", objetivo: "geracao_demanda", status: "ativo",
  hookRate: 24.08, holdRate: 1.03, resultados: 96, tipoResultado: "Cadastros", thumbnail: null,
  gasto: 1369.92, cliques: 1200, impressoes: 40000,
};
const V008: AnuncioMkt = {
  adId: "8", codigo: "V008", formato: "video", objetivo: "geracao_demanda", status: "ativo",
  hookRate: 14.76, holdRate: 0.8, resultados: 21, tipoResultado: "Cadastros", thumbnail: null,
  gasto: 564.9, cliques: 300, impressoes: 20000,
};
const IM: AnuncioMkt = {
  adId: "im", codigo: "IM007", formato: "estatico", objetivo: "geracao_demanda", status: "ativo",
  hookRate: 0, holdRate: 0, resultados: 40, tipoResultado: "Conversas iniciadas", thumbnail: "https://x/y.jpg",
  gasto: 200, cliques: 250, impressoes: 10000,
};
const SEM_RES: AnuncioMkt = {
  adId: "z", codigo: "V000", formato: "video", objetivo: "geracao_demanda", status: "pausado",
  hookRate: 10, holdRate: 0.5, resultados: 0, tipoResultado: "—", thumbnail: null,
  gasto: 300, cliques: 50, impressoes: 5000,
};
const RUIDO: AnuncioMkt = {
  adId: "r", codigo: "R1", formato: "video", objetivo: "geracao_demanda", status: "ativo",
  hookRate: 99, holdRate: 9, resultados: 1, tipoResultado: "Cadastros", thumbnail: null,
  gasto: 5, cliques: 2, impressoes: 50,
};
const SEGUIDOR: AnuncioMkt = {
  adId: "s", codigo: "S1", formato: "video", objetivo: "seguidores", status: "ativo",
  hookRate: 30, holdRate: 2, resultados: 0, tipoResultado: "Seguidores", thumbnail: null,
  gasto: 100, cliques: 400, impressoes: 8000,
};

describe("montarMarketing", () => {
  const m = montarMarketing(true, [V009, V008, IM, SEM_RES, RUIDO, SEGUIDOR]);

  it("ignora seguidores e ruído de baixa impressão na base", () => {
    // 4 de demanda acima de 300 impressões (V009, V008, IM, SEM_RES); RUIDO(50) e SEGUIDOR fora.
    expect(m.totalAnuncios).toBe(4);
  });

  it("criativos ordenados por resultado desc (melhores no topo)", () => {
    expect(m.criativos.map((c) => c.codigo)).toEqual(["V009", "IM007", "V008", "V000"]);
  });

  it("estático otimizado p/ Conversas conta resultado (não fica em 0) e leva o tipo", () => {
    const im = m.criativos.find((c) => c.codigo === "IM007")!;
    expect(im.resultados).toBe(40);
    expect(im.tipoResultado).toBe("Conversas iniciadas");
    expect(im.cpl).toBeCloseTo(200 / 40, 4); // custo por resultado
    expect(im.formato).toBe("estatico");
    expect(im.hookRate).toBe(0); // estático mantém ~0 (a tela mostra "n/a")
    expect(im.thumbnail).toBe("https://x/y.jpg");
  });

  it("gastão sem resultado entra garantido, com custo/resultado null", () => {
    const semRes = m.criativos.find((c) => c.codigo === "V000")!;
    expect(semRes.cpl).toBeNull();
    expect(semRes.resultados).toBe(0);
  });

  it("anexa análise por adId quando existe", () => {
    const comAnalise = montarMarketing(true, [V009], {
      "9": { resumo: "depoimento", tendencia: "melhorando", positivos: ["prova social"], melhorar: [], ajustar: [] },
    });
    expect(comAnalise.criativos[0].analise?.resumo).toBe("depoimento");
  });

  it("indisponível/vazio não quebra", () => {
    const vazio = montarMarketing(true, []);
    expect(vazio.totalAnuncios).toBe(0);
    expect(vazio.criativos).toEqual([]);
  });
});

describe("agregarMarketingConta", () => {
  it("Hook/Hold ponderado por impressão; CPC e custo/resultado da conta", () => {
    const c = agregarMarketingConta([V009, IM]);
    const impr = 40000 + 10000;
    expect(c.hookRate).toBeCloseTo((24.08 * 40000 + 0 * 10000) / impr, 4);
    expect(c.cpc).toBeCloseTo((1369.92 + 200) / (1200 + 250), 4);
    // Soma resultados mesmo com tipos diferentes (Cadastros + Conversas) — igual ao dashboard.
    expect(c.resultadosMeta).toBe(96 + 40);
    expect(c.custoResultadoMeta).toBeCloseTo((1369.92 + 200) / (96 + 40), 4);
  });

  it("cliques/resultado zero → CPC e custo/resultado null (não calculável)", () => {
    const c = agregarMarketingConta([{ ...V009, cliques: 0, resultados: 0 }]);
    expect(c.cpc).toBeNull();
    expect(c.custoResultadoMeta).toBeNull();
  });
});
