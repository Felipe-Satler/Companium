import type { BIMes } from "@/components/gestao/useGestaoBI";
import { INDICADORES_MARCOS, formatarMarcoAbreviado, type DefinicaoMarco } from "./indicadores";
import type { IndicadorMarco, MetasMarcos } from "@/lib/marcosMetas";


export type Lacuna = {
  indicador: DefinicaoMarco;
  /** Positivo = falta (ou estourou, no menor-é-melhor); zero/negativo = meta batida. */
  lacuna: number;
  relativa: number;
  /** Meta usada na razão (zero = fora da situação geral). */
  meta: number;
  referencia: string;
};

const temMeta = (metas: MetasMarcos, ind: IndicadorMarco, mes: string) => { const v = metas[ind]?.[mes]; return v !== undefined && Number.isFinite(v); };

export function calcularLacuna(def: DefinicaoMarco, meses: BIMes[], metas: MetasMarcos, atual: string, escopoMes: boolean): Lacuna | null {
  if (!escopoMes && def.acumula) {
    const comMeta = meses.filter((m) => temMeta(metas, def.chave, m.mes));
    if (!comMeta.length) return null;
    const somaMetas = comMeta.reduce((s, m) => s + metas[def.chave]![m.mes]!, 0);
    // Mesmo conjunto das metas: meses com meta que já passaram; real não finito é ignorado.
    const somaReais = comMeta.filter((m) => m.mes <= atual).reduce((s, m) => { const r = def.realizado(m); return Number.isFinite(r) ? s + r : s; }, 0);
    const lacuna = def.menorMelhor ? somaReais - somaMetas : somaMetas - somaReais;
    return { indicador: def, lacuna, relativa: somaMetas ? lacuna / Math.abs(somaMetas) : 0, meta: somaMetas, referencia: "no acumulado do período" };
  }
  const mes = [...meses].reverse().find((m) => m.mes <= atual && temMeta(metas, def.chave, m.mes) && Number.isFinite(def.realizado(m)));
  if (!mes) return null;
  const meta = metas[def.chave]![mes.mes]!;
  const real = def.realizado(mes);
  const lacuna = def.menorMelhor ? real - meta : meta - real;
  return { indicador: def, lacuna, relativa: meta ? lacuna / Math.abs(meta) : 0, meta, referencia: `para a meta de ${mes.label}` };
}

export function textoLacuna(l: Lacuna) {
  const abs = Math.abs(l.lacuna);
  if (l.indicador.formato === "percentual") {
    const v = `${abs.toFixed(1).replace(".", ",")} p.p.`;
    return l.lacuna > 0 ? `${v} acima da meta` : `+${v} de folga`;
  }
  const v = l.indicador.formato === "inteiro" ? `${Math.round(abs).toLocaleString("pt-BR")} ${l.indicador.chave === "novos" || l.indicador.chave === "ativos" ? (Math.round(abs) === 1 ? "cliente" : "clientes") : ""}`.trim() : formatarMarcoAbreviado(abs, l.indicador.formato);
  return l.lacuna > 0 ? `Faltam ${v}` : `+${v} acima da meta`;
}

export type Situacao = { desvio: number; faixa: "acima" | "na" | "abaixo"; folga?: Lacuna | undefined; lacuna?: Lacuna | undefined; unico: string; total: number };

/** Desvio mediano (d positivo = melhor que a meta), sobre valores crus. */
export function situacaoGeral(meses: BIMes[], metas: MetasMarcos, atual: string, escopoMes: boolean): Situacao | null {
  const ls = INDICADORES_MARCOS.map((d) => calcularLacuna(d, meses, metas, atual, escopoMes)).filter((l): l is Lacuna => !!l && l.meta !== 0 && Number.isFinite(l.relativa));
  if (!ls.length) return null;
  const ord = [...ls].sort((a, b) => -a.relativa - -b.relativa);
  const ds = ord.map((l) => -l.relativa);
  const n = ds.length;
  const desvio = n % 2 ? ds[(n - 1) / 2]! : (ds[n / 2 - 1]! + ds[n / 2]!) / 2;
  const faixa = desvio > 0.1 ? "acima" : desvio >= 0 ? "na" : "abaixo";
  return n < 2 ? { desvio, faixa, unico: ord[0]!.indicador.nome, total: n } : { desvio, faixa, folga: ord[n - 1], lacuna: ord[0], unico: "", total: n };
}

export function textoExtremo(l: Lacuna) {
  const abs = Math.abs(l.lacuna);
  const bom = l.lacuna <= 0;
  if (l.indicador.formato === "percentual") return `${abs.toFixed(1).replace(".", ",")} p.p. ${bom ? "abaixo" : "acima"} da meta`;
  const v = l.indicador.formato === "inteiro" ? Math.round(abs).toLocaleString("pt-BR") : formatarMarcoAbreviado(abs, l.indicador.formato);
  const rel = (Math.abs(l.relativa) * 100).toFixed(1).replace(".", ",");
  return `${bom ? "+" : "−"} ${v} (${bom ? "+" : "−"}${rel}%)`;
}
