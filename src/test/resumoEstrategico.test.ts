// O Resumo Estratégico é reconhecido pelo NOME, na tela e no worker, pela mesma regra.
import { describe, it, expect } from "vitest";
import { ehPaginaDeResumo, ehResumoEstrategico, ehTopoDoResumo } from "../../shared/resumo-estrategico.js";
import { idsDoResumoEstrategico } from "@/components/marketing/composer/filtrarInsumos";

describe("Resumo Estratégico", () => {
  it("pelo nome, sem ligar para acento, caixa ou numeração na frente", () => {
    for (const n of ["Resumo Estratégico", "resumo estrategico – Dr. José", "2. Resumo Estratégico", "01 - Resumo Estratégico"]) {
      expect(ehResumoEstrategico(n)).toBe(true);
    }
    for (const n of ["Resumo da reunião", "Estudo de Copy", "Estratégia 2026", ""]) {
      expect(ehResumoEstrategico(n)).toBe(false);
    }
  });

  it("subpágina de Resumo é Resumo, mas só a página de cima é marcada", () => {
    const sub = { nome: "Parte 1", caminho: ["Central de Copy - X", "Resumo Estratégico"] };
    expect(ehPaginaDeResumo(sub)).toBe(true);
    expect(ehTopoDoResumo(sub)).toBe(false);
    expect(
      idsDoResumoEstrategico([
        { id: "r", nome: "Resumo Estratégico", caminho: ["Central de Copy - X"] },
        { id: "s", ...sub },
        { id: "o", nome: "Estratégia 2026", caminho: [] },
      ]),
    ).toEqual(["r"]);
  });
});
