import type { BIMes } from "@/components/gestao/useGestaoBI";
import { formatarMarcoAbreviado } from "./indicadores";
import { encontrarDestaques, type CelulaExecutiva, type FaixaMeta } from "./painelExecutivo";
import type { IndicadorMarco } from "@/lib/marcosMetas";

export type ApoioPainel = {
  tipo?: "texto";
  titulo: string;
  valor: string;
  detalhe?: string;
  alvo?: { indicador?: IndicadorMarco; mes?: string };
  icone?: "alvo" | "medal" | "alerta" | "gauge";
  razao?: number;
  faixa?: FaixaMeta;
};
export type ApoioEspecial = { tipo: "pacing" | "metaEntrega" | "posicao" | "proximo"; titulo: string };
export type ItemApoio = ApoioPainel | ApoioEspecial;

const ordenar = (itens: CelulaExecutiva[]) => [...itens].sort((a, b) => b.razaoDirecional - a.razaoDirecional || a.mes.mes.localeCompare(b.mes.mes));
const PACE: ApoioEspecial = { tipo: "pacing", titulo: "Pacing" };

const realMeta = (c: CelulaExecutiva) => `real ${formatarMarcoAbreviado(c.real, c.indicador.formato)} · meta ${formatarMarcoAbreviado(c.meta, c.indicador.formato)}`;
const deCelula = (titulo: string, c: CelulaExecutiva, contexto: string, icone?: ApoioPainel["icone"]): ApoioPainel => ({
  titulo,
  valor: contexto,
  detalhe: realMeta(c),
  alvo: { indicador: c.indicador.chave, mes: c.mes.mes },
  razao: c.razao,
  faixa: c.faixa,
  ...(icone ? { icone } : {}),
});

/**
 * celulas: escopo dos filtros da página; celulasHist: últimos 12 meses até o mês selecionado.
 */
export function montarApoios(celulas: CelulaExecutiva[], celulasHist: CelulaExecutiva[], meses: BIMes[], indicador: IndicadorMarco | "todos", escopoMes: boolean): ItemApoio[] {
  if (indicador === "todos" && !escopoMes) {
    const d = encontrarDestaques(celulas, meses);
    const doConsistente = d.consistente ? celulas.filter((c) => c.indicador.chave === d.consistente!.indicador.chave) : [];
    const piorConsistente = doConsistente.length ? ordenar(doConsistente).at(-1)! : undefined;
    const razaoConsistente = d.consistente ? d.consistente.batidas / d.consistente.total : undefined;
    const faixaConsistente: FaixaMeta | undefined = razaoConsistente === undefined ? undefined : razaoConsistente >= 1.1 ? "superada" : razaoConsistente >= 1 ? "atingida" : "nao-batida";
    return [
      {
        titulo: "Mais consistente",
        valor: d.consistente ? `${d.consistente.indicador.nome} · ${d.consistente.batidas} de ${d.consistente.total} metas batidas` : "—",
        ...(d.consistente ? { alvo: { indicador: d.consistente.indicador.chave } } : {}),
        ...(piorConsistente ? { detalhe: `pior mês: ${piorConsistente.mes.label} · ${(piorConsistente.razao * 100).toFixed(1).replace(".", ",")}%` } : {}),
        ...(razaoConsistente !== undefined ? { razao: razaoConsistente } : {}),
        ...(faixaConsistente ? { faixa: faixaConsistente } : {}),
        icone: "medal" as const,
      },
      d.desvio
        ? deCelula(d.desvioRuim ? "Maior desvio" : "Maior superação", d.desvio, `${d.desvio.indicador.nome} · ${d.desvio.mes.label}`, "alerta")
        : { titulo: d.desvioRuim ? "Maior desvio" : "Maior superação", valor: "—", icone: "alerta" as const },
      PACE,
    ];
  }
  if (indicador === "todos") {
    const ranking = ordenar(celulas);
    const melhor = ranking[0];
    const pior = ranking.at(-1);
    return [
      melhor ? deCelula("Melhor indicador", melhor, melhor.indicador.nome, "medal") : { titulo: "Melhor indicador", valor: "—" },
      pior ? deCelula("Pior indicador", pior, pior.indicador.nome, "alerta") : { titulo: "Pior indicador", valor: "—" },
      PACE,
    ];
  }
  if (escopoMes) {
    return [
      { tipo: "metaEntrega", titulo: "Meta contra entrega" },
      { tipo: "posicao", titulo: "Posição no histórico" },
      { tipo: "proximo", titulo: "Próximo mês" },
    ];
  }
  const serie = celulas.filter((c) => c.indicador.chave === indicador);
  const ranking = ordenar(serie);
  const melhor = ranking[0];
  const pior = ranking.at(-1);
  return [
    melhor ? deCelula("Melhor mês", melhor, melhor.mes.label) : { titulo: "Melhor mês", valor: "—" },
    pior ? deCelula("Pior mês", pior, pior.mes.label) : { titulo: "Pior mês", valor: "—" },
    PACE,
  ];
}
