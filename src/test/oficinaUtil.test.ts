/**
 * Oficina de Artes: as partes puras — o corte da legenda nos mockups, os anúncios que viram arte e
 * o filtro das Artes Salvas.
 */
import { describe, it, expect } from "vitest";
import { cortarLegenda, legendaComHashtags, CORTE_INSTAGRAM } from "@/components/marketing/oficina/legenda";
import { anunciosParaArte, composicoesComArte } from "@/components/marketing/oficina/anuncios";
import { filtrarArtes } from "@/components/marketing/oficina/filtrarArtes";
import type { ComposicaoResumo } from "@/lib/adComposerApi";
import type { Arte } from "@/lib/artesApi";

describe("legenda", () => {
  it("põe as hashtags no fim, com # uma vez só", () => {
    expect(legendaComHashtags("Texto.", ["sono", "#apneia", " ", "##ronco"])).toBe("Texto.\n\n#sono #apneia #ronco");
    expect(legendaComHashtags("Texto.", [])).toBe("Texto.");
  });

  it("corta no fim de uma palavra antes do limite", () => {
    const texto = "Ronco não é só barulho. ".repeat(10);
    const { visivel, cortada } = cortarLegenda(texto, CORTE_INSTAGRAM);
    expect(cortada).toBe(true);
    expect(visivel.length).toBeLessThanOrEqual(CORTE_INSTAGRAM);
    expect(texto.startsWith(visivel)).toBe(true);
    expect(visivel.endsWith(" ")).toBe(false);
  });

  it("para no fim do primeiro parágrafo, que o feed já esconde", () => {
    expect(cortarLegenda("Primeira linha.\n\nSegundo parágrafo.", 125)).toEqual({ visivel: "Primeira linha.", cortada: true });
  });

  it("texto curto não corta", () => {
    expect(cortarLegenda("Curto.", 125)).toEqual({ visivel: "Curto.", cortada: false });
  });
});

const composicao = (over: Partial<ComposicaoResumo> = {}) =>
  ({
    id: "c1",
    cliente: "dr_fulano",
    status: "ok",
    formato: null,
    plano: [
      { formato: "instagram_reels", angulo: "Reels", status: "ok" },
      { formato: "instagram_feed", angulo: "Feed", status: "ok" },
      { formato: "meta_ads", angulo: "Pago", status: "error" },
      { formato: "google_ads", angulo: "Busca", status: "ok" },
    ],
    ...over,
  }) as ComposicaoResumo;

describe("anúncios que viram arte", () => {
  it("lista todos, com o motivo dos que não viram", () => {
    const lista = anunciosParaArte(composicao());
    expect(lista.map((a) => a.elegivel)).toEqual([false, true, false, false]);
    expect(lista[0].motivo).toMatch(/vídeo/);
    expect(lista[2].motivo).toMatch(/não ficou pronto/);
    expect(lista[3].motivo).toMatch(/imagem/);
  });

  it("só composições salvas e com ao menos um anúncio de imagem", () => {
    const so_reels = composicao({ id: "c2", plano: [{ formato: "instagram_reels", angulo: null, status: "ok" }] });
    const em_revisao = composicao({ id: "c3", status: "revisao" });
    expect(composicoesComArte([composicao(), so_reels, em_revisao]).map((c) => c.id)).toEqual(["c1"]);
  });
});

const arte = (over: Partial<Arte>) =>
  ({ id: "a", cliente: "x", formato_origem: "instagram_feed", opcoes: { uso: "organico" }, ...over }) as Arte;

describe("filtrarArtes", () => {
  const artes = [
    arte({ id: "1", cliente: "dra_ana", opcoes: { uso: "pago" } as Arte["opcoes"], formato_origem: "meta_ads" }),
    arte({ id: "2", cliente: "dr_bruno" }),
    arte({ id: "3", cliente: "dra_ana" }),
  ];
  const esp = (c: string) => (c === "dra_ana" ? ["Dermatologia"] : ["Medicina do Sono"]);
  const tudo = { cliente: null, especialidades: [], uso: null, formato: null };

  it("sem filtro, todas, na ordem que vieram", () => {
    expect(filtrarArtes(artes, tudo, esp).map((a) => a.id)).toEqual(["1", "2", "3"]);
  });

  it("filtra por cliente, uso, formato e especialidade do cliente", () => {
    expect(filtrarArtes(artes, { ...tudo, cliente: "dra_ana" }, esp).map((a) => a.id)).toEqual(["1", "3"]);
    expect(filtrarArtes(artes, { ...tudo, uso: "pago" }, esp).map((a) => a.id)).toEqual(["1"]);
    expect(filtrarArtes(artes, { ...tudo, formato: "instagram_feed" }, esp).map((a) => a.id)).toEqual(["2", "3"]);
    expect(filtrarArtes(artes, { ...tudo, especialidades: ["Medicina do Sono"] }, esp).map((a) => a.id)).toEqual(["2"]);
  });
});
