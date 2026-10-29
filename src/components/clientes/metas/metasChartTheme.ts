import { GoalStatus } from "@/utils/metasStatus";

/**
 * Paleta dos três grupos, compartilhada pela pizza, pelas barras e pela legenda — as três
 * peças precisam falar a mesma língua de cor. Espelha o texto dos cards do CRM:
 * verde = dentro da meta, vermelho = fora, âmbar = sem meta cadastrada.
 */
export const STATUS_COLOR: Record<GoalStatus, string> = {
  ok: "hsl(152, 60%, 45%)",
  off: "hsl(0, 72%, 51%)",
  none: "hsl(43, 90%, 55%)",
};

export const STATUS_LABEL: Record<GoalStatus, string> = {
  ok: "Dentro da meta",
  off: "Fora da meta",
  none: "Sem meta definida",
};

export const STATUS_ORDER: GoalStatus[] = ["ok", "off", "none"];
