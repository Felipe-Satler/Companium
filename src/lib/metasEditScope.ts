import { format, startOfMonth } from "date-fns";

/**
 * Escopos de EDIÇÃO das metas da Captação (página Metas › aba Captação), concedidos por
 * usuário na Administração ("Edição Metas"). Cada flag libera um intervalo de meses:
 *   - past    → meses ANTERIORES ao atual
 *   - present → o mês ATUAL
 *   - future  → meses POSTERIORES ao atual
 * Substitui a antiga regra fixa (só o Bernardo Leme editava o passado).
 */
export type MetasEditScope = {
  past: boolean;
  present: boolean;
  future: boolean;
};

/** Mês corrente no formato 'AAAA-MM' (base da classificação passado/presente/futuro). */
export function mesAtualStr(now: Date = new Date()): string {
  return format(startOfMonth(now), "yyyy-MM");
}

/**
 * Diz se o mês-alvo ('AAAA-MM') pode ser editado segundo os escopos concedidos.
 * Comparação lexicográfica funciona porque o formato 'AAAA-MM' é ordenável.
 */
export function podeEditarMes(mesAlvo: string, mesAtual: string, scope: MetasEditScope): boolean {
  if (mesAlvo < mesAtual) return scope.past;
  if (mesAlvo > mesAtual) return scope.future;
  return scope.present;
}
