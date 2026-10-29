/**
 * A spec compartilhada do Relatório: as métricas e a regra do período comparável.
 *
 * A regra de comparação é onde um erro passa mais fácil e custa mais caro: comparar 9 dias com um mês
 * inteiro dá uma queda inventada de 70%, e o relatório afirma isso com confiança.
 */
import { describe, it, expect } from "vitest";
import {
  METRICAS_RELATORIO,
  METRICA_IDS,
  diasNoPeriodo,
  getMetrica,
  janelaComparavel,
} from "../../shared/relatorio-metricas";

describe("METRICAS_RELATORIO", () => {
  it("a direção de cada métrica está certa — é ela que decide 'melhorou' ou 'piorou'", () => {
    // CPL é custo: menor é melhor. Se virar "higher", o relatório comemora CPL subindo.
    expect(getMetrica("cplCRM")?.direcao).toBe("lower");
    // Investimento não se julga sozinho: gastar mais não é bom nem ruim.
    expect(getMetrica("investimento")?.direcao).toBe("neutral");
    expect(getMetrica("leadsCRM")?.direcao).toBe("higher");
    expect(getMetrica("roas")?.direcao).toBe("higher");
    expect(getMetrica("faturamento")?.direcao).toBe("higher");
  });

  it("traz as etapas de funil, sem as quais o gargalo é chute", () => {
    expect(METRICA_IDS).toContain("orcamentoCount");
    expect(METRICA_IDS).toContain("consAgend");
    expect(METRICA_IDS).toContain("consReal");
    expect(METRICA_IDS).toContain("procAgend");
    expect(METRICA_IDS).toContain("procReal");
  });

  it("toda métrica com meta aponta para uma metaKey de META_FIELDS", async () => {
    // Paridade com o cadastro de metas: uma metaKey inventada viraria "sem meta" silencioso.
    const { META_FIELDS } = await import("@/hooks/useClientesMetas");
    const validas = Object.keys(META_FIELDS);
    for (const m of METRICAS_RELATORIO.filter((x) => x.metaKey)) {
      expect(validas, `metaKey de ${m.id}`).toContain(m.metaKey);
    }
  });

  it("ids únicos", () => {
    expect(new Set(METRICA_IDS).size).toBe(METRICA_IDS.length);
  });
});

describe("diasNoPeriodo", () => {
  it("conta as duas pontas", () => {
    expect(diasNoPeriodo("2026-09-01", "2026-09-01")).toBe(1);
    expect(diasNoPeriodo("2026-09-01", "2026-09-30")).toBe(30);
  });

  it("data inválida não vira zero", () => {
    expect(diasNoPeriodo("ontem", "2026-09-30")).toBeNull();
  });
});

describe("janelaComparavel", () => {
  it("mês civil compara com o mês anterior INTEIRO", () => {
    const j = janelaComparavel({ de: "2026-09-01", ate: "2026-09-30", kind: "month" })!;
    expect(j.de).toBe("2026-08-01");
    expect(j.ate).toBe("2026-08-31");
    expect(j.regra).toBe("mes_anterior");
    // 31 contra 30: a regra assume a diferença de propósito, porque a meta é mensal.
    expect(j.comparavel).toBe(false);
    expect(j.motivo).toMatch(/metas são mensais/i);
  });

  it("período arbitrário compara com janela de IGUAL duração", () => {
    const j = janelaComparavel({ de: "2026-09-10", ate: "2026-09-18", kind: "range" })!;
    expect(j.dias).toBe(9);
    expect(j.ate).toBe("2026-09-09");
    expect(j.de).toBe("2026-09-01");
    expect(j.regra).toBe("janela_igual");
    expect(j.comparavel).toBe(true);
  });

  it("mês até hoje avisa que só taxa é comparável", () => {
    const j = janelaComparavel({ de: "2026-09-01", ate: "2026-09-27", kind: "mtd" })!;
    expect(j.de).toBe("2026-08-01");
    expect(j.ate).toBe("2026-08-31");
    expect(j.comparavel).toBe(false);
    expect(j.motivo).toMatch(/só taxa e razão/i);
  });

  it("atravessa a virada de ano", () => {
    const j = janelaComparavel({ de: "2026-01-01", ate: "2026-01-31", kind: "month" })!;
    expect(j.de).toBe("2025-12-01");
    expect(j.ate).toBe("2025-12-31");
  });

  it("março compara com fevereiro, inclusive em ano bissexto", () => {
    expect(janelaComparavel({ de: "2026-03-01", ate: "2026-03-31", kind: "month" })!.ate).toBe("2026-02-28");
    expect(janelaComparavel({ de: "2028-03-01", ate: "2028-03-31", kind: "month" })!.ate).toBe("2028-02-29");
  });

  it("janela de um dia é válida e compara com o dia anterior", () => {
    const j = janelaComparavel({ de: "2026-09-27", ate: "2026-09-27", kind: "range" })!;
    expect(j).toMatchObject({ de: "2026-09-26", ate: "2026-09-26", dias: 1, comparavel: true });
  });

  it("período invertido não inventa janela", () => {
    expect(janelaComparavel({ de: "2026-09-30", ate: "2026-09-01", kind: "range" })).toBeNull();
    expect(janelaComparavel({})).toBeNull();
  });

  it("a janela anterior nunca encosta no período analisado", () => {
    // Um dia de sobreposição contaria o mesmo lead nos dois lados e criaria crescimento do nada.
    for (const caso of [
      { de: "2026-09-10", ate: "2026-09-18", kind: "range" },
      { de: "2026-09-01", ate: "2026-09-30", kind: "month" },
      { de: "2026-09-01", ate: "2026-09-27", kind: "mtd" },
    ]) {
      const j = janelaComparavel(caso)!;
      expect(j.ate < caso.de, `${caso.kind}: ${j.ate} < ${caso.de}`).toBe(true);
    }
  });
});
