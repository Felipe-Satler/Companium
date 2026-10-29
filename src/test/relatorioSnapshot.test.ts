/**
 * O snapshot que a tela manda ao agente.
 *
 * O que está sob teste aqui é honestidade numérica. Três coisas erram em silêncio e destroem a
 * confiança no relatório inteiro: "não conseguimos ler" virar zero, número corrigido à mão passar por
 * medição de campo, e comparar períodos de tamanhos diferentes como se fossem comparáveis.
 */
import { describe, it, expect } from "vitest";
import { favoravelDe, montarSnapshot, type MontarSnapshotInput } from "@/utils/relatorioSnapshot";
import { janelaComparavel } from "../../shared/relatorio-metricas";
import type { CRMTotals } from "@/utils/crmCalculations";
import type { MetaValues } from "@/hooks/useClientesMetas";

function totals(over: Partial<CRMTotals> = {}): CRMTotals {
  return {
    leadsTrafego: 62,
    leadsTrafegoMeta: 40,
    leadsTrafegoGoogle: 22,
    leadsCRM: 48,
    leadsCRMMeta: 30,
    leadsCRMGoogle: 18,
    consultasAgendadas: 11,
    valorConsultasAgendadas: 9000,
    consultasRealizadas: 8,
    valorConsultasRealizadas: 7000,
    procedimentosAgendados: 4,
    valorProcedimentosAgendados: 20000,
    procedimentosRealizados: 3,
    valorProcedimentosRealizados: 17000,
    investimentoTotal: 3000,
    faturamentoBruto: 24000,
    roas: 8,
    ...over,
  };
}

const metas = (over: Partial<Record<string, number | null>> = {}): MetaValues =>
  ({
    investimento: { value: over.investimento ?? 3200, kind: "currency" },
    leadsCRM: { value: over.leadsCRM ?? 60, kind: "count" },
    cplCRM: { value: over.cplCRM ?? 50, kind: "currency" },
    consultaAgendada: { value: over.consultaAgendada ?? 14, kind: "count" },
    consultaRealizada: { value: over.consultaRealizada ?? null, kind: "count" },
    procedimentoAgendado: { value: over.procedimentoAgendado ?? null, kind: "count" },
    procedimentoRealizado: { value: over.procedimentoRealizado ?? null, kind: "count" },
    faturamento: { value: over.faturamento ?? 30000, kind: "currency" },
    roas: { value: over.roas ?? 9, kind: "ratio" },
  }) as MetaValues;

const PERIODO = { de: "2026-09-01", ate: "2026-09-30", kind: "month", label: "Setembro 2026" };
const COMPARACAO = {
  ...janelaComparavel({ de: PERIODO.de, ate: PERIODO.ate, kind: PERIODO.kind })!,
  label: "Agosto 2026",
};

function base(over: Partial<MontarSnapshotInput> = {}): MontarSnapshotInput {
  return {
    cliente: "jose_ramos",
    periodo: PERIODO,
    comparacao: COMPARACAO,
    a: { totals: totals(), orcamento: { count: 5, valor: 12000 }, metas: metas() },
    b: {
      totals: totals({ leadsCRM: 40, investimentoTotal: 2500, faturamentoBruto: 15000, roas: 6 }),
      orcamento: { count: 3, valor: 8000 },
      metas: metas(),
    },
    basisFaturamento: { consulta: "realizadas", procedimento: "realizados" },
    fontes: { crm: true, ads: true, metas: true },
    agora: new Date("2026-10-05T12:00:00Z"),
    ...over,
  };
}

const metrica = (s: ReturnType<typeof montarSnapshot>, id: string) =>
  s.metricas.find((m) => m.id === id)!;

