/**
 * Prompt e leitura da resposta do agente de Contexto Operacional.
 *
 * O módulo testado é do worker (`apps/ad-spy-worker/briefs-prompt.js`) e é puro de propósito —
 * sem I/O, sem config, sem o cliente do Gateway —, então roda aqui sem servidor nenhum.
 */
import { describe, it, expect } from "vitest";
import { buildBriefPrompt, parseBriefReply } from "../../apps/ad-spy-worker/briefs-prompt.js";

const FICHA = {
  nome: "Dr. José Ramos - VascuMed",
  especialidades: ["Cirurgia Vascular"],
  plano: "Escala",
  squad: "Marina",
  desde: "2025-03-01",
  mesesDeCasa: 18,
  temCRM: true,
};

describe("buildBriefPrompt", () => {
  it("leva a ficha do cliente", () => {
    const p = buildBriefPrompt({ ficha: FICHA });
    expect(p).toContain("Dr. José Ramos - VascuMed");
    expect(p).toContain("Cirurgia Vascular");
    expect(p).toContain("Escala");
    expect(p).toContain("Marina");
    expect(p).toContain("18 meses de casa");
    expect(p).toContain("Usa CRM: sim");
  });

  it("pede o ClickUp em prosa, não como lista de tarefas", () => {
    const p = buildBriefPrompt({ ficha: FICHA });
    expect(p).toContain("ClickUp");
    expect(p).toMatch(/lista de tarefas/i);
  });

  it("não repete contexto de empresa: isso mora na definição do agente", () => {
    const p = buildBriefPrompt({ ficha: FICHA });
    expect(p).not.toContain("[COMPANIUM_CONTEXT]");
  });

  it("leitura falhando NÃO vira 'não tem especialidade'", () => {
    // A tela mostra as tags de especialidade no card; um resumo dizendo que não há seria desmentido
    // na mesma tela — e "não conseguimos ler" é uma afirmação diferente de "não existe".
    const p = buildBriefPrompt({
      ficha: { nome: "Clínica X", especialidades: [], especialidadesIndisponiveis: true },
    });
    expect(p).not.toContain("(não cadastrada)");
    expect(p).toMatch(/não foi possível ler/i);
    expect(p).toMatch(/NÃO afirme/);
  });

  it("ficha incompleta não vira invenção", () => {
    const p = buildBriefPrompt({ ficha: { nome: "Clínica X" } });
    expect(p).toContain("(não cadastrada)");
    expect(p).toContain("Plano: (não informado)");
    expect(p).toContain("Usa CRM: (não informado)");
  });

  it("não quebra sem argumento nenhum", () => {
    expect(() => buildBriefPrompt()).not.toThrow();
  });
});

