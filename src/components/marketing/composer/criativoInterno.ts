import type { AnuncioCardData } from "@/hooks/useMetaAdsCriativosData";
import type { SpyCriativoResumo } from "@/lib/adSpyApi";
import { norm } from "@/lib/texto";
import { MAX_ANUNCIOS } from "../../../../shared/ad-formats";

/**
 * Teto de análises de criativo por composição (concorrentes + o interno): uma por anúncio no
 * máximo. Cada análise é um formato possível para os Conceitos Estratégicos, e mais formatos do que
 * anúncios não acrescentam nada — só prompt. O worker confere o mesmo teto.
 */
export const MAX_CRIATIVOS = MAX_ANUNCIOS;

/**
 * O criativo do PRÓPRIO cliente escolhido para a composição — no máximo UM por composição: ele pode
 * ainda não ter dissecação, e ela é feita antes de compor (a etapa de preparo do Resultado). As
 * dissecações de concorrentes, que já estão prontas, podem ser várias (desde 20/10/2026: cada uma é
 * um formato possível para os Conceitos Estratégicos).
 */
export type CriativoInternoEscolhido = {
  metaAdId: string;
  nome: string;
  /** Os números do criativo no período, já em texto. Só vão ao agente se `incluirNumeros`. */
  numeros: string | null;
};

/** O que o selo de um criativo interno diz. */
export type EstadoInterno = "dissecado" | "dissecando" | "impossivel" | "sem_video" | "nao_dissecado";

export const ROTULO_ESTADO: Record<EstadoInterno, string> = {
  dissecado: "Dissecado",
  dissecando: "Dissecando…",
  impossivel: "Dissecação impossível",
  sem_video: "Sem vídeo",
  nao_dissecado: "Não dissecado",
};

/**
 * O estado de um criativo interno, cruzando o anúncio com a análise que houver para ele.
 *
 * Sem vídeo não há o que dissecar (decisão do usuário: dissecação exige vídeo) — o criativo
 * aparece, com o selo dizendo isso, mas não pode ser escolhido. Vídeo é o arquivo guardado pela
 * conta de anúncios (`videoUrl`, o que o card toca) OU o link do post: olhar só o link deixava de
 * fora anúncio que a tela tocava normalmente.
 */
export function estadoDoInterno(
  anuncio: Pick<AnuncioCardData, "videoPermalink"> & Partial<Pick<AnuncioCardData, "videoUrl">>,
  analise: Pick<SpyCriativoResumo, "status"> | undefined,
): EstadoInterno {
  if (analise?.status === "done") return "dissecado";
  if (analise?.status === "running") return "dissecando";
  if (analise?.status === "error") return "impossivel";
  return anuncio.videoUrl || anuncio.videoPermalink ? "nao_dissecado" : "sem_video";
}

/**
 * Dá para escolher este criativo para a composição?
 *
 * "Impossível" PODE, desde 19/10/2026: escolher de novo tenta a dissecação outra vez. Antes ele
 * ficava travado para sempre — e uma dissecação que falhou por um defeito já corrigido (o vídeo
 * do VID 005 do Dr. Aurelio, que o worker não achava) nunca mais podia ser feita. Só "sem vídeo"
 * continua sem escolha: aí não há o que tentar.
 */
export const escolhivel = (e: EstadoInterno) => e !== "sem_video";

/**
 * A análise mais recente de cada criativo interno, por `Ad_ID`. A lista vem da mais nova para a
 * mais antiga, então a primeira que aparecer é a que vale.
 */
export function analisePorAnuncio(analises: SpyCriativoResumo[]): Map<string, SpyCriativoResumo> {
  const m = new Map<string, SpyCriativoResumo>();
  for (const a of analises) if (a.meta_ad_id && !m.has(a.meta_ad_id)) m.set(a.meta_ad_id, a);
  return m;
}

/** Busca por nome do anúncio ou título, em memória. */
export function filtrarInternos(anuncios: AnuncioCardData[], busca: string): AnuncioCardData[] {
  const termo = norm(busca.trim());
  if (!termo) return anuncios;
  return anuncios.filter((a) => norm(`${a.nome} ${a.headline ?? ""} ${a.campanha}`).includes(termo));
}

const brl = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Hook, hold e CTR já chegam em pontos percentuais (12,3 = 12,3%), como na aba Meta Ads. */
const pct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

/**
 * Os números do criativo no período, em uma linha — o que vai ao agente quando a pessoa marca
 * "incluir os números". Só o que existe: métrica zerada por não se aplicar (hook de imagem, leads
 * de campanha de mensagem) não entra, para não parecer resultado ruim.
 */
export function numerosDoAnuncio(a: Pick<AnuncioCardData, "agg">, periodo: string): string {
  const m = a.agg;
  const partes = [
    m.gasto > 0 && `investimento ${brl(m.gasto)}`,
    m.resultado > 0 && `${m.resultado.toLocaleString("pt-BR")} ${m.tipoResultado || "resultados"}`.trim(),
    m.custoPorResultado > 0 && `custo por resultado ${brl(m.custoPorResultado)}`,
    m.impressoes > 0 && `${m.impressoes.toLocaleString("pt-BR")} impressões`,
    m.ctr > 0 && `CTR ${pct(m.ctr)}`,
    m.cpc > 0 && `CPC ${brl(m.cpc)}`,
    m.hookRate > 0 && `hook ${pct(m.hookRate)}`,
    m.holdRate > 0 && `hold ${pct(m.holdRate)}`,
  ].filter(Boolean);
  return partes.length ? `${periodo}: ${partes.join(", ")}` : "";
}
