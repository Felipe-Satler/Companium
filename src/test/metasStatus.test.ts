import { describe, it, expect } from "vitest";
import {
  METAS_FIELDS,
  buildCells,
  compareClientRows,
  countClientStatuses,
  clientStatus,
  clientsForField,
  rowsForBar,
  LIMITE_FORA_DA_META,
  countsByField,
  goalPct,
  goalStatus,
  isHigherBetter,
  realForField,
  MetaClientRow,
} from "@/utils/metasStatus";
import { CRMClientRow } from "@/utils/crmCalculations";
import { MetaKey, MetaValues } from "@/hooks/useClientesMetas";

function row(over: Partial<CRMClientRow> = {}): CRMClientRow {
  return {
    client: "Cliente_A",
    especialidade: "",
    investimento: 1000,
    leadsTrafego: 0,
    leadsTrafegoMeta: 0,
    leadsTrafegoGoogle: 0,
    leadsCRM: 50,
    consultasAgendadas: 10,
    cacGeral: 0,
    valorConsultasAgendadas: 0,
    consultasRealizadas: 8,
    valorConsultasRealizadas: 0,
    procedimentosAgendados: 4,
    valorProcedimentosAgendados: 0,
    procedimentosRealizados: 3,
    valorProcedimentosRealizados: 0,
    faturamentoBrutoRealizados: 5000,
    roas: 5,
    ...over,
  };
}

function metas(over: Partial<Record<string, number | null>> = {}): MetaValues {
  const out = {} as MetaValues;
  for (const f of METAS_FIELDS) out[f] = { value: over[f] ?? null, kind: "count" };
  return out;
}

describe("direção da métrica", () => {
  it("trata CPL e investimento como custo (menor é melhor)", () => {
    expect(isHigherBetter("cplCRM")).toBe(false);
    expect(isHigherBetter("investimento")).toBe(false);
  });

  it("trata entregas como quanto maior melhor", () => {
    for (const f of ["leadsCRM", "consultaAgendada", "faturamento", "roas"] as const) {
      expect(isHigherBetter(f)).toBe(true);
    }
  });
});

describe("goalStatus", () => {
  it("sem meta cadastrada cai em 'none'", () => {
    expect(goalStatus(10, null, true)).toBe("none");
    expect(goalStatus(10, 0, true)).toBe("none");
  });

  it("sem real calculável cai em 'none'", () => {
    expect(goalStatus(null, 10, true)).toBe("none");
  });

  it("100% conta como dentro da meta nos dois sentidos", () => {
    expect(goalStatus(10, 10, true)).toBe("ok");
    expect(goalStatus(10, 10, false)).toBe("ok");
  });

  it("entrega acima da meta é ok, abaixo é off", () => {
    expect(goalStatus(12, 10, true)).toBe("ok");
    expect(goalStatus(8, 10, true)).toBe("off");
  });

  it("custo abaixo da meta é ok, acima é off", () => {
    expect(goalStatus(8, 10, false)).toBe("ok");
    expect(goalStatus(12, 10, false)).toBe("off");
  });

  it("custo infinito (gastou sem trazer lead) é off", () => {
    expect(goalStatus(Infinity, 15, false)).toBe("off");
  });
});

describe("realForField", () => {
  it("deriva CPL do investimento sobre os leads do CRM", () => {
    expect(realForField(row({ investimento: 1000, leadsCRM: 50 }), "cplCRM")).toBe(20);
  });

  it("com investimento e zero leads, o CPL é infinito", () => {
    expect(realForField(row({ investimento: 1000, leadsCRM: 0 }), "cplCRM")).toBe(Infinity);
  });

  it("sem investimento e sem leads, o CPL não existe", () => {
    expect(realForField(row({ investimento: 0, leadsCRM: 0 }), "cplCRM")).toBeNull();
  });

  it("ROAS sem investimento não existe (não é zero)", () => {
    expect(realForField(row({ investimento: 0, faturamentoBrutoRealizados: 0 }), "roas")).toBeNull();
  });

  it("cliente sem movimento no período zera os absolutos e anula as taxas", () => {
    expect(realForField(undefined, "leadsCRM")).toBe(0);
    expect(realForField(undefined, "faturamento")).toBe(0);
    expect(realForField(undefined, "cplCRM")).toBeNull();
    expect(realForField(undefined, "roas")).toBeNull();
  });
});

