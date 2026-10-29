import { describe, it, expect, beforeEach } from "vitest";
import {
  carregarRascunho,
  rascunhoInicial,
  salvarRascunho,
} from "@/components/marketing/composer/rascunhoComposer";
import { filtrarDocumentos } from "@/components/marketing/composer/filtrarInsumos";

describe("rascunho da Nova Composição", () => {
  beforeEach(() => localStorage.clear());

  const guardado = {
    cliente: "jose_ramos",
    etapa: "intencao" as const,
    analiseId: "a1",
    brief: false,
    relatorios: ["r1"],
    documentos: ["d1"],
    criativos: ["c0a1f2e3-0000-4000-8000-000000000001", "c0a1f2e3-0000-4000-8000-000000000002"],
    interno: { metaAdId: "120211111111111", nome: "Reel do Dr.", numeros: "set: investimento R$ 10,00" },
    incluirNumeros: true,
    preparo: "c0a1f2e3-0000-4000-8000-000000000009",
    intencao: "dois Stories",
    selecionada: "c1",
  };

  it("volta igual ao que foi guardado", () => {
    salvarRascunho(guardado);
    expect(carregarRascunho()).toEqual(guardado);
  });

  it("rascunho de antes de 20/10 (um criativo só) volta com o criativo que tinha", () => {
    const { criativos: _c, interno: _i, ...resto } = guardado;
    localStorage.setItem(
      "companium:composer:rascunho",
      JSON.stringify({ ...resto, criativo: { tipo: "concorrente", id: "c-antigo" } }),
    );
    expect(carregarRascunho()).toMatchObject({ criativos: ["c-antigo"], interno: null });
    localStorage.setItem(
      "companium:composer:rascunho",
      JSON.stringify({ ...resto, criativo: { tipo: "interno", metaAdId: "1202", nome: "Reel", numeros: null } }),
    );
    expect(carregarRascunho()).toMatchObject({ criativos: [], interno: { metaAdId: "1202", nome: "Reel", numeros: null } });
  });

  it("armazenamento estragado vira 'sem rascunho', não erro", () => {
    localStorage.setItem("companium:composer:rascunho", "{quebrado");
    expect(carregarRascunho()).toBeNull();
    localStorage.setItem("companium:composer:rascunho", JSON.stringify({ cliente: "x", etapa: "inventada" }));
    expect(carregarRascunho()?.etapa).toBe("cliente");
  });

  it("sem cliente no link, ou com o MESMO cliente, continua o rascunho", () => {
    expect(rascunhoInicial("", guardado)).toEqual(guardado);
    expect(rascunhoInicial("jose_ramos", guardado)).toEqual(guardado);
  });

  it("link de OUTRO cliente começa do zero, na etapa de insumos", () => {
    const r = rascunhoInicial("outro", guardado);
    expect(r).toMatchObject({ cliente: "outro", etapa: "insumos", analiseId: null, documentos: [], selecionada: null });
  });

  it("sem rascunho e sem link, começa escolhendo o cliente", () => {
    expect(rascunhoInicial("", null).etapa).toBe("cliente");
  });

  it("link com análise troca só a análise e volta aos insumos, mantendo o resto", () => {
    const r = rascunhoInicial("", guardado, "a2");
    expect(r).toEqual({ ...guardado, analiseId: "a2", etapa: "insumos", selecionada: null });
  });

  it("link com a MESMA análise do rascunho não mexe em nada (F5 com ?analise= na URL)", () => {
    expect(rascunhoInicial("", guardado, "a1")).toEqual(guardado);
  });

  it("link com análise e sem rascunho começa escolhendo o cliente, com a análise marcada", () => {
    expect(rascunhoInicial("", null, "a2")).toMatchObject({ cliente: "", etapa: "cliente", analiseId: "a2" });
  });

  it("link com análise e OUTRO cliente começa do zero com a análise marcada", () => {
    expect(rascunhoInicial("outro", guardado, "a2")).toMatchObject({
      cliente: "outro",
      etapa: "insumos",
      analiseId: "a2",
      documentos: [],
    });
  });
});

describe("filtrarDocumentos", () => {
  const docs = [
    { id: "1", nome: "Mapeamento - Dra. Amanda", local: "MktOps › Mapeamento do Cliente", docNome: null },
    { id: "2", nome: "Acessos", local: "Clientes › Amanda", docNome: "Credenciais" },
  ];

  it("casa pelo título, pela pasta e pelo Doc, sem ligar para acento e caixa", () => {
    expect(filtrarDocumentos(docs, "mapeamento").map((d) => d.id)).toEqual(["1"]);
    expect(filtrarDocumentos(docs, "MKTOPS").map((d) => d.id)).toEqual(["1"]);
    expect(filtrarDocumentos(docs, "credenciais").map((d) => d.id)).toEqual(["2"]);
    expect(filtrarDocumentos(docs, "drá").map((d) => d.id)).toEqual(["1"]);
  });

  it("busca vazia devolve tudo", () => {
    expect(filtrarDocumentos(docs, "  ")).toHaveLength(2);
  });
});
