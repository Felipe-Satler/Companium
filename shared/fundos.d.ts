/** Tipos de `fundos.js`. */

export type EstiloDeFundo = "liso" | "degrade" | "ondas" | "organico" | "geometrico";

export type FundoDoPost = {
  estilo: Exclude<EstiloDeFundo, "liso">;
  semente: number;
  granulado: boolean;
  versao: number;
};

export type GradienteDoFundo = {
  id: string;
  tipo: "linear" | "radial";
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  paradas: { offset: number; cor: string; opacidade?: number }[];
};

export type FormaDoFundo = {
  tipo: "rect" | "circle" | "path";
  cor: string;
  opacidade: number;
  d?: string;
  cx?: number;
  cy?: number;
  r?: number;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
};

export const VERSAO_DOS_FUNDOS: number;
export const ESTILOS_DE_FUNDO: { id: EstiloDeFundo; label: string }[];
export function normalizarFundo(bruto: unknown): FundoDoPost | null;
export function sortearFundo(
  estilo: EstiloDeFundo,
  opcoes?: { granulado?: boolean; aleatorio?: () => number }
): FundoDoPost | null;
export function misturar(fundo: string, cor: string, opacidade: number): string;
export function desenharFundo(
  fundo: FundoDoPost | null | undefined,
  ctx: { base: string; acento: string; largura: number; altura: number; indice?: number }
): { gradientes: GradienteDoFundo[]; formas: FormaDoFundo[]; granulado: boolean } | null;
