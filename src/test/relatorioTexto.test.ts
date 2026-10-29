/**
 * O relatório em texto puro.
 *
 * O risco desta conversão não é errar um acento: é **deixar marca de markdown passar**. Quem copia
 * "Texto" vai colar no WhatsApp ou num e-mail simples, onde `**Impacto:**` aparece com os
 * asteriscos à mostra — e aí a saída nova não serve para nada, que era o problema que ela veio
 * resolver.
 *
 * Por isso o teste central é de REGRESSÃO sobre o documento inteiro: um bloco novo em
 * `relatorioParaMarkdown` que o conversor não conheça quebra aqui, em vez de vazar para o texto
 * colado meses depois.
 */
import { describe, it, expect } from "vitest";
import { markdownParaTexto, relatorioParaTexto } from "@/utils/relatorioTexto";
import type { Relatorio } from "@/lib/clientReportsApi";

const relatorio = {
  id: "r1",
  cliente: "diego",
  nome_exibicao: "Dr. Diego Rezende",
  titulo: "Agosto — depois da troca de oferta",
  periodo_de: "2026-08-01",
  periodo_ate: "2026-08-31",
  periodo_label: "Agosto/2026",
  comparacao_de: "2026-07-01",
  comparacao_ate: "2026-07-31",
  comparacao_regra: "mes_anterior",
  avisos: [{ codigo: "meta_ausente", detalhe: "Sem meta cadastrada para agosto." }],
  fontes: null,
  status: "ok",
  error: null,
  criado_por: null,
  criado_em: "2026-09-01T12:00:00.000Z",
  atualizado_em: "2026-09-01T12:00:00.000Z",
  canDelete: false,
  comparacao_motivo: "mês anterior",
  observacao: "olhar a campanha nova",
  relatorio_md: null,
  relatorio: {
    leitura: "A conta caiu no meio do mês.",
    problema: {
      prioridade: "gargalo",
      texto: "O custo por lead dobrou.",
      impacto: "Metade do orçamento rendeu um terço dos leads.",
      criativos: ["V009", "IM007"],
    },
    causa: { texto: "A troca de oferta.", tipo: "correlacao", verificar: "Ver o criativo novo." },
    acao: { texto: "Voltar a oferta anterior.", responsavel: "Marina", prazo: "esta semana" },
    limitacoes: ["sem CRM na segunda quinzena"],
  },
  snapshot: {
    versao: 1,
    geradoEm: "2026-09-01T12:00:00.000Z",
    metricas: [
      {
        id: "cpl",
        grupo: "Marketing",
        label: "Custo por lead",
        unidade: "moeda",
        a: { valor: 42.5, disponivel: true },
        b: { valor: 21.25, disponivel: true },
        meta: { a: { valor: 30, status: "off" } },
      },
      {
        id: "leads",
        grupo: "Marketing",
        label: "Leads",
        unidade: "inteiro",
        a: { valor: 80, disponivel: true },
        b: { valor: null, disponivel: false },
        meta: null,
      },
    ],
  },
  snapshot_versao: 1,
  origem_numeros: "frontend",
  agent_id: "relatoriomarketingagent",
} as unknown as Relatorio;

