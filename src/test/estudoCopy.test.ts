/**
 * O leitor do Estudo de Copy (shared/estudo-copy.js), contra um Estudo REAL: o do Dr. Otavio
 * Brandt, recortado (identificação, avatares, dores e o começo da análise de concorrentes).
 *
 * O que se protege aqui é o que vira dado do sistema sem passar por modelo: o CRM da assinatura, a
 * ausência de RQE (que proíbe chamar o médico de especialista) e os avatares, cujos ids são a base
 * da unicidade dos Conceitos Estratégicos.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  assinaturaDoEstudo,
  ehEstudoDeCopy,
  ehPaginaDeEstudo,
  lerEstudoDeCopy,
  nivelDoEstudo,
} from "../../shared/estudo-copy.js";
import { classificarDoc } from "../../shared/clickup-doc-tipos.js";

const ESTUDO = fs.readFileSync(path.resolve(__dirname, "fixtures/estudo-copy-exemplo.txt"), "utf-8");

/** O mesmo Estudo como o ClickUp o devolveria em Markdown: títulos, negrito, listas. */
function comoMarkdown(txt: string) {
  const titulos = /^(Resumo Geral|Identificação Profissional|Serviços e|Vantagens Competitivas|O que o Cliente|Descrição Psicográfica|Avatares Base|Manifestação da Dor|Plano de Pesquisa|📍)/;
  return txt
    .split("\n")
    .map((l) => {
      if (titulos.test(l)) return `## ${l}`;
      if (/^\d+\. Avatar \d+:/.test(l)) return `### ${l.replace(/(Avatar \d+:)/, "**$1**")}`;
      const m = l.match(/^([^:]{1,30}):\s(.*)$/);
      if (m) return `- **${m[1]}:** ${m[2]}`;
      return l;
    })
    .join("\n");
}

describe("qual documento é Estudo de Copy", () => {
  it("o nome começa com 'Estudo de Copy', sem ligar para acento e caixa", () => {
    expect(ehEstudoDeCopy("Estudo de Copy – Tricologia e Transplante Capilar - Dr. Otavio Brandt")).toBe(true);
    expect(ehEstudoDeCopy("ESTUDO DE COPYS - Dra. Ana")).toBe(true);
    expect(ehEstudoDeCopy("  estudo  de copy")).toBe(true);
  });

  it("só no começo, e não pega as Copys nem 'copywriting'", () => {
    expect(ehEstudoDeCopy("Copys - Dr. Otavio")).toBe(false);
    expect(ehEstudoDeCopy("Novo Estudo de Copy")).toBe(false);
    expect(ehEstudoDeCopy("Estudo de Copywriting")).toBe(false);
    expect(ehEstudoDeCopy(null)).toBe(false);
  });

  it("aceita a numeração das subpáginas na frente do nome", () => {
    expect(ehEstudoDeCopy("1. Estudo de Copy – Tricologia e Transplante Capilar - Dr. Otavio Brandt")).toBe(true);
    expect(ehEstudoDeCopy("01 - Estudo de Copy")).toBe(true);
    expect(ehEstudoDeCopy("Estudo de Copy: Dr. Otavio Brandt")).toBe(true);
  });

  it("subpágina de um Estudo de Copy É Estudo de Copy, qualquer que seja o título dela", () => {
    expect(ehPaginaDeEstudo({ nome: "Parte 2 — Concorrentes", caminho: ["Estudo de Copy: Dr. Otavio Brandt"] })).toBe(true);
    expect(ehPaginaDeEstudo({ nome: "Página 1", docNome: "Estudo de Copy – Dr. Otavio" })).toBe(true);
    expect(ehPaginaDeEstudo({ nome: "Mapeamento - Dr. Otavio", caminho: ["Ativo"] })).toBe(false);
  });

  it("ganha o próprio tipo no sync", () => {
    expect(classificarDoc("Estudo de Copy – Tricologia - Dr. Otavio Brandt")).toBe("estudo_copy");
    expect(classificarDoc("Copys - Dr. Otavio")).toBe("copys");
  });
});

