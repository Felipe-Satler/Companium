/**
 * O relatório exportado em markdown.
 *
 * O que vale testar aqui não é a formatação — é a **honestidade do texto que sai**. Um markdown
 * colado num e-mail ou no Notion sobrevive ao dashboard: ninguém que o receba vai conferir contra a
 * tela. Então as três situações de um valor ("sem informação", "não calculável", zero de verdade), o
 * tipo da causa e a procedência têm de atravessar — achatá-las aqui desfaria no último metro a regra
 * que o resto do pipeline mantém.
 */
import { describe, it, expect } from "vitest";
import { nomeDoRelatorio, relatorioParaMarkdown } from "@/utils/relatorioMarkdown";
import type { Relatorio } from "@/lib/clientReportsApi";
import type { MetricaSnapshot } from "@/utils/relatorioSnapshot";

const ponta = (valor: number | null, over: Record<string, unknown> = {}) => ({
  valor,
  disponivel: true,
  corrigido: false,
  ...over,
});

const metrica = (over: Partial<MetricaSnapshot> = {}): MetricaSnapshot =>
  ({
    id: "leads",
    label: "Leads no CRM",
    unidade: "num",
    direcao: "higher",
    grupo: "Funil",
    a: ponta(120),
    b: null,
    meta: { a: null, b: null },
    delta: null,
    ...over,
  }) as MetricaSnapshot;

function relatorio(over: Partial<Relatorio> = {}): Relatorio {
  return {
    id: "r1",
    cliente: "jose_ramos",
    nome_exibicao: "Dr. José Ramos - VascuMed",
    titulo: null,
    periodo_de: "2026-09-01",
    periodo_ate: "2026-09-30",
    periodo_kind: "month",
    periodo_label: "Setembro de 2026",
    comparacao_de: null,
    comparacao_ate: null,
    comparacao_regra: null,
    comparacao_motivo: null,
    prioridade: "gargalo",
    avisos: [],
    fontes: null,
    status: "ok",
    error: null,
    criado_por: "u1",
    criado_em: "2026-10-01T12:00:00.000Z",
    atualizado_em: "2026-10-01T12:00:00.000Z",
    canDelete: true,
    observacao: null,
    relatorio_md: "prosa do agente",
    relatorio: {
      leitura: "O investimento subiu e os leads não acompanharam.",
      problema: {
        prioridade: "gargalo",
        texto: "A etapa de agendamento está represando.",
        impacto: "30 leads sem contato",
        criativos: [],
      },
      causa: { texto: "A fila de retorno dobrou.", tipo: "hipotese", verificar: "Olhar o tempo de 1º contato" },
      acao: { texto: "Redistribuir a fila.", responsavel: "Marina", prazo: "até 10/10" },
      limitacoes: ["Sem dado de ligação atendida"],
    },
    snapshot: { metricas: [metrica()] } as unknown as Relatorio["snapshot"],
    snapshot_versao: 1,
    origem_numeros: "frontend",
    agent_id: "relatoriomarketingagent",
    ...over,
  } as Relatorio;
}

describe("nomeDoRelatorio", () => {
  it("usa o nome dado pela pessoa", () => {
    expect(nomeDoRelatorio(relatorio({ titulo: "Depois da troca de oferta" }))).toBe(
      "Depois da troca de oferta",
    );
  });

  it("sem nome, cai para o rótulo do período", () => {
    expect(nomeDoRelatorio(relatorio())).toBe("Setembro de 2026");
  });

  it("nome só de espaços conta como sem nome", () => {
    expect(nomeDoRelatorio(relatorio({ titulo: "   " }))).toBe("Setembro de 2026");
  });

  it("sem nome e sem rótulo, mostra as datas em pt-BR", () => {
    expect(nomeDoRelatorio(relatorio({ periodo_label: null }))).toBe("01/09/2026 a 30/09/2026");
  });
});

