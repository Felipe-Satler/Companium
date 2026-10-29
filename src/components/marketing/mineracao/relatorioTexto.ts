import { isOrganicAd, type SpyAd } from "@/lib/adSpyApi";

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * O relatório em texto sem as seções `## <título>` pedidas — cada uma do título até o próximo
 * título de mesmo nível (ou o fim). Os `###` de dentro dela vão junto.
 */
export function semSecoes(md: string | null, titulos: string[]): string | null {
  if (!md || !titulos.length) return md;
  const nomes = titulos.map(escapar).join("|");
  const re = new RegExp(`^##[ \\t]+(?:${nomes})[^\\n]*\\n[\\s\\S]*?(?=^##[ \\t]|(?![\\s\\S]))`, "gim");
  return md.replace(re, "");
}

/**
 * O relatório em texto sem a seção "## Dissecação".
 *
 * Desde 17/10/2026 a dissecação é pedida peça a peça (Mineração › Análises de Criativos) e saiu da
 * análise da mineração. As análises salvas antes disso ainda a têm no texto, e a tela tem de ficar
 * igual para todas: a seção some daqui, do título até o próximo título de mesmo nível.
 */
export const semDissecacao = (md: string | null) => semSecoes(md, ["Dissecação"]);

/**
 * As seções que NÃO existem numa análise de conteúdo orgânico (decisão do usuário, 17/10/2026).
 *
 * Fatia de público, "o que parece funcionar" e sugestões são leituras de ANÚNCIO: falam de quem se
 * segmenta e do que se testa com verba. Com uma fonte por busca, uma busca orgânica é só orgânica, e
 * essas três seções ficavam ou vazias ou forçadas.
 */
export const SECOES_SO_DE_ANUNCIO = ["Fatias de público", "O que parece funcionar", "Sugestões"];

/** A análise é de conteúdo orgânico: todas as peças lidas são posts (Instagram, TikTok, YouTube). */
export const analiseOrganica = (ads: Pick<SpyAd, "source">[]) => ads.length > 0 && ads.every(isOrganicAd);
