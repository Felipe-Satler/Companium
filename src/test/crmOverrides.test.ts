import { describe, it, expect } from "vitest";
import { periodSignature, buildFilterSig, buildOrigemSig, buildMonthlyFilterSig, monthCellsInRange, overrideValuesFromTotals, applyTotalsOverrides, applyEvolutionOverrides, isProcSig, baseSigWithoutProc, sumProcOverridesByBase } from "@/utils/crmOverrides";
import type { CRMTotals, CRMMonthlyEvolution } from "@/utils/crmCalculations";

const TODAY = new Date(2026, 8, 4); // 04/set/2026 (mês 8 = setembro, 0-based)

describe("periodSignature", () => {
  it("mês fechado (1º→último dia) vira chave estável m:AAAA-MM", () => {
    const p = periodSignature("2026-08-01", "2026-08-31", TODAY);
    expect(p.kind).toBe("month");
    expect(p.sig).toBe("m:2026-08");
  });

  it("1º dia → dia qualquer DO MESMO mês vira a chave estável m:AAAA-MM (âncora no mês)", () => {
    // 01→27, 01→hoje, 01→último dia: todos a MESMA chave do mês.
    expect(periodSignature("2026-09-01", "2026-09-27", TODAY).sig).toBe("m:2026-09");
    expect(periodSignature("2026-09-01", "2026-09-04", TODAY).sig).toBe("m:2026-09");
    expect(periodSignature("2026-09-01", "2026-09-30", TODAY).sig).toBe("m:2026-09");
    expect(periodSignature("2026-09-01", "2026-09-27", TODAY).kind).toBe("month");
  });

  it("correção lançada num pedaço do mês APARECE ao filtrar um período que engloba o mês", () => {
    // Bug relatado (Pablo Fonseca): cadastrou 01→27/09 e sumia ao ver 01→30/09.
    const cadastrado = periodSignature("2026-09-01", "2026-09-27", TODAY).sig;
    const filtroMaior = periodSignature("2026-09-01", "2026-09-30", TODAY).sig;
    expect(cadastrado).toBe(filtroMaior); // mesma chave → a correção aparece
  });

  it("chave é ESTÁVEL quando o dia/mês avança (não some ao virar o dia)", () => {
    const hoje = periodSignature("2026-09-01", "2026-09-04", new Date(2026, 8, 4));
    const amanha = periodSignature("2026-09-01", "2026-09-05", new Date(2026, 8, 5));
    const mesFechado = periodSignature("2026-09-01", "2026-09-30", new Date(2026, 9, 10)); // visto em outubro
    expect(hoje.sig).toBe(amanha.sig); // mesma assinatura → override não some
    expect(hoje.sig).toBe(mesFechado.sig); // e continua igual depois do mês fechar
    expect(hoje.sig).toBe("m:2026-09");
  });

  it("range que começa no MEIO do mês casa por data exata (não vira mês)", () => {
    const p = periodSignature("2026-08-10", "2026-08-15", TODAY);
    expect(p.kind).toBe("range");
    expect(p.sig).toBe("r:2026-08-10_2026-08-15");
  });

  it("sem data → 'all'", () => {
    expect(periodSignature(undefined, undefined, TODAY).sig).toBe("all");
  });

  it("dia único (só from) colapsa para range de um dia", () => {
    const p = periodSignature("2026-07-15", undefined, TODAY);
    expect(p.sig).toBe("r:2026-07-15_2026-07-15");
  });
});

