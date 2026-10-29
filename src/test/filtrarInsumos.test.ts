/**
 * Os filtros da etapa de insumos do Composer.
 *
 * Dois comportamentos aqui não são óbvios e são onde um filtro "que funciona" engana:
 *
 * 1. **O recorte de data é por SOBREPOSIÇÃO.** Exigir que o relatório caiba inteiro na janela
 *    esconderia o mais útil — quem filtra "setembro" quer o relatório de setembro.
 * 2. **Nenhum filtro esconde o que já está selecionado.** Um card invisível que entra no prompt é
 *    a pior combinação possível: quem lê a ideia depois não sabe com o que ela foi feita.
 */
import { describe, it, expect } from "vitest";
import {
  categoriasDasAnalises,
  filtrarPorCategoria,
  filtrarRelatorios,
  mantendoSelecionados,
} from "@/components/marketing/composer/filtrarInsumos";
import type { RelatorioResumo } from "@/lib/clientReportsApi";
import type { LibraryEntrySummary } from "@/lib/adSpyApi";

const rel = (over: Partial<RelatorioResumo> = {}) =>
  ({
    id: "r1",
    titulo: null,
    periodo_label: "Setembro",
    periodo_de: "2026-09-01",
    periodo_ate: "2026-09-30",
    ...over,
  }) as RelatorioResumo;

const ana = (over: Partial<LibraryEntrySummary> = {}) =>
  ({
    id: "a1",
    tema: "antes e depois",
    titulo: null,
    especialidades: ["Cirurgia Vascular"],
    favorito: false,
    ...over,
  }) as LibraryEntrySummary;

describe("filtrarRelatorios — busca por nome", () => {
  it("acha pelo nome dado pela pessoa", () => {
    const lista = [rel({ id: "r1" }), rel({ id: "r2", titulo: "Depois da troca de oferta" })];
    expect(filtrarRelatorios(lista, { busca: "troca" }).map((r) => r.id)).toEqual(["r2"]);
  });

  it("sem nome dado, acha pelo rótulo do período — é o nome que o relatório tem", () => {
    expect(filtrarRelatorios([rel()], { busca: "setembro" })).toHaveLength(1);
  });

  it("ignora acento e caixa", () => {
    // "Harmonizacao" tem de achar "Harmonização": quem digita rápido não põe acento.
    const lista = [rel({ titulo: "Relatório de Harmonização" })];
    expect(filtrarRelatorios(lista, { busca: "HARMONIZACAO" })).toHaveLength(1);
  });

  it("com nome dado, NÃO acha pelo período — o período tem campo próprio", () => {
    // Dois controles respondendo pela mesma coisa, de formas diferentes, é pior que um.
    const lista = [rel({ titulo: "Depois da troca de oferta" })];
    expect(filtrarRelatorios(lista, { busca: "setembro" })).toHaveLength(0);
  });
});

describe("filtrarRelatorios — recorte de data", () => {
  const setembro = rel({ periodo_de: "2026-09-01", periodo_ate: "2026-09-30" });

  it("pega quem se SOBREPÕE à janela, não só quem cabe dentro", () => {
    // 15/set a 15/out: setembro não cabe dentro, mas fala em parte do período pedido.
    expect(filtrarRelatorios([setembro], { de: "2026-09-15", ate: "2026-10-15" })).toHaveLength(1);
  });

  it("quem termina antes da janela fica fora", () => {
    expect(filtrarRelatorios([setembro], { de: "2026-10-01", ate: "2026-10-31" })).toHaveLength(0);
  });

  it("quem começa depois da janela fica fora", () => {
    expect(filtrarRelatorios([setembro], { de: "2026-07-01", ate: "2026-08-31" })).toHaveLength(0);
  });

  it("uma ponta só já recorta", () => {
    // O DateRangePicker deixa escolher só o início; exigir as duas pontas travaria o filtro.
    expect(filtrarRelatorios([setembro], { de: "2026-09-20" })).toHaveLength(1);
    expect(filtrarRelatorios([setembro], { de: "2026-10-01" })).toHaveLength(0);
    expect(filtrarRelatorios([setembro], { ate: "2026-08-31" })).toHaveLength(0);
  });

  it("nenhuma ponta não recorta nada", () => {
    expect(filtrarRelatorios([setembro], {})).toHaveLength(1);
  });

  it("nome e data se somam", () => {
    const lista = [
      rel({ id: "r1", titulo: "Troca de oferta", periodo_de: "2026-09-01", periodo_ate: "2026-09-30" }),
      rel({ id: "r2", titulo: "Troca de oferta", periodo_de: "2026-07-01", periodo_ate: "2026-07-31" }),
    ];
    const out = filtrarRelatorios(lista, { busca: "troca", de: "2026-09-01", ate: "2026-09-30" });
    expect(out.map((r) => r.id)).toEqual(["r1"]);
  });
});

describe("categoriasDasAnalises", () => {
  it("devolve só as categorias que as análises TÊM, em ordem", () => {
    // Oferecer uma categoria que não devolve nada é um filtro pior do que não oferecer.
    const lista = [
      ana({ id: "a1", especialidades: ["Ortopedia", "Cirurgia Vascular"] }),
      ana({ id: "a2", especialidades: ["Cirurgia Vascular"] }),
    ];
    expect(categoriasDasAnalises(lista)).toEqual(["Cirurgia Vascular", "Ortopedia"]);
  });

  it("lista vazia não inventa categoria", () => {
    expect(categoriasDasAnalises([])).toEqual([]);
  });
});

describe("filtrarPorCategoria", () => {
  const lista = [
    ana({ id: "a1", especialidades: ["Cirurgia Vascular"] }),
    ana({ id: "a2", especialidades: ["Harmonização Facial"] }),
    ana({ id: "a3", especialidades: ["Cirurgia Vascular", "Ortopedia"] }),
  ];

  it("sem categoria escolhida, passa tudo", () => {
    expect(filtrarPorCategoria(lista, [])).toHaveLength(3);
  });

  it("passa quem tem ALGUMA das categorias pedidas", () => {
    expect(filtrarPorCategoria(lista, ["Ortopedia"]).map((a) => a.id)).toEqual(["a3"]);
    expect(filtrarPorCategoria(lista, ["Cirurgia Vascular"]).map((a) => a.id)).toEqual(["a1", "a3"]);
  });
});

describe("mantendoSelecionados", () => {
  const todos = ["a", "b", "c"];

  it("devolve o selecionado mesmo quando o filtro o excluiu", () => {
    expect(mantendoSelecionados(todos, ["c"], (x) => x === "a")).toEqual(["a", "c"]);
  });

  it("preserva a ordem original — o reencaixe não joga o selecionado para o fim", () => {
    expect(mantendoSelecionados(todos, ["a", "c"], (x) => x === "b")).toEqual(["a", "b", "c"]);
  });

  it("não duplica quem passou no filtro E está selecionado", () => {
    expect(mantendoSelecionados(todos, ["a", "b"], (x) => x === "a")).toEqual(["a", "b"]);
  });

  it("sem nada selecionado, é o filtro puro", () => {
    expect(mantendoSelecionados(todos, ["b"], () => false)).toEqual(["b"]);
  });
});