describe("leitura do Estudo de Copy", () => {
  for (const [forma, md] of [
    ["texto", ESTUDO],
    ["Markdown", comoMarkdown(ESTUDO)],
  ] as const) {
    it(`lê a identificação e os três avatares (${forma})`, () => {
      const e = lerEstudoDeCopy(md);
      expect(e.identificacao).toEqual({
        nome: "Dr. Otavio Lins Brandt",
        crm: "00000/MS",
        rqe: null,
        rqe_texto: "Não possui (Médico com atuação e pós-graduação em Tricologia e Transplante Capilar)",
      });
      expect(e.avatares.map((a) => [a.id, a.nome, a.nivel])).toEqual([
        ["A1", "O Empresário/Líder Discreto (Homem, 35 a 48 anos)", "consciente_solucao"],
        ["A2", "O Jovem Profissional em Ascensão (Homem, 28 a 35 anos)", "consciente_problema"],
        // "Consciente do Mecanismo" é lido como consciente da solução (decisão de 20/10/2026).
        ["A3", "A Mulher com Raleamento Central / Têmporas Abertas (Mulher, 32 a 50 anos)", "consciente_solucao"],
      ]);
      expect(e.avatares[2].nivel_original).toBe("Consciente do Mecanismo (Nível 4)");
      expect(e.avatares[0].perfil).toMatch(/^Sabe perfeitamente que tem calvície/);
      expect(e.avatares[0].dor).toMatch(/^Tudo começa na luz do teto/);
      expect(e.avatares[2].dor).toMatch(/rabo de cavalo fica mais fino/);
      expect(e.faltando).toEqual([]);
      expect(e.secoes).toEqual(expect.arrayContaining(["identificacao", "avatares", "dor", "vantagens", "concorrentes"]));
    });
  }

  it("lê o Markdown como o ClickUp devolve, com o número escapado (`1\\.`)", () => {
    // Linhas reais da API (página 8cknmgr-388653, 20/10/2026), pelo JSON.stringify: o ClickUp
    // escreve `1\.` para o número não virar lista, e os itens com `*` e três espaços.
    const md = [
      "### Avatares Base (Níveis de Consciência)",
      "#### 1\\. Avatar 1: O Empresário/Líder Discreto (Homem, 35 a 48 anos)",
      "*   Nível de Consciência: Consciente da Solução (Nível 3).",
      "*   Perfil: Sabe perfeitamente que tem calvície e já pesquisou sobre transplante capilar.",
      "#### 2\\. Avatar 2: O Jovem Profissional em Ascensão (Homem, 28 a 35 anos)",
      "*   Nível de Consciência: Consciente do Problema (Nível 2).",
      "*   Perfil: Começou a notar as entradas abrindo.",
      "#### 3\\. Avatar 3: A Mulher com Raleamento Central / Têmporas Abertas (Mulher, 32 a 50 anos)",
      "*   Nível de Consciência: Consciente do Mecanismo (Nível 4).",
      "*   Perfil: Sofre com a perda de densidade.",
      "### Manifestação da Dor \\(Efeito Bola de Neve por Avatar\\)",
      "**Avatar 1 \\(Empresário Discreto\\):**",
      "Tudo começa na luz do teto da sala de reuniões.",
    ].join("\n");
    const e = lerEstudoDeCopy(md);
    expect(e.faltando).toEqual([]);
    expect(e.avatares.map((a) => [a.id, a.nome, a.nivel])).toEqual([
      ["A1", "O Empresário/Líder Discreto (Homem, 35 a 48 anos)", "consciente_solucao"],
      ["A2", "O Jovem Profissional em Ascensão (Homem, 28 a 35 anos)", "consciente_problema"],
      ["A3", "A Mulher com Raleamento Central / Têmporas Abertas (Mulher, 32 a 50 anos)", "consciente_solucao"],
    ]);
    expect(e.avatares[0].perfil).toBe("Sabe perfeitamente que tem calvície e já pesquisou sobre transplante capilar.");
    expect(e.avatares[0].dor).toBe("Tudo começa na luz do teto da sala de reuniões.");
  });

  it("a dor de um avatar não engole a seção seguinte", () => {
    const e = lerEstudoDeCopy(ESTUDO);
    expect(e.avatares[2].dor).not.toMatch(/Plano de Pesquisa|transplante capilar sem raspar/);
  });

  it("sem a seção de avatares, diz o que falta", () => {
    const semAvatares = ESTUDO.split("Avatares Base")[0];
    expect(lerEstudoDeCopy(semAvatares).faltando).toEqual(["Avatares Base"]);
    expect(lerEstudoDeCopy("").faltando).toEqual(["Avatares Base"]);
  });

  it("RQE informado é lido", () => {
    const comRqe = ESTUDO.replace(/^RQE: .*$/m, "RQE: 45678");
    expect(lerEstudoDeCopy(comRqe).identificacao.rqe).toBe("45678");
  });
});

