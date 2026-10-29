/**
 * Fontes das artes: as famílias da lista do Brand kit, hospedadas em `public/fonts/posts/`
 * (`scripts/baixar-fontes-posts.mjs`). A CSP do site só aceita fonte do próprio domínio, e o preview
 * da tela precisa usar o MESMO arquivo que o render do worker — é isso que faz os dois serem iguais.
 *
 * O CSS com os @font-face é importado aqui, então quem usa `carregarFonte` já o tem. O navegador só
 * baixa o arquivo quando a família é usada (ou pedida por `document.fonts.load`).
 */

import "./fontes.css";

const PESOS = ["400", "700"];

/**
 * Espera os pesos usados pelos templates ficarem prontos. Nunca rejeita: sem o arquivo, a arte sai
 * na fonte de reserva — e o render avisa (`fontesFaltando`).
 */
export async function carregarFonte(familia: string, doc: Document = document): Promise<void> {
  if (!familia || !doc.fonts?.load) return;
  await Promise.all(PESOS.map((peso) => doc.fonts.load(`${peso} 32px "${familia}"`).catch(() => [])));
}

/** As famílias que não chegaram a carregar — o render devolve isso como aviso. */
export function fontesFaltando(familias: string[], doc: Document = document) {
  if (!doc.fonts?.check) return [];
  return familias.filter((f) => f && !doc.fonts.check(`700 32px "${f}"`));
}