describe("relatorioParaTexto — a regressão que importa", () => {
  const texto = relatorioParaTexto(relatorio);

  it("não deixa marca de markdown passar no documento inteiro", () => {
    // A lista cobre a sintaxe que `relatorioParaMarkdown` emite hoje MAIS a que ele plausivelmente
    // passaria a emitir. Não é uma prova de que todo markdown futuro será tratado — é uma rede que
    // pega o caso provável: alguém acrescenta um bloco com negrito, imagem ou tabela e esquece do
    // texto puro. Uma construção que não use nenhuma destas marcas passaria batido, e é o preço de
    // não ter um parser de markdown de verdade aqui.
    for (const [marca, re] of [
      ["negrito **", /\*\*/],
      ["negrito __", /__/],
      ["tachado ~~", /~~/],
      ["cabeçalho #", /^#/m],
      ["citação >", /^>/m],
      ["tabela |", /\|/],
      ["código `", /`/],
      ["régua ---", /^-{3,}$/m],
      ["imagem ![", /!\[/],
      ["link ](", /\]\(/],
    ] as [string, RegExp][]) {
      expect(texto, `sobrou ${marca} no texto`).not.toMatch(re);
    }
  });

  it("mantém o conteúdo — converter não é resumir", () => {
    expect(texto).toContain("Agosto — depois da troca de oferta");
    expect(texto).toContain("Dr. Diego Rezende");
    expect(texto).toContain("O custo por lead dobrou.");
    expect(texto).toContain("Metade do orçamento rendeu um terço dos leads.");
    expect(texto).toContain("Voltar a oferta anterior.");
    expect(texto).toContain("Sem meta cadastrada para agosto.");
    expect(texto).toContain("olhar a campanha nova");
  });

  it("os três estados de um valor continuam distintos", () => {
    // "sem informação", "não calculável" e um zero de verdade são coisas diferentes. Achatá-las na
    // exportação desfaria no último metro a honestidade que o resto do pipeline mantém.
    expect(texto).toContain("sem informação");
    expect(texto).toContain("sem meta");
  });

  it("as seções viram CAIXA ALTA, que é a hierarquia que texto puro tem", () => {
    expect(texto).toContain("LEITURA CRÍTICA");
    expect(texto).toContain("AÇÃO RECOMENDADA");
  });
});

describe("markdownParaTexto", () => {
  it("tabela vira colunas alinhadas, não uma linha por valor", () => {
    // A tabela existe para comparar período e comparável lado a lado; empilhar desfaz a leitura
    // que ela serve.
    const md = [
      "| Métrica | Período | Comparação |",
      "| --- | --- | --- |",
      "| Custo por lead | R$ 42,50 | R$ 21,25 |",
      "| Leads | 80 | sem informação |",
    ].join("\n");
    const linhas = markdownParaTexto(md).split("\n");
    // Largura de cada coluna = a maior célula dela, e duas colunas separadas por dois espaços.
    expect(linhas[0]).toBe("Métrica         Período   Comparação");
    expect(linhas[1]).toBe("Custo por lead  R$ 42,50  R$ 21,25");
    expect(linhas[2]).toBe("Leads           80        sem informação");
  });

  it("respeita o `|` escapado dentro de uma célula", () => {
    // `celula()` escreve `\|` para o pipe não quebrar a coluna; tratá-lo como separador criaria uma
    // coluna fantasma e desalinharia a tabela inteira.
    const md = "| Rótulo | Valor |\n| --- | --- |\n| a \\| b | 1 |";
    const linhas = markdownParaTexto(md).split("\n");
    expect(linhas[1]).toBe("a | b   1");
  });

  it("negrito dentro de itálico não deixa asterisco solto", () => {
    expect(markdownParaTexto("**Impacto:** *(hipótese)* o resto")).toBe(
      "Impacto: (hipótese) o resto",
    );
  });

  it("não come o asterisco do meio de uma palavra", () => {
    // Um nome de criativo como `V009*BR` não é itálico; comer o asterisco mudaria o dado.
    expect(markdownParaTexto("código V009*BR em uso")).toBe("código V009*BR em uso");
  });

  it("lista vira marcador de texto", () => {
    expect(markdownParaTexto("- um\n- dois")).toBe("• um\n• dois");
  });

  it("link leva o texto E o destino", () => {
    // Só o texto esconderia para onde vai; só a url esconderia o que ela é.
    expect(markdownParaTexto("veja o [painel](https://x/y)")).toBe("veja o painel (https://x/y)");
  });

  it("não deixa três linhas em branco seguidas", () => {
    expect(markdownParaTexto("a\n\n\n\n\nb")).toBe("a\n\nb");
  });
});