describe("relatorioParaMarkdown", () => {
  it("leva os quatro blocos, não só a prosa", () => {
    // `relatorio_md` é só a prosa do agente; copiar apenas ela entregaria um diagnóstico sem os
    // números que o sustentam.
    const md = relatorioParaMarkdown(relatorio());
    for (const secao of [
      "## Leitura crítica",
      "## Problema / oportunidade",
      "## Causa / correlação",
      "## Ação recomendada",
      "## Números que embasaram",
      "## Limitações declaradas",
    ]) {
      expect(md, secao).toContain(secao);
    }
  });

  it("o TIPO da causa viaja junto do texto", () => {
    // "hipótese" e "causa comprovada" pedem decisões diferentes de quem lê.
    expect(relatorioParaMarkdown(relatorio())).toContain("*(hipótese)*");
  });

  it("'sem informação' e 'não calculável' não viram zero", () => {
    // A regra central da feature, no último metro. Um "0" aqui diria que o cliente teve zero lead.
    const md = relatorioParaMarkdown(
      relatorio({
        snapshot: {
          metricas: [
            metrica({ id: "a", label: "Leads", a: ponta(0, { disponivel: false }) }),
            metrica({ id: "b", label: "CPL", a: ponta(null) }),
            metrica({ id: "c", label: "Agendadas", a: ponta(0) }),
          ],
        } as unknown as Relatorio["snapshot"],
      }),
    );
    expect(md).toContain("| Leads | sem informação |");
    expect(md).toContain("| CPL | não calculável |");
    // O zero de verdade continua zero — é o terceiro estado, e ele é um fato.
    expect(md).toContain("| Agendadas | 0 |");
  });

  it("meta ausente é 'sem meta', não zero", () => {
    expect(relatorioParaMarkdown(relatorio())).toContain("sem meta");
  });

  it("marca o número corrigido à mão", () => {
    const md = relatorioParaMarkdown(
      relatorio({
        snapshot: {
          metricas: [metrica({ a: ponta(120, { corrigido: true }) })],
        } as unknown as Relatorio["snapshot"],
      }),
    );
    expect(md).toContain("(corrigido à mão)");
  });

  it("prioridade não classificada aparece, em vez de sumir", () => {
    const r = relatorio();
    const md = relatorioParaMarkdown({
      ...r,
      relatorio: { ...r.relatorio!, problema: { ...r.relatorio!.problema, prioridade: null } },
    } as Relatorio);
    expect(md).toContain("**Prioridade:** não classificada");
  });

  it("sem comparação, a tabela não tem coluna de comparação", () => {
    const md = relatorioParaMarkdown(relatorio());
    expect(md).toContain("| Métrica | Período | Meta |");
    expect(md).not.toContain("| Métrica | Período | Comparação | Meta |");
  });

  it("com comparação, a coluna aparece e traz a ponta B", () => {
    const md = relatorioParaMarkdown(
      relatorio({
        comparacao_de: "2026-08-01",
        comparacao_ate: "2026-08-31",
        snapshot: {
          metricas: [metrica({ b: ponta(90) })],
        } as unknown as Relatorio["snapshot"],
      }),
    );
    expect(md).toContain("| Métrica | Período | Comparação | Meta |");
    expect(md).toContain("| Leads no CRM | 120 | 90 | sem meta |");
    expect(md).toContain("**Comparado com:** 01/08/2026 a 31/08/2026");
  });

  it("fecha com a procedência — é o que torna o texto conferível depois", () => {
    const md = relatorioParaMarkdown(relatorio());
    expect(md).toContain("relatoriomarketingagent");
    expect(md).toContain("frontend");
  });

  it("o pipe de um rótulo não quebra a tabela", () => {
    const md = relatorioParaMarkdown(
      relatorio({
        snapshot: {
          metricas: [metrica({ label: "Leads | CRM" })],
        } as unknown as Relatorio["snapshot"],
      }),
    );
    expect(md).toContain("Leads \\| CRM");
  });

  it("relatório sem blocos ainda produz um documento com cabeçalho e números", () => {
    // Degradação: o agente pode ter devolvido só prosa (JSON inválido). O copiar não pode explodir.
    const md = relatorioParaMarkdown(relatorio({ relatorio: null }));
    expect(md).toContain("# Setembro de 2026");
    expect(md).toContain("## Números que embasaram");
    expect(md).not.toContain("**Prioridade:**");
  });

  it("o foco pedido entra como citação", () => {
    expect(relatorioParaMarkdown(relatorio({ observacao: "olhar a campanha de vídeo" }))).toContain(
      "> **Foco pedido:** olhar a campanha de vídeo",
    );
  });
});
