import type { BIMes } from "@/components/gestao/useGestaoBI";
import { GRUPOS_MARCOS, INDICADORES_MARCOS, type DefinicaoMarco } from "@/components/marcos/indicadores";
import type { IndicadorMarco, MetasMarcos } from "@/lib/marcosMetas";

export const LIMITE_SUPERACAO = 0.1;
export type FaixaMeta = "superada" | "atingida" | "nao-batida";

export type CelulaExecutiva = {
  grupo: string;
  indicador: DefinicaoMarco;
  mes: BIMes;
  meta: number;
  real: number;
  razao: number;
  razaoDirecional: number;
  faixa: FaixaMeta;
};

export function classificarMeta(real: number, meta: number, menorMelhor = false): FaixaMeta | null {
  if (!Number.isFinite(real) || !Number.isFinite(meta) || meta === 0) return null;
  const razao = real / meta;
  if (menorMelhor) {
    if (razao <= 1 - LIMITE_SUPERACAO) return "superada";
    if (razao <= 1) return "atingida";
    return "nao-batida";
  }
  if (razao >= 1 + LIMITE_SUPERACAO) return "superada";
  if (razao >= 1) return "atingida";
  return "nao-batida";
}

export function montarCelulasExecutivas(meses: BIMes[], metas: MetasMarcos, atual: string): CelulaExecutiva[] {
  return GRUPOS_MARCOS.flatMap((grupo) =>
    grupo.indicadores.flatMap((indicador) =>
      meses.flatMap((mes) => {
        const meta = metas[indicador.chave]?.[mes.mes];
        if (mes.mes > atual || meta === undefined || meta === 0) return [];
        const real = indicador.realizado(mes);
        const faixa = classificarMeta(real, meta, indicador.menorMelhor);
        if (!faixa) return [];
        const razao = real / meta;
        return [{ grupo: grupo.nome, indicador, mes, meta, real, razao, razaoDirecional: indicador.menorMelhor ? 2 - razao : razao, faixa }];
      }),
    ),
  );
}

export function resumirFaixas(celulas: CelulaExecutiva[]) {
  const superadas = celulas.filter((celula) => celula.faixa === "superada").length;
  const atingidas = celulas.filter((celula) => celula.faixa === "atingida").length;
  const naoBatidas = celulas.filter((celula) => celula.faixa === "nao-batida").length;
  return { superadas, atingidas, naoBatidas, batidas: superadas + atingidas, total: celulas.length };
}

export function encontrarDestaques(celulas: CelulaExecutiva[], meses: BIMes[]) {
  const mesesValidos = meses.map((mes) => {
    const doMes = celulas.filter((celula) => celula.mes.mes === mes.mes);
    return { mes, celulas: doMes, perfeito: doMes.length > 0 && doMes.every((celula) => celula.faixa !== "nao-batida") };
  }).filter((item) => item.celulas.length > 0);

  const porIndicador = INDICADORES_MARCOS.map((indicador, ordem) => {
    const itens = celulas.filter((celula) => celula.indicador.chave === indicador.chave);
    const batidas = itens.filter((celula) => celula.faixa !== "nao-batida").length;
    const razaoMedia = itens.length ? itens.reduce((total, celula) => total + celula.razaoDirecional, 0) / itens.length : Number.NEGATIVE_INFINITY;
    return { indicador, ordem, total: itens.length, batidas, razaoMedia };
  }).filter((item) => item.total > 0);

  const consistente = [...porIndicador].sort((a, b) => b.batidas - a.batidas || b.razaoMedia - a.razaoMedia || a.ordem - b.ordem)[0];
  const todosPerfeitos = porIndicador.length > 0 && porIndicador.every((item) => item.batidas === item.total);
  const critico = todosPerfeitos ? undefined : [...porIndicador].sort((a, b) => a.batidas - b.batidas || a.razaoMedia - b.razaoMedia || a.ordem - b.ordem)[0];
  const ruins = celulas.filter((celula) => celula.faixa === "nao-batida");
  const desvio = (ruins.length ? ruins : celulas).reduce<CelulaExecutiva | undefined>((melhor, celula) => {
    const distancia = Math.abs(celula.razaoDirecional - 1);
    return !melhor || distancia > Math.abs(melhor.razaoDirecional - 1) ? celula : melhor;
  }, undefined);

  return { mesesValidos, mesesPerfeitos: mesesValidos.filter((item) => item.perfeito).length, consistente, critico, todosPerfeitos, desvio, desvioRuim: ruins.length > 0 };
}

export function calcularSequencia(celulas: CelulaExecutiva[], indicador: IndicadorMarco, mes: string) {
  const serie = celulas.filter((celula) => celula.indicador.chave === indicador && celula.mes.mes <= mes).sort((a, b) => a.mes.mes.localeCompare(b.mes.mes));
  const ultimo = serie.find((celula) => celula.mes.mes === mes);
  if (!ultimo) return null;
  const bateu = ultimo.faixa !== "nao-batida";
  const mesesOrdenados = [...new Set(celulas.map((celula) => celula.mes.mes).filter((chaveMes) => chaveMes <= mes))].sort();
  let quantidade = 0;
  for (let i = mesesOrdenados.length - 1; i >= 0; i -= 1) {
    const chaveMes = mesesOrdenados[i];
    const item = serie.find((celula) => celula.mes.mes === chaveMes);
    if (!item || (item.faixa !== "nao-batida") !== bateu) break;
    quantidade += 1;
  }
  return { quantidade, bateu };
}