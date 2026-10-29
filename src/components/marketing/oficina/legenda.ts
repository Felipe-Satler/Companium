/**
 * A legenda como ela aparece: com as hashtags no fim, e cortada no "mais" de cada plataforma.
 *
 * Os cortes são aproximações do que o feed mostra no celular, não regra das plataformas — elas
 * mudam o corte por tamanho de tela e por idioma. O que importa conferir no mockup é o que a pessoa
 * lê ANTES do "mais", e para isso o número do Composer (125, o campo `abertura`) é a referência.
 */

export const CORTE_INSTAGRAM = 125;
/** Anúncio no feed do Facebook corta o texto principal perto de 125, como o Instagram. */
export const CORTE_FACEBOOK_PAGO = 125;
/** Post orgânico do Facebook mostra mais texto antes do "Ver mais". */
export const CORTE_FACEBOOK_ORGANICO = 280;

/** A legenda com as hashtags no fim, como vai colada no Instagram. */
export function legendaComHashtags(legenda: string, hashtags: string[]) {
  const tags = hashtags
    .map((h) => h.trim().replace(/^#+/, ""))
    .filter(Boolean)
    .map((h) => `#${h}`)
    .join(" ");
  return [legenda.trim(), tags].filter(Boolean).join("\n\n");
}

/**
 * O que aparece antes do "mais": até `limite` caracteres, cortado no fim de uma palavra, e nunca
 * passando da primeira quebra de linha dupla (o parágrafo seguinte já fica escondido no feed).
 */
export function cortarLegenda(texto: string, limite: number): { visivel: string; cortada: boolean } {
  const t = texto.trim();
  const fimDoParagrafo = t.indexOf("\n\n");
  const ate = fimDoParagrafo >= 0 && fimDoParagrafo < limite ? fimDoParagrafo : limite;
  if (t.length <= ate) return { visivel: t, cortada: false };
  const pedaco = t.slice(0, ate);
  const espaco = pedaco.lastIndexOf(" ");
  // Sem espaço razoável (uma palavra enorme ou um link), corta no limite mesmo.
  const visivel = (espaco > ate * 0.6 ? pedaco.slice(0, espaco) : pedaco).trimEnd();
  return { visivel, cortada: true };
}
