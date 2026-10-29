/**
 * Prompt e leitura da resposta do agente do Relatório.
 *
 * O módulo testado é do worker (`apps/ad-spy-worker/relatorio-prompt.js`) e é puro de propósito —
 * sem I/O, sem config, sem o cliente do Gateway —, então roda aqui sem servidor nenhum.
 */
import { describe, it, expect } from "vitest";
import {
  PRIORIDADES,
  buildRelatorioPrompt,
  linhaMetrica,
  parseRelatorioReply,
} from "../../apps/ad-spy-worker/relatorio-prompt.js";

const FICHA = {
  nome: "Dr. José Ramos - VascuMed",
  especialidades: ["Cirurgia Vascular"],
  plano: "Escala",
  squad: "Marina",
};

const metrica = (over: Record<string, unknown> = {}) => ({
  id: "leadsCRM",
  label: "Leads CRM",
  unidade: "contagem",
  direcao: "higher",
  grupo: "Leads",
  a: { valor: 48, disponivel: true, corrigido: false },
  b: { valor: 40, disponivel: true, corrigido: false },
  meta: { a: { valor: 60, status: "off", pct: 80 }, b: null },
  delta: { abs: 8, pct: 20, favoravel: "melhorou" },
  ...over,
});

const SNAPSHOT = {
  versao: 1,
  periodo: { de: "2026-09-01", ate: "2026-09-30", label: "Setembro 2026", dias: 30, kind: "month" },
  comparacao: {
    de: "2026-08-01",
    ate: "2026-08-31",
    label: "Agosto 2026",
    dias: 31,
    comparavel: false,
    regra: "mes_anterior",
    motivo: "O período é um mês civil e as metas são mensais.",
  },
  basisFaturamento: { consulta: "realizadas", procedimento: "realizados" },
  avisos: [{ codigo: "sem_meta", metricas: ["consReal"], detalhe: "Sem meta cadastrada no período" }],
  metricas: [metrica()],
  funil: { orcamentoParado: { count: 5, valor: 12000 } },
};

describe("linhaMetrica", () => {
  it("dá SINAL à variação — sem ele, '8' é indistinguível de um valor absoluto", () => {
    expect(linhaMetrica(metrica())).toContain("+8");
    expect(linhaMetrica(metrica({ delta: { abs: -2, pct: -100, favoravel: "piorou" } }))).toContain("-2");
  });

  it("sem mudança diz 'estável' e cala o resto", () => {
    const l = linhaMetrica(metrica({ delta: { abs: 0, pct: 0, favoravel: "estavel" } }));
    expect(l).toContain("estável");
    // "0 · 0,0%" seria ruído que o agente leria como informação.
    expect(l).not.toContain("0,0%");
  });

  it("meta de CPL é TETO, não alvo", () => {
    const l = linhaMetrica(
      metrica({
        label: "CPL CRM",
        unidade: "moeda",
        direcao: "lower",
        a: { valor: 62.5, disponivel: true },
        b: { valor: 50, disponivel: true },
        meta: { a: { valor: 50, status: "off", pct: 125 } },
        delta: { abs: 12.5, pct: 25, favoravel: "piorou" },
      }),
    );
    // Sem o "teto ≤", 125% da meta pareceria superação quando o custo estourou em 25%.
    expect(l).toMatch(/teto ≤ R\$\s?50,00/);
    expect(l).toContain("piorou");
  });

  it("fonte ilegível não vira zero, e não ganha conversa de meta", () => {
    const l = linhaMetrica(
      metrica({ a: { valor: null, disponivel: false }, b: { valor: null, disponivel: false }, delta: null }),
    );
    expect(l).toContain("sem informação");
    expect(l).not.toContain("0");
    // Não se compara com meta o que não se conseguiu ler.
    expect(l).not.toContain("meta");
  });

  it("zero de verdade é zero, e 'não calculável' é outra coisa", () => {
    expect(linhaMetrica(metrica({ a: { valor: 0, disponivel: true }, meta: { a: null } }))).toMatch(
      /Leads CRM: 0\b/,
    );
    const semCpl = linhaMetrica(
      metrica({
        label: "CPL CRM",
        unidade: "moeda",
        a: { valor: null, disponivel: true },
        b: { valor: null, disponivel: true },
        meta: { a: null },
        delta: null,
      }),
    );
    expect(semCpl).toContain("não calculável");
  });

  it("número corrigido à mão vai marcado", () => {
    const l = linhaMetrica(metrica({ a: { valor: 48, disponivel: true, corrigido: true } }));
    expect(l).toContain("[corrigido à mão no CRM]");
  });

  it("sem meta cadastrada é dito, não omitido", () => {
    // Omitir faria o agente tratar ausência de meta como meta zero batida.
    expect(linhaMetrica(metrica({ meta: { a: null } }))).toContain("sem meta cadastrada");
  });

  it("período simples (b null) não imprime comparável nem variação", () => {
    const l = linhaMetrica(metrica({ b: null, delta: null }));
    expect(l).not.toMatch(/comparável/i);
    expect(l).not.toContain("+8");
    // A meta continua sendo dita.
    expect(l).toMatch(/meta/i);
  });
});

