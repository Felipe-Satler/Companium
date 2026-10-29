// Projetos › Cronograma — modelo de dados + helpers de geometria da timeline.
//
// A tela é um "gantt" por cliente: linhas = marcos, colunas = meses. Cada card
// (bar) ocupa um intervalo de colunas [start, end] (posições float, onde 1 col =
// 30 dias). Cada card planejado tem um par "Real" ligado pelo mesmo `pairId`.
// Checkpoints são losangos posicionados por `pos` (float) numa "faixa" (lane).

export type RealStatus =
  | "para_fazer"
  | "em_andamento"
  | "descartado"
  | "paralisado"
  | "finalizado";

export type BarKind = "plan" | "real";

export interface Bar {
  label: string;
  start: number; // posição inicial (coluna, float)
  end: number; // posição final inclusiva (coluna, float)
  status: string; // status do planejado: 'concluido' | 'andamento' | 'planejado'
  pairId: string; // liga o card planejado ao seu par "Real"
  kind: BarKind;
  description?: string;
  realStatus?: RealStatus | "";
}

export interface Checkpoint {
  pos: number; // posição (coluna, float)
  lane: BarKind; // faixa: alinhado ao planejado ou ao real
}

export interface Row {
  marco: string;
  bars: Bar[];
  checkpoints: Array<number | Checkpoint>;
}

export interface Board {
  months: string[];
  rows: Row[];
}

export const DEFAULT_BOARD: Board = { months: [], rows: [] };

// ---- Tipos de card do diálogo "Adicionar card" ---------------------------
export const CARD_TYPES: Array<{ value: string; label: string }> = [
  { value: "concluido", label: "Card" },
  { value: "checkpoint", label: "Checkpoint" },
];

// Durações iniciais oferecidas (em dias) — 30 = 1 coluna, 45 = 1,5, 60 = 2.
export const DURATIONS = [30, 45, 60] as const;

// ---- Conversões dias <-> colunas -----------------------------------------
export const daysToSpan = (days: number) => days / 30;
export const spanToDays = (span: number) => Math.round(span * 30);

// Passo do "snap" ao arrastar (3 dias) e span mínimo de um card (6 dias).
export const SNAP = daysToSpan(3); // 0.1 coluna
export const MIN_SPAN = daysToSpan(6); // 0.2 coluna
export const snap = (value: number) => Math.round(value / SNAP) * SNAP;

// Limites de largura de coluna (px) ao arrastar a borda.
export const MIN_COL_WIDTH = 80;
export const MAX_COL_WIDTH = 600;

// Largura padrão de uma coluna conforme o rótulo (trimestre é mais largo).
export const defaultMonthWidth = (label: string) =>
  label.toLowerCase().includes("trimestre") ? 180 : 150;

// gera um pairId aleatório curto
export const randomPairId = () => Math.random().toString(36).slice(2, 10);

// Normaliza um checkpoint (retrocompat.: número puro => faixa 'plan').
export const normalizeCheckpoint = (cp: number | Checkpoint): Checkpoint =>
  typeof cp === "number" ? { pos: cp, lane: "plan" } : cp;

// ---- Geometria de colunas de largura variável ----------------------------
// Deslocamento em px até a posição `pos`, dado o array de larguras `widths`.
export const offsetPx = (pos: number, widths: number[]): number => {
  if (!widths.length) return 0;
  const clamped = Math.min(Math.max(pos, 0), widths.length);
  const whole = Math.min(Math.floor(clamped), widths.length - 1);
  let acc = 0;
  for (let i = 0; i < whole; i++) acc += widths[i] ?? 0;
  return acc + (clamped - whole) * (widths[whole] ?? 0);
};

// Inverso de offsetPx: converte px de volta em posição de coluna (float).
export const posFromPx = (px: number, widths: number[]): number => {
  let acc = 0;
  for (let i = 0; i < widths.length; i++) {
    const w = widths[i] ?? 0;
    if (px < acc + w) return i + (px - acc) / (w || 1);
    acc += w;
  }
  return widths.length;
};

export const sumWidths = (widths: number[]) =>
  widths.reduce((a, b) => a + b, 0);

// ---- Mapas de cor / rótulo -----------------------------------------------
// Cor do card PLANEJADO conforme status.
export const PLAN_STATUS_BG: Record<string, string> = {
  concluido: "bg-primary text-primary-foreground",
  andamento: "bg-[hsl(var(--chart-line-forecast))] text-primary-foreground",
  planejado: "bg-muted text-muted-foreground",
};

// Cor (fundo) do status do card REAL — também usada nas bolinhas da legenda.
export const REAL_STATUS_BG: Record<RealStatus, string> = {
  para_fazer: "bg-[hsl(24_6%_52%)] text-[hsl(0_0%_100%)]",
  em_andamento: "bg-[#3C6BA5] text-[hsl(0_0%_100%)]",
  descartado: "bg-[hsl(0_0%_8%)] text-[hsl(0_0%_100%)]",
  paralisado: "bg-[hsl(0_0%_8%)] text-[hsl(0_0%_100%)]",
  finalizado: "bg-[#299764] text-[hsl(0_0%_100%)]",
};

export const REAL_STATUS_LABEL: Record<RealStatus, string> = {
  para_fazer: "Para fazer",
  em_andamento: "Em andamento",
  descartado: "Descartado",
  paralisado: "Paralisado",
  finalizado: "Finalizado",
};

export const REAL_STATUS_BORDER: Record<RealStatus, string> = {
  para_fazer: "border-[hsl(24_6%_52%)]",
  em_andamento: "border-[#3C6BA5]",
  descartado: "border-neutral-800",
  paralisado: "border-[hsl(340_70%_35%)]",
  finalizado: "border-[#299764]",
};

export const REAL_STATUS_KEYS = Object.keys(REAL_STATUS_LABEL) as RealStatus[];
