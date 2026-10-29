import type { SpyAd, SpyCriativoResumo } from "@/lib/adSpyApi";
import { norm } from "@/lib/texto";

/** O nome que a análise ganha se a pessoa não escrever outro: o anunciante, e a data de hoje. */
export function tituloPadraoCriativo(ad: Pick<SpyAd, "page_name">, hoje = new Date()): string {
  const data = hoje.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
  return `${ad.page_name || "Anúncio"} — ${data}`;
}

/** O nome que a lista mostra: o título, ou o anunciante quando a análise ficou sem título. */
export const nomeDoCriativo = (c: Pick<SpyCriativoResumo, "titulo" | "ad">) =>
  c.titulo || c.ad?.page_name || "Análise de criativo";

/**
 * Busca por nome e recorte por favoritos, em memória — como `filtrarAnalises` da Biblioteca. A busca
 * olha o nome e o anunciante: salvar com o nome padrão é comum, e aí o anunciante é o que se lembra.
 */
export function filtrarCriativos(
  criativos: SpyCriativoResumo[],
  { busca = "", soFavoritos = false }: { busca?: string; soFavoritos?: boolean },
): SpyCriativoResumo[] {
  const termo = norm(busca.trim());
  return criativos.filter((c) => {
    if (soFavoritos && !c.favorito) return false;
    if (!termo) return true;
    return norm(`${c.titulo ?? ""} ${c.ad?.page_name ?? ""}`).includes(termo);
  });
}