describe("parseBriefReply", () => {
  const prosa =
    "## Contexto Operacional\n\nCriativo novo em aprovação; a fila anda uma vez por semana." +
    "\n\n## Riscos e alertas\n\nAprovação travada há 10 dias.";

  it("separa prosa do bloco estruturado", () => {
    const reply = `${prosa}\n\n\`\`\`json\n${JSON.stringify({
      contexto_operacional: "Criativo em aprovação desde o dia 3; a fila anda uma vez por semana",
      riscos: [{ titulo: "Aprovação travada", gravidade: "alta", detalhe: "Parado há 10 dias" }],
      fontes: { clickup: true, supabase: true },
    })}\n\`\`\``;
    const out = parseBriefReply(reply);
    expect(out.briefMd).toBe(prosa);
    expect(out.briefMd).not.toContain("```");
    expect(out.brief?.contexto_operacional).toBe(
      "Criativo em aprovação desde o dia 3; a fila anda uma vez por semana",
    );
    expect(out.brief?.riscos).toHaveLength(1);
    expect(out.fontes.clickup).toBe(true);
  });

  it("JSON malformado não derruba o resumo: a prosa sobrevive", () => {
    const out = parseBriefReply(`${prosa}\n\n\`\`\`json\n{ isso não é json }\n\`\`\``);
    expect(out.briefMd).toContain("Criativo novo em aprovação");
    expect(out.brief).toBeNull();
  });

  it("sem bloco nenhum, ainda entrega a prosa", () => {
    expect(parseBriefReply(prosa).briefMd).toBe(prosa);
  });

  it("pega o ÚLTIMO bloco: o resumo pode citar JSON antes", () => {
    const reply =
      'Exemplo:\n\n```json\n{ "contexto_operacional": "exemplo" }\n```\n\n' +
      `${prosa}\n\n\`\`\`json\n${JSON.stringify({ contexto_operacional: "de verdade", riscos: [] })}\n\`\`\``;
    expect(parseBriefReply(reply).brief?.contexto_operacional).toBe("de verdade");
  });

  it("normaliza gravidade desconhecida e descarta risco sem título", () => {
    const reply = `x\n\n\`\`\`json\n${JSON.stringify({
      riscos: [
        { titulo: "Produção parada", gravidade: "CRÍTICA", detalhe: "d" },
        { titulo: "", gravidade: "alta", detalhe: "sem título, fora" },
      ],
    })}\n\`\`\``;
    const riscos = parseBriefReply(reply).brief?.riscos ?? [];
    expect(riscos).toHaveLength(1);
    expect(riscos[0].gravidade).toBe("media");
  });

  it("clickup só é verdadeiro quando o agente afirma que consultou", () => {
    const semFontes = `x\n\n\`\`\`json\n${JSON.stringify({ riscos: [] })}\n\`\`\``;
    expect(parseBriefReply(semFontes).fontes.clickup).toBe(false);
  });
});

/**
 * A reestruturação de setembro de 2026 tirou a métrica do resumo. Ela atravessa quatro arquivos e a
 * definição do agente no servidor, então tem três formas de ficar pela metade — e nenhuma delas dá
 * erro. Este bloco cobre as três.
 */
describe("o resumo não fala mais de número", () => {
  it("o prompt não manda métrica nem nomeia semana", () => {
    const p = buildBriefPrompt({ ficha: FICHA });
    // Proibir as PALAVRAS não serve: o prompt cita "investimento, lead, CPL, faturamento e ROAS"
    // justamente para dizer que são assunto do Relatório. O que não pode aparecer é VALOR — então o
    // alvo são os rótulos que o antigo `blocoMetricas` emitia, e qualquer dinheiro formatado.
    expect(p).not.toMatch(/Números d|SEMANA FECHADA analisada|ROAS:|CPL \(CRM\)/i);
    expect(p).not.toContain("R$");
    // E diz ao agente, com todas as letras, que a ausência é de propósito: uma definição de agente
    // antiga ainda pediria para "nomear a semana", e sem esta frase ele inventaria o número.
    expect(p).toMatch(/NÃO recebeu número nenhum/i);
  });

  it("o parser não devolve mais `resultados`, nem que o agente insista", () => {
    // Pega o caso "trocou o .md do agente mas não o parser" (e o inverso): uma resposta no formato
    // velho não pode gravar chave morta em linha nova.
    const reply = `x\n\n\`\`\`json\n${JSON.stringify({
      contexto_operacional: "operação rodando",
      resultados: "Na semana de 07/09 a 13/09 o CPL caiu",
      riscos: [],
    })}\n\`\`\``;
    const brief = parseBriefReply(reply).brief ?? {};
    expect("resultados" in brief).toBe(false);
    expect(brief.contexto_operacional).toBe("operação rodando");
  });

  it("linha antiga continua legível: `contexto` e `situacao` servem de fallback", () => {
    // O upsert é por cliente e o job só reescreve quem precisa, então linhas no formato velho
    // convivem com as novas por até uma semana. Ler os dois nomes é o que impede a tela de esvaziar.
    const velho = `x\n\n\`\`\`json\n${JSON.stringify({
      situacao: "Criativo em aprovação",
      riscos: [],
    })}\n\`\`\``;
    expect(parseBriefReply(velho).brief?.contexto_operacional).toBe("Criativo em aprovação");
  });
});
