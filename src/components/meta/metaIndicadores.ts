export type MetaIndicadorKey =
  | "agendamentos"
  | "investimento"
  | "leads"
  | "cpl"
  | "leads_inbound"
  | "reunioes"
  | "vendas"
  | "novo_mrr";

// "total"/"inbound" são as linhas com indicador de Atingimento; "meta"/"google" são o
// detalhamento (só valores) do Inbound por canal — conceitualmente "Inbound Meta" e
// "Inbound Google", exibidos apenas como "Meta" e "Google".
export type MetaVariante = "total" | "inbound" | "meta" | "google";

export type MetaIndicador = {
  key: MetaIndicadorKey;
  label: string;
  tipo: "moeda" | "numero";
  /** Linhas principais (Total/Inbound) — cada uma com barra de Atingimento. */
  variantes?: MetaVariante[];
  /** Detalhamento do Inbound por canal (Meta/Google) — só valores, sem Atingimento. */
  subvariantes?: MetaVariante[];
};

export const VARIANTES: MetaVariante[] = ["total", "inbound"];
/** Canais que detalham o Inbound. Exibidos como "Meta" e "Google". */
export const SUBVARIANTES: MetaVariante[] = ["meta", "google"];

export const varianteLabel = (v: MetaVariante) =>
  v === "total" ? "Total" : v === "inbound" ? "Inbound" : v === "meta" ? "Meta" : "Google";

/** Ordem de renderização de todas as linhas de um indicador (ou [undefined] p/ simples). */
export const variantesDe = (ind: MetaIndicador): (MetaVariante | undefined)[] => {
  const vs = [...(ind.variantes ?? []), ...(ind.subvariantes ?? [])];
  return vs.length ? vs : [undefined];
};

export const INDICADORES: MetaIndicador[] = [
  { key: "investimento", label: "Investimento", tipo: "moeda" },
  // "Leads Inbound" é, por definição, o número de inbound (o total fica no card "Leads").
  // Ganha só o detalhamento por canal: Inbound → Meta / Google.
  {
    key: "leads_inbound",
    label: "Leads Inbound",
    tipo: "numero",
    variantes: ["inbound"],
    subvariantes: SUBVARIANTES,
  },
  { key: "cpl", label: "CPL", tipo: "moeda" },
  { key: "leads", label: "Leads", tipo: "numero" },
  { key: "agendamentos", label: "Agendamentos", tipo: "numero", variantes: VARIANTES, subvariantes: SUBVARIANTES },
  { key: "reunioes", label: "Reuniões", tipo: "numero", variantes: VARIANTES, subvariantes: SUBVARIANTES },
  { key: "vendas", label: "Vendas", tipo: "numero", variantes: VARIANTES, subvariantes: SUBVARIANTES },
  { key: "novo_mrr", label: "nMRR", tipo: "moeda", variantes: VARIANTES, subvariantes: SUBVARIANTES },
];

/** Nome da coluna/campo no registro do mês. */
export const campoDe = (key: MetaIndicadorKey, tipo: "plan" | "real", variante?: MetaVariante) => {
  // Compat: o card "Leads Inbound" sempre guardou seu valor único (o inbound) sem sufixo de
  // variante. Mantemos essa coluna como a linha "Inbound" p/ não perder o histórico.
  if (key === "leads_inbound" && variante === "inbound") return `leads_inbound_${tipo}`;
  return variante ? `${key}_${variante}_${tipo}` : `${key}_${tipo}`;
};

/** Chave única de série (para totais, gráficos e formulários). */
export const serieKey = (key: MetaIndicadorKey, variante?: MetaVariante) =>
  variante ? `${key}:${variante}` : key;

export type MetaSerie = {
  id: string;
  key: MetaIndicadorKey;
  variante?: MetaVariante;
  label: string;
  tipo: MetaIndicador["tipo"];
};

/** Todas as séries existentes (indicadores simples + variantes + detalhamento por canal). */
export const SERIES: MetaSerie[] = INDICADORES.flatMap((ind) => {
  const todas = [...(ind.variantes ?? []), ...(ind.subvariantes ?? [])];
  return todas.length
    ? todas.map((v) => ({
        id: serieKey(ind.key, v),
        key: ind.key,
        variante: v,
        label: `${ind.label} (${varianteLabel(v)})`,
        tipo: ind.tipo,
      }))
    : [{ id: serieKey(ind.key), key: ind.key, label: ind.label, tipo: ind.tipo }];
});

export const fmtValor = (v: number, tipo: MetaIndicador["tipo"]) =>
  tipo === "moeda"
    ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })
    : v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

export const fmtPct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

/** Verde a partir de 100%, âmbar de 80% a 99%, vermelho abaixo. */
export const corAtingimento = (pct: number) =>
  pct >= 100 ? "text-primary" : pct >= 80 ? "text-amber-500" : "text-destructive";