describe("montarSnapshot", () => {
  it("leva as duas pontas, a meta de CADA período e o delta", () => {
    const s = montarSnapshot(base());
    const leads = metrica(s, "leadsCRM");
    expect(leads.a.valor).toBe(48);
    expect(leads.b.valor).toBe(40);
    expect(leads.delta).toMatchObject({ abs: 8, favoravel: "melhorou" });
    expect(leads.delta?.pct).toBeCloseTo(20);
    // A meta é resolvida para a janela de cada período: uma meta só para os dois deixaria o "% da
    // meta" do período comparável errado.
    expect(leads.meta.a?.valor).toBe(60);
    expect(leads.meta.b?.valor).toBe(60);
    expect(leads.meta.a?.origem).toBe("clientes_meta:rateio");
    // 48 de 60 não bate a meta.
    expect(leads.meta.a?.status).toBe("off");
    expect(leads.meta.a?.pct).toBeCloseTo(80);
  });

  it("CPL é derivado e sua meta é um TETO: abaixo dela é 'ok'", () => {
    const cpl = metrica(montarSnapshot(base()), "cplCRM");
    expect(cpl.a.valor).toBeCloseTo(3000 / 48);
    expect(cpl.direcao).toBe("lower");
    // 62,50 contra teto de 50 = furou o teto.
    expect(cpl.meta.a?.status).toBe("off");
    // E CPL caindo é melhora, mesmo sendo número menor.
    expect(favoravelDe("lower", 50, 80)).toBe("melhorou");
    expect(favoravelDe("lower", 80, 50)).toBe("piorou");
  });

  it("fonte não lida NÃO vira zero", () => {
    // O caso que destrói a confiança: o CRM voltou vazio e o relatório afirma que o cliente não
    // vendeu nada.
    const s = montarSnapshot(base({ fontes: { crm: false, ads: true, metas: true } }));
    const leads = metrica(s, "leadsCRM");
    expect(leads.a.disponivel).toBe(false);
    expect(leads.a.valor).toBeNull();
    expect(leads.delta).toBeNull();
    // O investimento vem dos anúncios e sobrevive à falha do CRM.
    const inv = metrica(s, "investimento");
    expect(inv.a.disponivel).toBe(true);
    expect(inv.a.valor).toBe(3000);
  });

  it("'não calculável' é diferente de 'não lido'", () => {
    const semLead = base({
      a: { totals: totals({ leadsCRM: 0, investimentoTotal: 0, roas: 0 }), orcamento: { count: 0, valor: 0 }, metas: metas() },
    });
    const s = montarSnapshot(semLead);
    const cpl = metrica(s, "cplCRM");
    // Leu a fonte (disponivel), mas dividir por zero lead não dá número nenhum.
    expect(cpl.a).toMatchObject({ disponivel: true, valor: null });
    // Sem investimento não há ROAS — nem zero, nem infinito.
    expect(metrica(s, "roas").a.valor).toBeNull();
    // E zero de verdade continua sendo zero.
    expect(metrica(s, "leadsCRM").a).toMatchObject({ disponivel: true, valor: 0 });
  });

  it("marca a métrica corrigida à mão, e só na ponta em que a correção foi lançada", () => {
    const s = montarSnapshot(
      base({ overrideGet: (m) => (m === "leads" ? 48 : undefined) }),
    );
    const leads = metrica(s, "leadsCRM");
    expect(leads.a.corrigido).toBe(true);
    // A correção é por período: marcar a ponta comparável com a de A seria mentira.
    expect(leads.b.corrigido).toBe(false);
    // CPL depende de leads, então herda a marca.
    expect(metrica(s, "cplCRM").a.corrigido).toBe(true);
    expect(metrica(s, "consAgend").a.corrigido).toBe(false);
    expect(s.fontes.overrides).toBe(true);
    const aviso = s.avisos.find((x) => x.codigo === "override_aplicado")!;
    expect(aviso.metricas).toContain("leadsCRM");
    expect(aviso.detalhe).toMatch(/não o descreva como tendência medida/i);
  });

  it("faturamento é corrigido por qualquer um dos valores que o compõem", () => {
    const s = montarSnapshot(
      base({ overrideGet: (m) => (m === "valor_procedimentos_realizados" ? 17000 : undefined) }),
    );
    expect(metrica(s, "faturamento").a.corrigido).toBe(true);
  });

  it("avisa que o período comparável tem outro tamanho, e proíbe comparar absolutos", () => {
    // Setembro (30) contra agosto (31): a regra assume isso porque a meta é mensal.
    const s = montarSnapshot(base());
    const aviso = s.avisos.find((x) => x.codigo === "comparacao_incompativel")!;
    expect(aviso).toBeTruthy();
    expect(aviso.detalhe).toMatch(/não compare contagens absolutas/i);
  });

  it("período que termina hoje vira aviso de dado parcial", () => {
    const s = montarSnapshot(
      base({
        periodo: { de: "2026-10-01", ate: "2026-10-05", kind: "mtd", label: "Outubro (até hoje)" },
        agora: new Date("2026-10-05T12:00:00Z"),
      }),
    );
    const aviso = s.avisos.find((x) => x.codigo === "dados_parciais")!;
    expect(aviso.detalhe).toMatch(/podem estar incompletos/i);
  });

  it("período fechado no passado não avisa dado parcial", () => {
    const s = montarSnapshot(base());
    expect(s.avisos.find((x) => x.codigo === "dados_parciais")).toBeUndefined();
  });

  it("lista as métricas sem meta, em vez de deixar o agente supor que a meta é zero", () => {
    const aviso = montarSnapshot(base()).avisos.find((x) => x.codigo === "sem_meta")!;
    expect(aviso.metricas).toContain("consReal");
    expect(aviso.metricas).toContain("procAgend");
    expect(aviso.metricas).not.toContain("leadsCRM");
  });

  it("metas ilegíveis não viram 'não há meta'", () => {
    const s = montarSnapshot(
      base({ fontes: { crm: true, ads: true, metas: false }, a: { ...base().a, metas: null }, b: { ...base().b, metas: null } }),
    );
    expect(s.avisos.find((x) => x.codigo === "metas_indisponiveis")?.detalhe).toMatch(
      /não afirme que não há meta/i,
    );
  });

  it("carrega o escopo e a base de faturamento — sem elas o número não é reproduzível", () => {
    const s = montarSnapshot(base({ escopo: { medico: "Dra. Ana", origem: ["Instagram"] } }));
    expect(s.escopo).toMatchObject({ cliente: "jose_ramos", medico: "Dra. Ana", origem: ["Instagram"] });
    expect(s.basisFaturamento).toEqual({ consulta: "realizadas", procedimento: "realizados" });
    expect(s.versao).toBe(1);
    expect(s.periodo.dias).toBe(30);
    expect(s.comparacao.regra).toBe("mes_anterior");
  });

  it("investimento é neutro: subir não é melhora nem piora", () => {
    expect(metrica(montarSnapshot(base()), "investimento").delta?.favoravel).toBe("neutro");
  });

  it("delta percentual não explode quando o período comparável é zero", () => {
    const s = montarSnapshot(
      base({ b: { totals: totals({ leadsCRM: 0 }), orcamento: { count: 0, valor: 0 }, metas: metas() } }),
    );
    const leads = metrica(s, "leadsCRM");
    expect(leads.delta?.abs).toBe(48);
    // Crescer a partir de zero não é "+Infinity%": é indefinido, e a tela mostra o absoluto.
    expect(leads.delta?.pct).toBeNull();
  });
});