describe("goalPct", () => {
  it("mede o real como fração do planejado", () => {
    expect(goalPct(40, 100)).toBe(40);
    expect(goalPct(120, 100)).toBe(120);
  });

  it("é nulo sem meta ou sem real", () => {
    expect(goalPct(40, null)).toBeNull();
    expect(goalPct(null, 100)).toBeNull();
  });
});

describe("buildCells", () => {
  it("classifica cada métrica com sua própria direção", () => {
    const cells = buildCells(
      row({ investimento: 800, leadsCRM: 50 }),
      metas({ investimento: 1000, leadsCRM: 40, faturamento: 9000 }),
      ["investimento", "leadsCRM", "faturamento", "roas"],
    );
    const byField = new Map(cells.map((c) => [c.field, c]));
    expect(byField.get("investimento")!.status).toBe("ok"); // gastou menos que o teto
    expect(byField.get("leadsCRM")!.status).toBe("ok"); // entregou mais que o alvo
    expect(byField.get("faturamento")!.status).toBe("off"); // 5000 de 9000
    expect(byField.get("roas")!.status).toBe("none"); // sem meta cadastrada
  });

  it("devolve uma célula por métrica pedida, na ordem pedida", () => {
    const cells = buildCells(row(), metas(), ["faturamento", "leadsCRM"]);
    expect(cells.map((c) => c.field)).toEqual(["faturamento", "leadsCRM"]);
  });
});

describe("agregações dos gráficos", () => {
  const rows: MetaClientRow[] = [
    {
      client: "A",
      squad: null,
      plano: null,
      desde: null,
      cells: buildCells(row(), metas({ leadsCRM: 40, faturamento: 9000 }), ["leadsCRM", "faturamento"]),
    },
    {
      client: "B",
      squad: null,
      plano: null,
      desde: null,
      cells: buildCells(row({ leadsCRM: 10 }), metas({ leadsCRM: 40 }), ["leadsCRM", "faturamento"]),
    },
  ];

  it("conta CLIENTES na pizza, não pares cliente × métrica", () => {
    // A: leads ok + faturamento fora → fora. B: leads fora + faturamento sem meta → fora.
    expect(countClientStatuses(rows)).toEqual({ ok: 0, off: 2, none: 0 });
  });

  it("conta clientes por métrica na barra", () => {
    const byField = countsByField(rows, ["leadsCRM", "faturamento"]);
    expect(byField.get("leadsCRM")).toEqual({ ok: 1, off: 1, none: 0 });
    expect(byField.get("faturamento")).toEqual({ ok: 0, off: 1, none: 1 });
  });
});

describe("ordenação da tabela", () => {
  const base = { plano: null, desde: null, cells: [] };

  it("sem squad/plano/tempo de casa, ordena por nome", () => {
    const rows: MetaClientRow[] = [
      { client: "Zeta", squad: null, ...base },
      { client: "Alfa", squad: null, ...base },
    ];
    expect([...rows].sort(compareClientRows).map((r) => r.client)).toEqual(["Alfa", "Zeta"]);
  });

  it("squad tem prioridade sobre o nome", () => {
    const rows: MetaClientRow[] = [
      { client: "Alfa", squad: "squad-2", ...base },
      { client: "Zeta", squad: "squad-1", ...base },
    ];
    expect([...rows].sort(compareClientRows).map((r) => r.client)).toEqual(["Zeta", "Alfa"]);
  });

  it("dentro do squad, o plano vem antes do nome", () => {
    const rows: MetaClientRow[] = [
      { client: "Alfa", squad: "s1", plano: "Start", desde: null, cells: [] },
      { client: "Zeta", squad: "s1", plano: "Premium", desde: null, cells: [] },
    ];
    expect([...rows].sort(compareClientRows).map((r) => r.client)).toEqual(["Zeta", "Alfa"]);
  });

  it("com mesmo squad e plano, o cliente mais antigo vem primeiro", () => {
    const rows: MetaClientRow[] = [
      { client: "Alfa", squad: "s1", plano: "P", desde: new Date("2024-01-01"), cells: [] },
      { client: "Zeta", squad: "s1", plano: "P", desde: new Date("2020-01-01"), cells: [] },
    ];
    expect([...rows].sort(compareClientRows).map((r) => r.client)).toEqual(["Zeta", "Alfa"]);
  });

  it("quem não tem a informação vai para o fim", () => {
    const rows: MetaClientRow[] = [
      { client: "Alfa", squad: null, ...base },
      { client: "Zeta", squad: "s1", ...base },
    ];
    expect([...rows].sort(compareClientRows).map((r) => r.client)).toEqual(["Zeta", "Alfa"]);
  });
});

