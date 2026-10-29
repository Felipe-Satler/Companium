/** Tipos do gerador de paleta em `paleta.js`. */

export type PapelDaPaleta = "primaria" | "secundaria" | "terciaria";

export type Paleta = { primaria: string; secundaria: string; terciaria: string };

export type PaletaGerada = Paleta & { harmonia: string };

export type AvisoDePaleta = { par: string; contraste: number; detalhe: string };

export const PAPEIS_DA_PALETA: PapelDaPaleta[];
export const CONTRASTE_MINIMO: number;
export const TEXTO_CLARO: string;
export const TEXTO_ESCURO: string;

export function normalizarHex(valor: unknown): string | null;
export function hexParaOklch(hex: string): { l: number; c: number; h: number } | null;
export function rgbParaOklch(rgb: number[]): { l: number; c: number; h: number };
export function oklchParaHex(cor: { l: number; c: number; h: number }): string;
export function contraste(a: string, b: string): number | null;
export function textoSobre(fundo: string): string;
export function avisosDaPaleta(paleta: Partial<Paleta> | null | undefined): AvisoDePaleta[];
export function gerarPaleta(opcoes?: {
  travadas?: Partial<Record<PapelDaPaleta, string | null>>;
  aleatorio?: () => number;
}): PaletaGerada;