describe("nível de consciência do Estudo", () => {
  it("cobre os rótulos que o modelo usa", () => {
    expect(nivelDoEstudo("Inconsciente (Nível 1)")).toBe("inconsciente");
    expect(nivelDoEstudo("Consciente do Problema (Nível 2).")).toBe("consciente_problema");
    expect(nivelDoEstudo("Consciente da Solução (Nível 3).")).toBe("consciente_solucao");
    expect(nivelDoEstudo("Consciente do Mecanismo (Nível 4).")).toBe("consciente_solucao");
    expect(nivelDoEstudo("Consciente do Produto (Nível 5)")).toBe("consciente_produto");
    expect(nivelDoEstudo("Totalmente Consciente")).toBe("consciente_produto");
    expect(nivelDoEstudo("algo que ninguém previu")).toBe("");
  });
});

describe("assinatura do vídeo", () => {
  it("sem RQE, o campo não aparece", () => {
    expect(assinaturaDoEstudo(lerEstudoDeCopy(ESTUDO).identificacao)).toBe("Dr. Otavio Lins Brandt | CRM: 00000/MS");
  });

  it("com RQE, aparece; sem nome ou CRM, fica marcado para preencher", () => {
    expect(assinaturaDoEstudo({ nome: "Dra. Ana", crm: "1/SP", rqe: "9" })).toBe("Dra. Ana | CRM: 1/SP | RQE: 9");
    expect(assinaturaDoEstudo(null)).toBe("[Nome do médico] | CRM: [CRM]");
  });
});

// --- Estudo dividido em subpáginas: o corte pelas partes mais úteis (22/10/2026) ------------------

import { estudoPriorizado, partesDoEstudo } from "../../shared/estudo-copy.js";

describe("Estudo grande no prompt", () => {
  // Como `conteudoComSubpaginas` junta o Estudo do Instituto Serena: página vazia + subpáginas.
  const md = [
    "## Subpágina: 1. Briefing de Copy – Instituto Serena\n\n" + "briefing ".repeat(500),
    "## Subpágina: 2. Buyer Personas - Instituto Serena\n\n# PERSONA 1: Consciente do Problema (CP)",
    "## Subpágina: 6. Pesquisa & Análise de Criativos - Instituto Serena\n\n" + "pesquisa ".repeat(300),
    "## Subpágina: 7. Ângulos & Ideias - Instituto Serena\n\nÂngulo: o santuário.",
  ].join("\n\n");

  it("separa as partes pelo título de cada subpágina", () => {
    expect(partesDoEstudo(md).map((p) => p.titulo)).toEqual([
      "1. Briefing de Copy – Instituto Serena",
      "2. Buyer Personas - Instituto Serena",
      "6. Pesquisa & Análise de Criativos - Instituto Serena",
      "7. Ângulos & Ideias - Instituto Serena",
    ]);
  });

  it("cabe inteiro: volta igual", () => {
    expect(estudoPriorizado(md, 100_000)).toBe(md.trim());
  });

  it("não cabe: personas e ângulos primeiro, e diz o que ficou de fora", () => {
    const out = estudoPriorizado(md, 800);
    expect(out.indexOf("PERSONA 1")).toBeLessThan(out.indexOf("o santuário"));
    expect(out.startsWith("## Subpágina: 2. Buyer Personas")).toBe(true);
    expect(out).toMatch(/NÃO couberam aqui e não foram lidas: .*Pesquisa & Análise de Criativos/);
    expect(out.length).toBeLessThan(1000);
  });
});
