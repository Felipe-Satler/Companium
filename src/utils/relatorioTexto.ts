import type { Relatorio } from "@/lib/clientReportsApi";
import { relatorioParaMarkdown } from "@/utils/relatorioMarkdown";

/**
 * O relatório em TEXTO PURO, para colar onde markdown não é interpretado.
 *
 * Markdown colado no WhatsApp, num e-mail em texto simples ou num campo de CRM aparece com os
 * asteriscos à mostra: `**Impacto:** metade do orçamento` em vez de "Impacto: metade do orçamento".
 * Quem copia para mandar ao cliente não quer explicar o que são os asteriscos.
 *
 * ## Por que converter o markdown em vez de montar o texto de novo
 *
 * O documento é montado uma vez só, em `relatorioParaMarkdown`, e esta função o traduz. A
 * alternativa — um segundo montador — significaria manter duas versões do mesmo documento em
 * sincronia, e a que ninguém olha é a que silenciosamente deixa de incluir um bloco novo.
 *
 * O conversor é deliberadamente estreito: ele trata as construções que NÓS geramos, não markdown
 * arbitrário. Isso funciona porque a entrada é sempre a saída da função ao lado. A rede de proteção
 * é um teste que roda um relatório completo e exige que nenhuma de uma LISTA de marcas sobre —
 * negrito, cabeçalho, tabela, código, imagem, link. É uma rede, não uma prova: uma construção nova
 * que não use nenhuma dessas marcas passaria batido, e esse é o preço de não embutir um parser de
 * markdown aqui.
 */

/** Marcas que não podem sobrar no texto final — a lista que o teste de regressão usa. */
const INLINE: [RegExp, string][] = [
  // Negrito e itálico, nesta ordem: `**x**` antes de `*x*`, senão o segundo come os asteriscos do
  // primeiro e sobra um par solto.
  [/\*\*(.+?)\*\*/g, "$1"],
  [/(?<!\w)\*(.+?)\*(?!\w)/g, "$1"],
  [/`([^`]+)`/g, "$1"],
  // Link markdown vira "texto (url)": só o texto esconderia o destino, e só a url esconderia o que
  // ela é.
  [/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)"],
];

const aplicarInline = (s: string) => INLINE.reduce((txt, [re, sub]) => txt.replace(re, sub), s);

/** Uma linha de tabela markdown -> as células, já sem o escape de `|`. */
function celulas(linha: string): string[] {
  return linha
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    // Divide só nos `|` que NÃO foram escapados — `celula()` escreve `\|` dentro do conteúdo.
    .split(/(?<!\\)\|/)
    .map((c) => aplicarInline(c.replace(/\\\|/g, "|").trim()));
}

/**
 * Uma tabela markdown em colunas alinhadas por espaço.
 *
 * Alinhada, e não "Métrica: valor" por linha: a tabela de números existe para comparar o período
 * com o comparável lado a lado, e empilhar os valores desfaz exatamente a leitura que ela serve.
 * Fonte monoespaçada no destino não é garantida, mas o alinhamento ainda ajuda, e quando não ajuda
 * não atrapalha.
 */
function tabelaEmTexto(linhas: string[]): string[] {
  // A linha de separação (`| --- | --- |`) é sintaxe, não conteúdo.
  const grade = linhas.map(celulas).filter((cs) => !cs.every((c) => /^:?-{3,}:?$/.test(c)));
  if (!grade.length) return [];

  const largura: number[] = [];
  for (const linha of grade) {
    linha.forEach((c, i) => {
      largura[i] = Math.max(largura[i] ?? 0, c.length);
    });
  }

  return grade.map((linha) =>
    linha
      .map((c, i) => (i === linha.length - 1 ? c : c.padEnd(largura[i])))
      .join("  ")
      .trimEnd(),
  );
}

export function markdownParaTexto(md: string): string {
  const linhas = String(md ?? "").split("\n");
  const out: string[] = [];

  for (let i = 0; i < linhas.length; i += 1) {
    const linha = linhas[i];

    // Tabela: junta o bloco inteiro antes de converter, porque alinhar colunas exige ver todas as
    // linhas de uma vez.
    if (/^\s*\|/.test(linha)) {
      const bloco: string[] = [];
      while (i < linhas.length && /^\s*\|/.test(linhas[i])) {
        bloco.push(linhas[i]);
        i += 1;
      }
      i -= 1;
      out.push(...tabelaEmTexto(bloco));
      continue;
    }

    // A régua horizontal é decoração de documento; em texto puro ela vira ruído.
    if (/^\s*-{3,}\s*$/.test(linha)) {
      out.push("");
      continue;
    }

    // O título do documento (`#`) fica como está: é o nome do relatório, não uma seção.
    const h1 = linha.match(/^#\s+(.*)$/);
    if (h1) {
      out.push(aplicarInline(h1[1].trim()));
      continue;
    }

    // Seções em CAIXA ALTA — a convenção de texto puro para hierarquia, e a única que sobrevive a
    // um campo que não formata nada.
    const h = linha.match(/^#{2,}\s+(.*)$/);
    if (h) {
      out.push("", aplicarInline(h[1].trim()).toUpperCase());
      continue;
    }

    let texto = linha;
    texto = texto.replace(/^\s*>\s?/, "");
    texto = texto.replace(/^(\s*)[-*+]\s+/, "$1• ");
    texto = aplicarInline(texto);
    // Dois espaços no fim são a quebra de linha do markdown: a quebra já existe aqui.
    out.push(texto.replace(/\s+$/, ""));
  }

  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function relatorioParaTexto(r: Relatorio): string {
  return markdownParaTexto(relatorioParaMarkdown(r));
}
