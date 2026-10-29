// Uma composição em texto, para sair da ferramenta: colar num documento, mandar ao cliente, anexar.
//
// O copiar campo a campo de `ComposicaoResultado` continua sendo o caminho para o Gerenciador de
// Anúncios — lá se cola UM título no campo de título. Isto é o outro uso: levar a peça inteira (ou
// o conjunto) para alguém ler. Markdown porque é legível como texto puro e vira título e lista em
// qualquer lugar que o entenda.

import { anunciosDe, type AnuncioComposto, type Composicao } from "@/lib/adComposerApi";
import { getFormato } from "../../shared/ad-formats";

/** Um anúncio inteiro: uso, ângulo e cada campo do formato, na ordem da spec. */
export function anuncioParaTexto(anuncio: AnuncioComposto, numero?: number): string {
  const formato = anuncio.formato ? getFormato(anuncio.formato) : null;
  const rotulo = formato?.label ?? anuncio.formato ?? "Anúncio";
  const linhas = [`## ${numero ? `${numero}. ` : ""}${rotulo}`];
  if (anuncio.angulo) linhas.push("", `_${anuncio.angulo}_`);

  // Pela SPEC, como a tela: campo que o agente esqueceu aparece como ausente em vez de sumir, e
  // quem lê o documento sabe que falta algo.
  for (const campo of formato?.campos ?? []) {
    const valor = anuncio.composicao?.[campo.id];
    linhas.push("", `### ${campo.label}`);
    if (campo.tipo === "lista") {
      const itens = Array.isArray(valor) ? valor : [];
      linhas.push(itens.length ? itens.map((item, i) => `${i + 1}. ${item}`).join("\n") : "—");
    } else {
      linhas.push(typeof valor === "string" && valor.trim() ? valor.trim() : "—");
    }
  }
  return linhas.join("\n");
}

/** Só os anúncios que ficaram prontos: um que falhou ou ainda está na fila não tem o que exportar. */
export function anunciosProntos(composicao: Composicao) {
  return anunciosDe(composicao).filter((a) => a.status === "ok" && a.composicao);
}

/**
 * O conjunto inteiro: de quem é, quando, a ideia do conjunto e cada anúncio pronto.
 *
 * Os avisos de limite NÃO vão: eles são para quem vai colar no gerenciador, e num documento para o
 * cliente "34/30 caracteres" é ruído. Os números internos também não — a composição não os guarda.
 */
export function composicaoParaTexto(composicao: Composicao): string {
  const prontos = anunciosProntos(composicao);
  const data = new Date(composicao.criado_em);
  const partes = [
    `# Anúncios — ${composicao.nome_exibicao || composicao.cliente}`,
    [
      Number.isNaN(data.getTime()) ? null : data.toLocaleDateString("pt-BR"),
      `${prontos.length} anúncio${prontos.length === 1 ? "" : "s"}`,
      composicao.analise_titulo ? `análise: ${composicao.analise_titulo}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  ];
  if (composicao.composicao_md?.trim()) partes.push(composicao.composicao_md.trim());
  prontos.forEach((a, i) => partes.push(anuncioParaTexto(a, prontos.length > 1 ? i + 1 : undefined)));
  return `${partes.join("\n\n")}\n`;
}

/** Nome de arquivo sem acento nem espaço: é o que sobrevive a qualquer sistema e a qualquer anexo. */
export function nomeDoArquivo(composicao: Composicao): string {
  const cliente = (composicao.nome_exibicao || composicao.cliente || "cliente")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return `anuncios-${cliente || "cliente"}-${String(composicao.criado_em).slice(0, 10)}.md`;
}

/** Entrega o texto como arquivo. Só no navegador: usa Blob e um link temporário. */
export function baixarTexto(nome: string, texto: string) {
  const url = URL.createObjectURL(new Blob([texto], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