describe("veredito do CLIENTE (o que a pizza conta)", () => {
  const linha = (over: Partial<Record<string, number>>, fields: MetaKey[]) => ({
    client: "X",
    squad: null,
    plano: null,
    desde: null,
    cells: buildCells(row(), metas(over), fields),
  });

  it("hoje basta UMA métrica fora p/ o cliente ser 'fora'", () => {
    expect(LIMITE_FORA_DA_META).toBe(1);
  });

  it("uma métrica fora derruba o cliente, mesmo com as outras em dia", () => {
    // leads 50 de 40 = ok; faturamento 5000 de 9000 = fora.
    const r = linha({ leadsCRM: 40, faturamento: 9000 }, ["leadsCRM", "faturamento"]);
    expect(clientStatus(r)).toBe("off");
  });

  it("sem nenhuma fora, o cliente está dentro", () => {
    const r = linha({ leadsCRM: 40 }, ["leadsCRM", "faturamento"]);
    expect(clientStatus(r)).toBe("ok");
  });

  it("sem meta em métrica nenhuma, o cliente é 'sem meta'", () => {
    const r = linha({}, ["leadsCRM", "faturamento"]);
    expect(clientStatus(r)).toBe("none");
  });

  it("o limite é ajustável: com 2, uma métrica fora ainda conta como dentro", () => {
    const r = linha({ leadsCRM: 40, faturamento: 9000 }, ["leadsCRM", "faturamento"]);
    expect(clientStatus(r, 2)).toBe("ok");
  });

  it("com limite 2, duas métricas fora derrubam", () => {
    // leads 50 de 80 = fora; faturamento 5000 de 9000 = fora.
    const r = linha({ leadsCRM: 80, faturamento: 9000 }, ["leadsCRM", "faturamento"]);
    expect(clientStatus(r, 2)).toBe("off");
  });

  it("conta cada cliente uma vez só na pizza", () => {
    const dentro = linha({ leadsCRM: 40 }, ["leadsCRM", "faturamento"]);
    const fora = { ...linha({ leadsCRM: 80 }, ["leadsCRM"]), client: "Y" };
    const semMeta = { ...linha({}, ["leadsCRM"]), client: "Z" };
    expect(countClientStatuses([dentro, fora, semMeta])).toEqual({ ok: 1, off: 1, none: 1 });
  });
});

describe("clientes de UMA métrica (detalhe do gráfico de barras)", () => {
  it("separa os clientes pelo veredito daquela métrica, em ordem alfabética", () => {
    const mk = (client: string, over: Partial<Record<string, number>>) => ({
      client,
      squad: null,
      plano: null,
      desde: null,
      cells: buildCells(row(), metas(over), ["leadsCRM"]),
    });
    const listas = clientsForField(
      [mk("Zeta", { leadsCRM: 40 }), mk("Alfa", { leadsCRM: 80 }), mk("Meio", {})],
      "leadsCRM",
    );
    expect(listas.ok).toEqual(["Zeta"]);
    expect(listas.off).toEqual(["Alfa"]);
    expect(listas.none).toEqual(["Meio"]);
  });

  it("ignora cliente que não tem a métrica pedida", () => {
    const semCampo = { client: "A", squad: null, plano: null, desde: null, cells: [] };
    const listas = clientsForField([semCampo], "leadsCRM");
    expect(listas).toEqual({ ok: [], off: [], none: [] });
  });
});

describe("filtro da tabela pela barra clicada", () => {
  const mk = (client: string, squad: string | null, over: Partial<Record<string, number>>): MetaClientRow => ({
    client,
    squad,
    plano: null,
    desde: null,
    cells: buildCells(row(), metas(over), ["leadsCRM"]),
  });
  const todas = [mk("Dentro", "s1", { leadsCRM: 40 }), mk("Fora 1", "s1", { leadsCRM: 80 }), mk("Fora 2", "s2", { leadsCRM: 80 })];

  it("sem filtro devolve as mesmas linhas", () => {
    expect(rowsForBar(todas, null)).toBe(todas);
  });

  it("fica só com os clientes daquela métrica × grupo", () => {
    const fora = rowsForBar(todas, { field: "leadsCRM", status: "off", squad: null });
    expect(fora.map((r) => r.client)).toEqual(["Fora 1", "Fora 2"]);
  });

  it("barra de um gráfico de squad restringe ao squad", () => {
    const fora = rowsForBar(todas, { field: "leadsCRM", status: "off", squad: "s2" });
    expect(fora.map((r) => r.client)).toEqual(["Fora 2"]);
  });
});
