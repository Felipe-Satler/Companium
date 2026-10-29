/**
 * A regra que decide de quais documentos o conteúdo é lido.
 *
 * Teste de SEGURANÇA, não de classificação. Desde 05/10/2026 o padrão é ABERTO — a allowlist
 * fechada barrava 2.812 das 6.057 páginas, incluindo as Copys que são o material que o Composer
 * existe para usar. O que sobrou é uma trava estreita: nome de credencial nunca tem o corpo lido.
 *
 * Então a pergunta destes casos mudou. Antes era "o que acontece com o que ninguém previu?"; agora
 * é **"a trava cobre as três formas em que credencial aparece no workspace de verdade?"** — porque
 * com padrão aberto, o que a trava não pega, passa.
 */
import { describe, it, expect } from "vitest";
import {
  MAX_DOCS_COMPOSER_CHARS,
  TIPO_OUTRO,
  bloqueadoPorSeguranca,
  classificarDoc,
  ehTemplate,
  podeIngerirConteudo,
  serveAoComposer,
} from "../../shared/clickup-doc-tipos.js";

describe("trava de credencial", () => {
  it("pega as TRÊS formas que existem no workspace", () => {
    // Nomes reais. O terceiro é o que justifica o radical no singular: uma regra escrita só como
    // "Acessos" deixaria passar justamente o que tem credencial de um cliente nomeado.
    for (const nome of ["Acessos", "Materiais e Acessos", "Acesso Meta Ads Dr. Antonio - 09/03/2025"]) {
      expect(bloqueadoPorSeguranca(nome), nome).toBe(true);
      expect(classificarDoc(nome), nome).toBeNull();
      expect(podeIngerirConteudo(nome), nome).toBe(false);
    }
  });

  it("não pega palavra que só COMEÇA com acesso", () => {
    // "Acessibilidade" e "Acessório" são palavras legítimas de documento de cliente; a fronteira de
    // palavra é o que separa a trava de um bloqueio por prefixo, que derrubaria material de verdade.
    for (const nome of ["Acessibilidade do site", "Acessório cirúrgico - catálogo"]) {
      expect(bloqueadoPorSeguranca(nome), nome).toBe(false);
      expect(classificarDoc(nome), nome).not.toBeNull();
    }
  });

  it("padrão ABERTO: nome não previsto é liberado, com tipo `outro`", () => {
    // A inversão. Antes estes voltavam `null` e ficavam sem conteúdo; agora são documento comum.
    for (const nome of ["Documento", "Transplante Capilar - 01 - 25/04/24", "Contrato assinado", "Funil - 09/02/2025"]) {
      expect(classificarDoc(nome), nome).toBe(TIPO_OUTRO);
      expect(podeIngerirConteudo(nome), nome).toBe(true);
    }
  });

  it("`outro` serve ao Composer — com padrão aberto, sem rótulo é documento comum", () => {
    expect(serveAoComposer(TIPO_OUTRO)).toBe(true);
  });

  it("os rótulos conhecidos continuam classificando", () => {
    // O tipo deixou de ser portão e virou etiqueta, mas a etiqueta ainda importa: é ela que a aba
    // mostra e é por ela que `serveAoComposer` distingue ata de material criativo.
    const esperado: Record<string, string> = {
      "Mapeamento Estratégico - Dr. Lia Garrido": "mapeamento_estrategico",
      "Mapeamento do Cliente": "mapeamento_cliente",
      "Diagnóstico & Planejamento": "diagnostico_planejamento",
      "Briefing de Conteúdo": "briefing",
      "Ata | Briefing": "briefing",
      "Copys: Dra. Lia Garrido - 24": "copys",
      "Meetings - Comitê de Resultados": "reuniao",
    };
    for (const [nome, tipo] of Object.entries(esperado)) {
      expect(classificarDoc(nome), nome).toBe(tipo);
    }
  });

  it("classifica sem depender de acento nem de caixa", () => {
    expect(classificarDoc("MAPEAMENTO ESTRATEGICO")).toBe("mapeamento_estrategico");
    expect(classificarDoc("ACESSOS")).toBeNull();
  });

  it("ata de reunião é ingerida, mas NÃO é oferecida ao Composer", () => {
    expect(classificarDoc("Ata de reunião")).toBe("reuniao");
    expect(serveAoComposer("reuniao")).toBe(false);
    expect(serveAoComposer("mapeamento_estrategico")).toBe(true);
  });

  it("o orçamento do Composer deixa espaço para a análise e os anúncios", () => {
    expect(MAX_DOCS_COMPOSER_CHARS).toBeGreaterThan(4000);
    expect(MAX_DOCS_COMPOSER_CHARS).toBeLessThanOrEqual(32000);
  });
});

describe("ehTemplate", () => {
  it("o molde não é documento de cliente, mesmo casando com a allowlist", () => {
    // Seis Docs do workspace são templates, e o nome deles casa com a allowlist justamente por
    // serem o molde do documento. Sem a guarda, o sync baixaria os seis e os ofereceria como
    // insumo: um formulário em branco que o modelo preenche com invenção, e o resultado parece
    // fundamentado.
    expect(ehTemplate("Template - Mapeamento Estratégico")).toBe(true);
    expect(classificarDoc("Template - Mapeamento Estratégico")).toBeNull();
    expect(podeIngerirConteudo("[TEMPLATES] Briefing de Conteúdo")).toBe(false);
  });

  it('"modelo" NÃO é template, de propósito', () => {
    // Seria o sinônimo natural e está fora: "Modelo de Negócio" é seção legítima de mapeamento
    // estratégico, e a palavra derrubaria documento de cliente de verdade. A guarda erra para o
    // lado de deixar passar — template não pego fica sem cliente atribuído de qualquer jeito.
    expect(ehTemplate("Mapeamento Estratégico - Modelo de Negócio")).toBe(false);
    expect(classificarDoc("Mapeamento Estratégico - Modelo de Negócio")).toBe("mapeamento_estrategico");
  });

  it("não casa dentro de outra palavra", () => {
    expect(ehTemplate("Mapeamento Estratégico - Templating")).toBe(false);
  });
});
