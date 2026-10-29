/** Tipos de `arte-prompt.js` — para o stub de desenvolvimento (ad-spy-dev-stub.ts), que é TS estrito. */

import type { AvisoDoPost, PostRenderizavel, SlideDoPost } from "../../shared/post-templates";

export const FORMATOS_DE_ARTE: string[];
export const MAX_FOTOS: number;
export const TIPOS_DE_FOTO: { id: string; label: string }[];
export function kitTemElemento(kit: unknown, id: string): boolean;
export function anunciosDaLinha(composicao: unknown): Record<string, unknown>[];
export function hashDoAnuncio(anuncio: unknown): string;
export function totalDeSlides(anuncio: unknown): number;
export function legendaDoAnuncio(anuncio: unknown): string;
export function descreverTemplate(template: unknown): string;
export function esqueletoJsonArte(): string;
export function buildArtePrompt(p: Record<string, unknown>): string;
export function parseArteReply(
  texto: string,
  opcoes: { template: unknown; total: number; fotos?: number }
): { slides: SlideDoPost[]; legenda: string; hashtags: string[]; identificacao: Record<string, string> | null; semJson: boolean };
export function aplicarRegrasDoPost(
  post: Record<string, unknown>,
  template: unknown,
  kitIdentificacao: unknown
): { post: PostRenderizavel; avisos: AvisoDoPost[] };
export function montarPost(p: {
  lido: unknown;
  anuncio: unknown;
  template: unknown;
  proporcao?: string;
  opcoes: unknown;
  kitIdentificacao: unknown;
  onde: { naArte: boolean; naLegenda: boolean };
}): { post: PostRenderizavel; avisos: AvisoDoPost[] };
export function normalizarOpcoes(
  bruto: unknown,
  ctx: { kit: unknown; cliente: string; formato: string }
): {
  opcoes: {
    uso: "organico" | "pago";
    circula_fora: boolean;
    onde_identificar: "arte" | "legenda" | "nenhum";
    elementos: Record<string, boolean>;
    fotos: { caminho: string; tipo: string; descricao: string }[];
  };
  erros: string[];
};
