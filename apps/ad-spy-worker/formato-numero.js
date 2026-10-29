/**
 * Formatação de número para os prompts dos agentes — UM lugar, uma convenção.
 *
 * A regra que não pode divergir: **ausente é travessão, nunca zero.** "Não temos o dado" e "deu
 * zero" contam histórias opostas sobre um cliente, e um agente que recebe `0` no lugar de `—` afirma
 * com confiança que o cliente parou. Enquanto cada prompt tinha a sua cópia dessas funções, a regra
 * dependia de três pessoas lembrarem dela no mesmo dia.
 */

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 2,
});
const NUM = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

/** Dinheiro. `null`/`undefined`/NaN viram `—`. */
export function money(v) {
  return Number.isFinite(v) ? BRL.format(v) : "—";
}

/** Contagem. `null`/`undefined`/NaN viram `—`. */
export function count(v) {
  return Number.isFinite(v) ? NUM.format(v) : "—";
}

/** Razão (ROAS), com vírgula decimal e sufixo `x`. */
export function ratio(v) {
  return Number.isFinite(v) ? `${v.toFixed(2).replace(".", ",")}x` : "—";
}

/** Percentual com sinal — para variação entre períodos. */
export function pctSinal(v) {
  if (!Number.isFinite(v)) return "—";
  const s = v > 0 ? "+" : "";
  return `${s}${v.toFixed(1).replace(".", ",")}%`;
}

/** Percentual simples — para atingimento de meta. */
export function pct(v) {
  return Number.isFinite(v) ? `${v.toFixed(0)}%` : "—";
}

/** O valor na unidade que a métrica declara (`shared/relatorio-metricas.js`). */
export function porUnidade(v, unidade) {
  if (unidade === "moeda") return money(v);
  if (unidade === "ratio") return ratio(v);
  return count(v);
}