describe("buildRelatorioPrompt", () => {
  it("leva a ficha, os dois períodos e a regra que escolheu o comparável", () => {
    const p = buildRelatorioPrompt({ ficha: FICHA, snapshot: SNAPSHOT });
    expect(p).toContain("Dr. José Ramos - VascuMed");
    expect(p).toContain("Cirurgia Vascular");
    // O líder de RevOps é o único responsável que existe nos dados.
    expect(p).toContain("Marina");
    expect(p).toContain("2026-09-01 a 2026-09-30");
    expect(p).toContain("2026-08-01 a 2026-08-31");
    expect(p).toMatch(/Por que esse comparável/);
    expect(p).toContain("metas são mensais");
  });

  it("janelas de tamanhos diferentes proíbem comparar absolutos", () => {
    const p = buildRelatorioPrompt({ ficha: FICHA, snapshot: SNAPSHOT });
    expect(p).toMatch(/NÃO compare contagens absolutas/i);
  });

  it("janelas iguais não carregam o aviso", () => {
    const p = buildRelatorioPrompt({
      ficha: FICHA,
      snapshot: { ...SNAPSHOT, comparacao: { ...SNAPSHOT.comparacao, comparavel: true, dias: 30 } },
    });
    expect(p).not.toMatch(/NÃO compare contagens absolutas/i);
  });

  it("as limitações entram como texto a incorporar, não como rodapé", () => {
    const p = buildRelatorioPrompt({ ficha: FICHA, snapshot: SNAPSHOT });
    expect(p).toContain("Limitações desta leitura");
    expect(p).toContain("Sem meta cadastrada no período");
    expect(p).toMatch(/incorpore no próprio texto/i);
  });

  it("diz que 'sem informação' não é zero", () => {
    const p = buildRelatorioPrompt({ ficha: FICHA, snapshot: SNAPSHOT });
    expect(p).toMatch(/diferente de zero/i);
    expect(p).toMatch(/ÚNICOS números/);
  });

  it("leva o orçamento parado — é onde o gargalo de funil aparece", () => {
    const p = buildRelatorioPrompt({ ficha: FICHA, snapshot: SNAPSHOT });
    expect(p).toContain("Orçamento parado");
    expect(p).toContain("12.000,00");
  });

  it("pede os quatro blocos e as três prioridades", () => {
    const p = buildRelatorioPrompt({ ficha: FICHA, snapshot: SNAPSHOT });
    for (const t of ["## Leitura do Relatório", "## Problema ou oportunidade", "## Causa e correlação", "## Solução ou ação"]) {
      expect(p).toContain(t);
    }
    for (const prio of PRIORIDADES) expect(p).toContain(prio);
    expect(p).toContain('"limitacoes"');
    // O contrato de marketing tem o campo de criativos citados na prioridade.
    expect(p).toContain('"criativos"');
  });

  it("renderiza o desempenho por criativo quando há bloco de marketing", () => {
    const snap = {
      ...SNAPSHOT,
      marketing: {
        disponivel: true,
        totalAnuncios: 2,
        conta: { hookRate: 19.75, holdRate: 1.47, cliques: 3100, cpc: 1.12, gasto: 3488, resultadosMeta: 136, custoResultadoMeta: 25.65 },
        criativos: [
          { codigo: "V009", adId: "9", formato: "video", objetivo: "geracao_demanda", status: "ativo", hookRate: 24.08, holdRate: 1.03, cpl: 14.26, resultados: 96, tipoResultado: "Cadastros", gasto: 1369.92, analise: { resumo: "depoimento", positivos: ["prova social"], melhorar: [], ajustar: [] } },
          { codigo: "IM007", adId: "im", formato: "estatico", objetivo: "geracao_demanda", status: "ativo", hookRate: null, holdRate: null, cpl: null, resultados: 0, tipoResultado: "Conversas iniciadas", gasto: 200, analise: null },
        ],
      },
    };
    const p = buildRelatorioPrompt({ ficha: FICHA, snapshot: snap });
    expect(p).toContain("# Desempenho de criativo (Meta)");
    expect(p).toContain("Hook Rate 19,75%");
    expect(p).toContain("V009");
    expect(p).toContain("n/a (estático)"); // estático não tem retenção de vídeo
    expect(p).toContain("custo/resultado não calculável"); // IM007 sem resultado
    expect(p).toContain("96 Cadastros"); // resultado leva o TIPO, não "lead" fixo
    expect(p).toContain("Análise registrada"); // a análise do V009 entra como correlação
  });

  it("omite o bloco de marketing quando a fonte de criativo não foi lida", () => {
    const snap = { ...SNAPSHOT, marketing: { disponivel: false, totalAnuncios: 0, conta: {}, criativos: [] } };
    const p = buildRelatorioPrompt({ ficha: FICHA, snapshot: snap });
    expect(p).not.toContain("# Desempenho de criativo");
  });

  it("período simples: sem comparável, manda descrever o nível e não imprime a linha comparável", () => {
    const snap = {
      ...SNAPSHOT,
      comparacao: null,
      metricas: [metrica({ b: null, delta: null, meta: { a: null } })],
    };
    const p = buildRelatorioPrompt({ ficha: FICHA, snapshot: snap });
    expect(p).toContain("Sem período comparável");
    expect(p).toMatch(/Descreva o NÍVEL/i);
    // Não há a linha "Comparável: DD/MM..." do cabeçalho de período.
    expect(p).not.toContain("Comparável:");
    // Nem a parte "(comparável: …)" na linha da métrica.
    expect(p).not.toContain("(comparável:");
  });

  it("a instrução de quem pediu não manda nas regras", () => {
    const p = buildRelatorioPrompt({
      ficha: FICHA,
      snapshot: SNAPSHOT,
      observacao: "foca na campanha de setembro",
    });
    expect(p).toContain("foca na campanha de setembro");
    expect(p).toMatch(/NÃO manda sobre as regras de diagnóstico/i);
  });

  it("respeita o teto de caracteres", () => {
    const gordo = { ...SNAPSHOT, metricas: Array.from({ length: 400 }, () => metrica()) };
    const p = buildRelatorioPrompt({ ficha: FICHA, snapshot: gordo, maxChars: 4000 });
    expect(p.length).toBeLessThanOrEqual(4000 + 20);
    expect(p).toContain("(cortado)");
  });

  it("não quebra sem argumento nenhum", () => {
    expect(() => buildRelatorioPrompt()).not.toThrow();
  });
});

