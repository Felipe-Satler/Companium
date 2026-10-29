import { planoDe, type ComposicaoResumo } from "@/lib/adComposerApi";
import { getFormato } from "../../../../shared/ad-formats";

/** Os formatos do Composer que viram arte estática — os mesmos que o worker aceita. */
export const FORMATOS_DE_ARTE = ["instagram_feed", "meta_ads"];

export type AnuncioParaArte = {
  indice: number;
  formato: string | null;
  rotulo: string;
  angulo: string | null;
  /** Dá para criar arte dele. */
  elegivel: boolean;
  /** Por que não dá, em linguagem de quem vai ler na tela. */
  motivo: string | null;
};

/**
 * Os anúncios de uma composição salva, como a etapa "Anúncio" da Nova arte os mostra: TODOS, e não só
 * os elegíveis — um Reels some da lista e alguém acha que a composição perdeu um anúncio. O que não
 * vira arte aparece desabilitado, com o motivo.
 *
 * Lê o `plano` da listagem (formato, ângulo e estado), que vem sem a copy: a etapa não precisa
 * carregar oito peças inteiras de cada composição só para listar.
 */
export function anunciosParaArte(composicao: ComposicaoResumo): AnuncioParaArte[] {
  return planoDe(composicao).map((item, indice) => {
    const formato = item.formato ? getFormato(item.formato) : null;
    const rotulo = formato?.label ?? item.formato ?? "sem formato";
    let motivo: string | null = null;
    if (item.status !== "ok") motivo = "este anúncio não ficou pronto";
    else if (!item.formato || !FORMATOS_DE_ARTE.includes(item.formato)) {
      motivo = formato?.midia === "video" ? "é vídeo — vira reels, não arte estática" : "não é anúncio de imagem";
    }
    return { indice, formato: item.formato, rotulo, angulo: item.angulo ?? null, elegivel: !motivo, motivo };
  });
}

/** As composições que a Nova arte oferece: salvas e com ao menos um anúncio que vira arte. */
export function composicoesComArte(composicoes: ComposicaoResumo[]) {
  return composicoes.filter((c) => c.status === "ok" && anunciosParaArte(c).some((a) => a.elegivel));
}
