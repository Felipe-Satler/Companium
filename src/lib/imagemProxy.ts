/**
 * Redimensionamento de imagem de criativo via proxy (images.weserv.nl).
 *
 * As imagens de anúncio são re-hospedadas em full-res no Supabase Storage (ver `creatives.ts`), e o
 * weserv entra só para redimensionar e comprimir — servir full-res num card de 150px desperdiça banda.
 * Linhas antigas podem ainda carregar URL da CDN do Meta, que expira; por isso quem renderiza mantém
 * um `onError` com placeholder.
 *
 * O **modo de encaixe** é o parâmetro que importa, e os dois usos legítimos querem modos opostos:
 *
 * - `inside` NÃO corta: encaixa o criativo inteiro preservando o aspecto. É o certo quando alguém vai
 *   JULGAR o anúncio (card de Meta Ads, carrossel do Relatório) — criativo cortado engana.
 * - `cover` corta para preencher. É o certo em miniatura de tabela, onde a imagem é só um
 *   identificador visual e o quadrado uniforme ajuda a varrer a coluna.
 *
 * `we` (without enlargement) não amplia fonte pequena: miniatura legada de 64×64 fica pequena e nítida
 * em vez de esticada e borrada. `dpr=2` para ficar nítido em retina.
 */
export function proxiedImg(
  url: string,
  w = 720,
  h = 900,
  fit: "inside" | "cover" = "inside",
): string {
  const q = fit === "cover" ? 80 : 82;
  return `https://images.weserv.nl/?url=${encodeURIComponent(url)}&w=${w}&h=${h}&fit=${fit}&we&dpr=2&output=webp&q=${q}`;
}

/** Miniatura quadrada para tabela: corta para preencher, porque ali a imagem é identificador. */
export function thumbQuadrada(url: string, lado = 96): string {
  return proxiedImg(url, lado, lado, "cover");
}
