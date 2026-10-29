import type { BIMes } from "@/components/gestao/useGestaoBI";
import type { IndicadorMarco } from "@/lib/marcosMetas";

export type FormatoMarco = "moeda" | "inteiro" | "percentual";

export type DefinicaoMarco = {
  chave: IndicadorMarco;
  nome: string;
  /** Contração usada no título do painel: "do" ou "dos". */
  artigo?: "do" | "dos";
  formato: FormatoMarco;
  menorMelhor?: boolean;
  /** Fluxo mensal que soma no período (true) ou estoque/média (false). */
  acumula: boolean;
  realizado: (mes: BIMes) => number;
};

export type GrupoMarco = {
  nome: string;
  descricao: string;
  indicadores: DefinicaoMarco[];
};

export const GRUPOS_MARCOS: GrupoMarco[] = [
  {
    nome: "Base",
    descricao: "Saúde e dimensão da carteira",
    indicadores: [
      { chave: "mrr", acumula: false, nome: "MRR", formato: "moeda", realizado: (mes) => mes.mrr },
      { chave: "ativos", acumula: false, nome: "Clientes Ativos", artigo: "dos", formato: "inteiro", realizado: (mes) => mes.ativos },
    ],
  },
  {
    nome: "Ganho",
    descricao: "Crescimento no período",
    indicadores: [
      { chave: "nmrr", acumula: true, nome: "nMRR", formato: "moeda", realizado: (mes) => mes.nmrr },
      { chave: "novos", acumula: true, nome: "Novos Clientes", artigo: "dos", formato: "inteiro", realizado: (mes) => mes.novos },
      { chave: "nmrrTicket", acumula: false, nome: "nMRR Ticket Médio", formato: "moeda", realizado: (mes) => mes.nmrrTicket },
    ],
  },
  {
    nome: "Perda",
    descricao: "Retenção de receita",
    indicadores: [
      { chave: "revChurn", acumula: false, nome: "RevChurn", formato: "percentual", menorMelhor: true, realizado: (mes) => mes.churnFin },
    ],
  },
];

export const INDICADORES_MARCOS = GRUPOS_MARCOS.flatMap((grupo) => grupo.indicadores);

/** Percentual exibido na grade e na faixa, sem divisão por meta vazia/zero. */
export function atingimentoMarco(real: number, meta: number | undefined): number | null {
  return meta !== undefined && meta !== 0 ? (real / meta) * 100 : null;
}

export function formatarMarco(valor: number, formato: FormatoMarco) {
  if (formato === "moeda") return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
  if (formato === "percentual") return `${valor.toFixed(2).replace(".", ",")}%`;
  return valor.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

export function formatarMarcoAbreviado(valor: number, formato: FormatoMarco) {
  if (formato === "moeda") {
    if (Math.abs(valor) >= 1_000_000) return `R$ ${(valor / 1_000_000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mi`;
    if (Math.abs(valor) >= 1_000) return `R$ ${(valor / 1_000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mil`;
    return `R$ ${valor.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
  }
  if (formato === "percentual") return `${valor.toFixed(2).replace(".", ",")}%`;
  return valor.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}