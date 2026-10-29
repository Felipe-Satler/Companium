const MESES_ABREV = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "2026-08" -> "ago/26" */
export const mesLabel = (ym: string) => {
  const [y = "", m = "1"] = ym.split("-");
  return `${MESES_ABREV[Number(m) - 1] ?? m}/${y.slice(2)}`;
};

/** Mês atual no formato AAAA-MM. */
export const mesAtual = () => new Date().toISOString().slice(0, 7);