describe("buildFilterSig", () => {
  it("isola por cliente/médico/origem — filtros diferentes geram assinaturas diferentes", () => {
    const a = buildFilterSig({ client: "Lia_Garrido", from: "2026-08-01", to: "2026-08-31" }, TODAY);
    const b = buildFilterSig({ client: "Lia_Garrido", medico: ["Dra. Lia"], from: "2026-08-01", to: "2026-08-31" }, TODAY);
    const c = buildFilterSig({ client: "Lia_Garrido", origem: ["Instagram"], from: "2026-08-01", to: "2026-08-31" }, TODAY);
    expect(a.filterSig).not.toBe(b.filterSig);
    expect(a.filterSig).not.toBe(c.filterSig);
    expect(b.filterSig).not.toBe(c.filterSig);
  });

  it("cliente 'all' → sentinela __ALL__ no client_scope", () => {
    const { filterSig, columns } = buildFilterSig({ client: "all", from: "2026-08-01", to: "2026-08-31" }, TODAY);
    expect(columns.client_scope).toBe("__ALL__");
    expect(filterSig.startsWith("__ALL__|")).toBe(true);
  });

  it("médico/origem 'all' são ignorados (não entram na chave)", () => {
    const a = buildFilterSig({ client: "X", medico: ["all"], origem: ["all"], from: "2026-08-01", to: "2026-08-31" }, TODAY);
    const b = buildFilterSig({ client: "X", from: "2026-08-01", to: "2026-08-31" }, TODAY);
    expect(a.filterSig).toBe(b.filterSig);
  });

  it("ordem do médico/origem não altera a chave (normaliza + ordena)", () => {
    const a = buildFilterSig({ client: "X", origem: ["B", "A"], from: "2026-08-01", to: "2026-08-31" }, TODAY);
    const b = buildFilterSig({ client: "X", origem: ["A", "B"], from: "2026-08-01", to: "2026-08-31" }, TODAY);
    expect(a.filterSig).toBe(b.filterSig);
  });

  it("procedimento ausente/vazio → chave IDÊNTICA à de antes (compat com correções já gravadas)", () => {
    const base = { client: "Diego_Rezende", from: "2026-08-01", to: "2026-08-31" };
    const semProc = buildFilterSig(base, TODAY).filterSig;
    expect(buildFilterSig({ ...base, procedimento: "" }, TODAY).filterSig).toBe(semProc);
    expect(buildFilterSig({ ...base, procedimento: "   " }, TODAY).filterSig).toBe(semProc);
    expect(buildFilterSig({ ...base, procedimento: undefined }, TODAY).filterSig).toBe(semProc);
  });

  it("procedimento presente → segmento EXTRA no fim, isola a coorte e não colide com o cliente inteiro", () => {
    const base = { client: "Diego_Rezende", from: "2026-08-01", to: "2026-08-31" };
    const geral = buildFilterSig(base, TODAY).filterSig;
    const rino = buildFilterSig({ ...base, procedimento: "proc:rinoplastia" }, TODAY).filterSig;
    const transpl = buildFilterSig({ ...base, procedimento: "proc:transplante capilar" }, TODAY).filterSig;
    expect(rino).not.toBe(geral);
    expect(rino).not.toBe(transpl);
    expect(rino.endsWith("|proc:rinoplastia")).toBe(true);
    expect(rino.startsWith(geral + "|")).toBe(true); // prefixo = sig geral; procedimento só acrescenta
  });
});

describe("buildOrigemSig", () => {
  const base = { client: "Lia_Garrido", from: "2026-08-01", to: "2026-08-31" };

  it("a assinatura de UMA origem casa com o recorte daquela origem filtrada sozinha", () => {
    const meta = buildOrigemSig({ ...base, origem: ["Meta Ads", "Google Ads"] }, "Meta Ads", TODAY);
    const solo = buildFilterSig({ ...base, origem: ["Meta Ads"] }, TODAY).filterSig;
    expect(meta).toBe(solo);
  });

  it("cada origem gera uma chave distinta, e nenhuma bate com o recorte combinado", () => {
    const combined = buildFilterSig({ ...base, origem: ["Meta Ads", "Google Ads"] }, TODAY).filterSig;
    const meta = buildOrigemSig(base, "Meta Ads", TODAY);
    const google = buildOrigemSig(base, "Google Ads", TODAY);
    expect(meta).not.toBe(google);
    expect(meta).not.toBe(combined);
    expect(google).not.toBe(combined);
  });
});