describe("parseRelatorioReply", () => {
  const prosa =
    "## Leitura do Relatório\n\nOs leads subiram 20%.\n\n## Solução ou ação\n\nRever o criativo.";

  const reply = (obj: unknown) => `${prosa}\n\n\`\`\`json\n${JSON.stringify(obj)}\n\`\`\``;

  const COMPLETO = {
    leitura: "Leads subiram 20% contra agosto, mas a consulta caiu.",
    problema: { prioridade: "gargalo", texto: "Conversão lead→consulta", impacto: "8 consultas a menos" },
    causa: { texto: "Atendimento demorou", tipo: "correlacao", verificar: "Tempo de 1ª resposta" },
    acao: { texto: "Medir tempo de resposta por 7 dias", responsavel: "Marina", prazo: "05/10" },
    limitacoes: ["Agosto tem 31 dias"],
  };

  it("separa a prosa dos quatro blocos estruturados", () => {
    const r = parseRelatorioReply(reply(COMPLETO));
    expect(r.relatorioMd).toBe(prosa);
    expect(r.relatorioMd).not.toContain("```");
    expect(r.relatorio?.leitura).toContain("20%");
    expect(r.relatorio?.problema.prioridade).toBe("gargalo");
    expect(r.prioridade).toBe("gargalo");
    expect(r.relatorio?.causa.tipo).toBe("correlacao");
    expect(r.relatorio?.acao.responsavel).toBe("Marina");
    expect(r.relatorio?.limitacoes).toEqual(["Agosto tem 31 dias"]);
  });

  it("lê os criativos citados na prioridade; ausência vira lista vazia", () => {
    const com = parseRelatorioReply(
      reply({ ...COMPLETO, problema: { ...COMPLETO.problema, criativos: ["V009", "V008"] } }),
    );
    expect(com.relatorio?.problema.criativos).toEqual(["V009", "V008"]);
    const sem = parseRelatorioReply(reply(COMPLETO));
    expect(sem.relatorio?.problema.criativos).toEqual([]);
  });

  it("prioridade fora das três vira null — NÃO um chute", () => {
    // Chutar entre gargalo e oportunidade é inventar o diagnóstico, que é exatamente o que este
    // relatório existe para não fazer.
    const r = parseRelatorioReply(reply({ ...COMPLETO, problema: { ...COMPLETO.problema, prioridade: "urgente" } }));
    expect(r.prioridade).toBeNull();
    expect(r.relatorio?.problema.prioridade).toBeNull();
    // E o resto do diagnóstico sobrevive.
    expect(r.relatorio?.problema.texto).toBe("Conversão lead→consulta");
  });

  it("tipo de causa desconhecido cai no mais HUMILDE, nunca em 'causa'", () => {
    const r = parseRelatorioReply(reply({ ...COMPLETO, causa: { texto: "x", tipo: "certeza" } }));
    // Errar para "causa comprovada" daria autoridade a um palpite.
    expect(r.relatorio?.causa.tipo).toBe("hipotese");
  });

  it("responsável e prazo ausentes viram 'a definir'", () => {
    // Nada nos dados sabe quem é dono de tarefa; inventar seria fabricar responsabilidade.
    const r = parseRelatorioReply(reply({ ...COMPLETO, acao: { texto: "Medir" } }));
    expect(r.relatorio?.acao.responsavel).toBe("a definir");
    expect(r.relatorio?.acao.prazo).toBe("a definir");
  });

  it("JSON malformado degrada para prosa, sem perder o relatório", () => {
    const r = parseRelatorioReply(`${prosa}\n\n\`\`\`json\n{ isso não é json }\n\`\`\``);
    expect(r.relatorio).toBeNull();
    expect(r.prioridade).toBeNull();
    expect(r.relatorioMd).toContain("Os leads subiram");
  });

  it("sem bloco nenhum, ainda entrega a prosa", () => {
    expect(parseRelatorioReply(prosa).relatorioMd).toBe(prosa);
  });

  it("bloco parcial não quebra: o que falta fica null", () => {
    const r = parseRelatorioReply(reply({ leitura: "só isso" }));
    expect(r.relatorio?.leitura).toBe("só isso");
    expect(r.relatorio?.problema.texto).toBeNull();
    expect(r.relatorio?.causa.tipo).toBe("hipotese");
    expect(r.relatorio?.limitacoes).toEqual([]);
  });

  it("aceita a prioridade com caixa e espaço sobrando", () => {
    const r = parseRelatorioReply(reply({ ...COMPLETO, problema: { prioridade: " Investigacao " } }));
    expect(r.prioridade).toBe("investigacao");
  });
});
