/** Tipos do dado compartilhado em `relatorio-metricas.js`. */

export type DirecaoMetrica = "higher" | "lower" | "neutral";

export type MetricaRelatorio = {
  id: string;
  label: string;
  unidade: "contagem" | "moeda" | "ratio";
  /** higher = maior é melhor; lower = menor é melhor (CPL); neutral = não se julga (investimento). */
  direcao: DirecaoMetrica;
  /** Chave em `META_FIELDS` (src/hooks/useClientesMetas.ts), quando a métrica tem meta cadastrável. */
  metaKey?: string;
  grupo: string;
};

export type JanelaComparavel = {
  de: string;
  ate: string;
  dias: number;
  /**
   * De onde a janela saiu.
   *
   * `janelaComparavel()` só devolve as duas primeiras — elas são a REGRA, e é contra elas que o
   * worker confere a conta que a tela mandou. `manual` é o que a tela escreve quando alguém
   * escolheu o período de comparação à mão na aba Relatório: aí não há regra a conferir, e o
   * worker registra a divergência como aviso em vez de corrigir os números.
   */
  regra: "mes_anterior" | "janela_igual" | "manual";
  motivo: string;
  /** false = as janelas têm durações diferentes; só taxa e razão podem ser comparadas. */
  comparavel: boolean;
};

export declare const METRICAS_RELATORIO: MetricaRelatorio[];
export declare const METRICA_IDS: string[];
export declare const GRUPOS_RELATORIO: string[];
export declare function getMetrica(id: string): MetricaRelatorio | null;
export declare function diasNoPeriodo(de: string, ate: string): number | null;
/** Devolve `null` para entrada ausente, inválida ou com período invertido. */
export declare function janelaComparavel(p?: {
  de?: string;
  ate?: string;
  kind?: string;
}): JanelaComparavel | null;