describe("monthCellsInRange (decomposição por mês p/ filtro de ANO)", () => {
  it("ano fechado (jan→dez) rende 12 células de mês fechado", () => {
    const cells = monthCellsInRange("2025-01-01", "2025-12-31");
    expect(cells.length).toBe(12);
    expect(cells[0]).toEqual({ from: "2025-01-01", to: "2025-01-31" });
    expect(cells[1]).toEqual({ from: "2025-02-01", to: "2025-02-28" }); // 2025 não é bissexto
    expect(cells[11]).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("cada célula de mês fechado casa com a chave 'm:AAAA-MM' do override mensal", () => {
    const TODAY = new Date(2026, 8, 4);
    const cells = monthCellsInRange("2025-01-01", "2025-12-31");
    for (const c of cells) {
      const cellSig = buildFilterSig({ client: "Laura_Peixoto", from: c.from, to: c.to }, TODAY).filterSig;
      const p = periodSignature(c.from, c.to, TODAY);
      expect(p.kind).toBe("month"); // cada célula é um mês fechado
      // A chave da célula deve ser IDÊNTICA à gravada ao filtrar aquele mês isolado.
      const monthSig = buildFilterSig({ client: "Laura_Peixoto", from: c.from, to: c.to }, TODAY).filterSig;
      expect(cellSig).toBe(monthSig);
      expect(cellSig.endsWith(`|m:2025-${c.from.slice(5, 7)}`)).toBe(true);
    }
  });

  it("'este ano' (jan→hoje) decompõe em meses, todos com a chave 'm:AAAA-MM'", () => {
    const TODAY = new Date(2026, 8, 4); // 04/set/2026
    const cells = monthCellsInRange("2026-01-01", "2026-09-04");
    expect(cells.length).toBe(9);
    // Jan..Ago = meses fechados.
    expect(periodSignature(cells[0].from, cells[0].to, TODAY).sig).toBe("m:2026-01");
    expect(periodSignature(cells[7].from, cells[7].to, TODAY).sig).toBe("m:2026-08");
    // Set = mês corrente até hoje → mesma chave do mês (âncora no mês).
    expect(cells[8]).toEqual({ from: "2026-09-01", to: "2026-09-04" });
    expect(periodSignature(cells[8].from, cells[8].to, TODAY).sig).toBe("m:2026-09");
  });

  it("mês único (ou sem data) → [] (sem decomposição)", () => {
    expect(monthCellsInRange("2026-08-01", "2026-08-31")).toEqual([]);
    expect(monthCellsInRange(undefined, undefined)).toEqual([]);
    expect(monthCellsInRange("2026-08-10", "2026-08-20")).toEqual([]); // dentro do mesmo mês
  });

  it("range invertido não gera células", () => {
    expect(monthCellsInRange("2026-12-01", "2026-01-01")).toEqual([]);
  });
});

describe("overrideValuesFromTotals", () => {
  it("projeta as 9 métricas corrigíveis a partir dos totais (contribuição de um recorte)", () => {
    const t: CRMTotals = {
      leadsTrafego: 0, leadsTrafegoMeta: 0, leadsTrafegoGoogle: 0,
      leadsCRM: 12, leadsCRMMeta: 0, leadsCRMGoogle: 0,
      consultasAgendadas: 5, valorConsultasAgendadas: 500,
      consultasRealizadas: 3, valorConsultasRealizadas: 300,
      procedimentosAgendados: 2, valorProcedimentosAgendados: 2000,
      procedimentosRealizados: 1, valorProcedimentosRealizados: 1000,
      investimentoTotal: 0, faturamentoBruto: 0, roas: 0,
    };
    const v = overrideValuesFromTotals(t);
    expect(v.leads).toBe(12);
    expect(v.consultas_agendadas).toBe(5);
    expect(v.consultas_realizadas).toBe(3);
    expect(v.procedimentos_agendados).toBe(2);
    expect(v.procedimentos_realizados).toBe(1);
    expect(v.valor_consultas_agendadas).toBe(500);
    expect(v.valor_consultas_realizadas).toBe(300);
    expect(v.valor_procedimentos_agendados).toBe(2000);
    expect(v.valor_procedimentos_realizados).toBe(1000);
  });
});

describe("applyTotalsOverrides", () => {
  const base: CRMTotals = {
    leadsTrafego: 0, leadsTrafegoMeta: 0, leadsTrafegoGoogle: 0,
    leadsCRM: 400, leadsCRMMeta: 0, leadsCRMGoogle: 0,
    consultasAgendadas: 50, valorConsultasAgendadas: 0,
    consultasRealizadas: 30, valorConsultasRealizadas: 0,
    procedimentosAgendados: 10, valorProcedimentosAgendados: 0,
    procedimentosRealizados: 5, valorProcedimentosRealizados: 0,
    investimentoTotal: 0, faturamentoBruto: 0, roas: 0,
  };

  it("substitui só os campos com correção; o resto fica intacto", () => {
    const get = (m: string) => (m === "leads" ? 340 : undefined);
    const out = applyTotalsOverrides(base, get as never);
    expect(out.leadsCRM).toBe(340); // corrigido
    expect(out.consultasAgendadas).toBe(50); // calculado, intacto
    expect(base.leadsCRM).toBe(400); // não muta o original
  });

  it("sem nenhuma correção retorna o mesmo objeto (sem cópia)", () => {
    const out = applyTotalsOverrides(base, () => undefined);
    expect(out).toBe(base);
  });

  it("corrige VALOR em dinheiro e recomputa Faturamento Bruto + ROAS pela base", () => {
    const b: CRMTotals = { ...base, investimentoTotal: 1000, valorConsultasRealizadas: 800, valorProcedimentosRealizados: 200, faturamentoBruto: 1000, roas: 1 };
    const get = (m: string) => (m === "valor_consultas_realizadas" ? 3000 : undefined);
    const out = applyTotalsOverrides(b, get as never, { consulta: "realizadas", procedimento: "realizados" });
    expect(out.valorConsultasRealizadas).toBe(3000); // valor corrigido
    expect(out.faturamentoBruto).toBe(3200); // 3000 (realizadas) + 200 (realizados)
    expect(out.roas).toBe(3.2); // 3200 / 1000
    expect(b.faturamentoBruto).toBe(1000); // não muta o original
  });

  it("correção de valor fora da base ativa NÃO altera o Faturamento (base agendadas)", () => {
    const b: CRMTotals = { ...base, investimentoTotal: 1000, valorConsultasAgendadas: 500, valorConsultasRealizadas: 800, valorProcedimentosAgendados: 100, faturamentoBruto: 600, roas: 0.6 };
    // Corrige o valor de REALIZADAS, mas a base é AGENDADAS → faturamento segue agendadas.
    const get = (m: string) => (m === "valor_consultas_realizadas" ? 9999 : undefined);
    const out = applyTotalsOverrides(b, get as never, { consulta: "agendadas", procedimento: "agendados" });
    expect(out.faturamentoBruto).toBe(600); // 500 (agendadas) + 100 (agendados)
    expect(out.roas).toBe(0.6);
  });
});

describe("buildMonthlyFilterSig (correção mensal na evolução)", () => {
  const TODAY = new Date(2026, 8, 25); // 25/set/2026

  it("mês do meio do range é um mês fechado → mesma chave 'm:AAAA-MM' do card daquele mês", () => {
    // Filtro do ANO; a barra de agosto deve casar com o override gravado ao filtrar agosto.
    const sig = buildMonthlyFilterSig("2026-08", { client: "Lia_Garrido" }, "2026-01-01", "2026-09-25", TODAY);
    const cardAgosto = buildFilterSig({ client: "Lia_Garrido", from: "2026-08-01", to: "2026-08-31" }, TODAY).filterSig;
    expect(sig).toBe(cardAgosto);
    expect(sig.endsWith("|m:2026-08")).toBe(true);
  });

  it("mês corrente até hoje → 'm:AAAA-MM' (mesma chave dos cards no mês atual)", () => {
    // Vendo SÓ setembro (1º → hoje): a barra de set casa exatamente com o card de setembro.
    const sig = buildMonthlyFilterSig("2026-09", { client: "Lia_Garrido" }, "2026-09-01", "2026-09-25", TODAY);
    const cardSet = buildFilterSig({ client: "Lia_Garrido", from: "2026-09-01", to: "2026-09-25" }, TODAY).filterSig;
    expect(sig).toBe(cardSet);
    expect(sig.endsWith("|m:2026-09")).toBe(true);
  });

  it("herda cliente/médico/origem — recortes diferentes geram chaves diferentes", () => {
    const a = buildMonthlyFilterSig("2026-08", { client: "X" }, "2026-01-01", "2026-12-31", TODAY);
    const b = buildMonthlyFilterSig("2026-08", { client: "X", medico: ["Dra. Lia"] }, "2026-01-01", "2026-12-31", TODAY);
    expect(a).not.toBe(b);
  });

  it("sem range de filtro usa o mês inteiro (1º → último dia)", () => {
    const sig = buildMonthlyFilterSig("2026-07", { client: "X" }, undefined, undefined, TODAY);
    expect(sig.endsWith("|m:2026-07")).toBe(true);
  });
});

describe("applyEvolutionOverrides (barra da evolução acompanha a correção)", () => {
  const row: CRMMonthlyEvolution = {
    month: "2026-09",
    label: "set.\n/26",
    leads: 100,
    consultasAgendadas: 20,
    consultasRealizadas: 10,
    procedimentosAgendados: 5,
    procedimentosRealizados: 2,
    investimento: 1000,
    faturamento: 500,
    roas: 0.5,
    leadsTrafego: 80,
    cpl: 10,
    valorConsultasAgendadas: 300,
    valorConsultasRealizadas: 500,
    valorProcedimentosAgendados: 0,
    valorProcedimentosRealizados: 0,
  };

  it("corrige LEADS e recomputa o CPL do mês (investimento/leads)", () => {
    const get = (m: string) => (m === "leads" ? 50 : undefined);
    const out = applyEvolutionOverrides(row, get as never);
    expect(out.leads).toBe(50); // corrigido
    expect(out.cpl).toBe(20); // 1000 / 50
    expect(out.consultasAgendadas).toBe(20); // intacto
    expect(row.leads).toBe(100); // não muta o original
  });

  it("sem nenhuma correção retorna o MESMO objeto (barra = banco)", () => {
    const out = applyEvolutionOverrides(row, () => undefined);
    expect(out).toBe(row);
  });

  it("corrige VALOR e recomputa o faturamento do mês + ROAS pela base", () => {
    const get = (m: string) => (m === "valor_consultas_realizadas" ? 900 : undefined);
    const out = applyEvolutionOverrides(row, get as never, { consulta: "realizadas", procedimento: "realizados" });
    expect(out.valorConsultasRealizadas).toBe(900);
    expect(out.faturamento).toBe(900); // 900 (realizadas) + 0 (realizados)
    expect(out.roas).toBe(0.9); // 900 / 1000
  });

  it("corrige as contagens de consulta/procedimento direto", () => {
    const get = (m: string) =>
      ({ consultas_agendadas: 7, procedimentos_realizados: 9 } as Record<string, number>)[m];
    const out = applyEvolutionOverrides(row, get as never);
    expect(out.consultasAgendadas).toBe(7);
    expect(out.procedimentosRealizados).toBe(9);
  });
});

describe("rollup por procedimento (soma das correções |proc: no view sem procedimento)", () => {
  it("isProcSig detecta o segmento |proc: no fim da assinatura", () => {
    expect(isProcSig("pablo_fonseca||meta ads|m:2026-10|proc:transplante")).toBe(true);
    expect(isProcSig("pablo_fonseca||meta ads|m:2026-10")).toBe(false);
  });

  it("baseSigWithoutProc remove só o segmento final |proc:<key>", () => {
    expect(baseSigWithoutProc("pablo_fonseca||meta ads|m:2026-10|proc:transplante")).toBe(
      "pablo_fonseca||meta ads|m:2026-10"
    );
    // Sem segmento de procedimento → inalterada.
    expect(baseSigWithoutProc("pablo_fonseca||meta ads|m:2026-10")).toBe("pablo_fonseca||meta ads|m:2026-10");
  });

  it("sumProcOverridesByBase soma por (assinatura-pai, métrica) e ignora linhas sem proc", () => {
    const rows = [
      { filter_sig: "pablo_fonseca||meta ads|m:2026-10|proc:transplante", metric: "consultas_agendadas", value: 2 },
      { filter_sig: "pablo_fonseca||meta ads|m:2026-10|proc:rinoplastia", metric: "consultas_agendadas", value: 1 },
      // PostgREST devolve numeric como string — deve coagir.
      { filter_sig: "pablo_fonseca||meta ads|m:2026-10|proc:transplante", metric: "leads", value: "10" },
      // Linha SEM procedimento (recorte-pai direto) — não entra no rollup.
      { filter_sig: "pablo_fonseca||meta ads|m:2026-10", metric: "consultas_agendadas", value: 3 },
    ];
    const out = sumProcOverridesByBase(rows);
    expect(out["pablo_fonseca||meta ads|m:2026-10"].consultas_agendadas).toBe(3); // 2 + 1 (só os proc)
    expect(out["pablo_fonseca||meta ads|m:2026-10"].leads).toBe(10);
    // A linha direta (sem proc) não cria uma chave extra nem soma aqui.
    expect(Object.keys(out)).toEqual(["pablo_fonseca||meta ads|m:2026-10"]);
  });

  it("valores não-numéricos são ignorados", () => {
    const out = sumProcOverridesByBase([
      { filter_sig: "c|||m:2026-10|proc:a", metric: "leads", value: "x" as unknown as number },
      { filter_sig: "c|||m:2026-10|proc:b", metric: "leads", value: 5 },
    ]);
    expect(out["c|||m:2026-10"].leads).toBe(5);
  });
});
