/** Tipos de `regras-identificacao.js`. */

export type Exigencia = "obrigatoria_na_arte" | "arte_ou_legenda" | "opcional";
export type UsoDaArte = "organico" | "pago";
export type OndeIdentificar = "arte" | "legenda" | "nenhum";

export const EXIGENCIAS: {
  OBRIGATORIA_NA_ARTE: "obrigatoria_na_arte";
  ARTE_OU_LEGENDA: "arte_ou_legenda";
  OPCIONAL: "opcional";
};
export const USOS: UsoDaArte[];
export const ONDE_IDENTIFICAR: OndeIdentificar[];

export function exigenciaDeIdentificacao(contexto: {
  uso: UsoDaArte;
  circulaFora?: boolean;
  bioConferida?: boolean;
  midia?: "imagem" | "video";
}): { exigencia: Exigencia; motivo: string };

export function ondeIdentificar(
  exigencia: Exigencia,
  escolha: OndeIdentificar
): { naArte: boolean; naLegenda: boolean; erro: string | null };

export function escolhasPermitidas(exigencia: Exigencia): OndeIdentificar[];
export function citaPosGraduacao(texto: string, posGraduacao?: string): boolean;
export function precisaNaoEspecialista(
  identificacao: { rqe?: string; pos_graduacao?: string } | null | undefined,
  textos?: { arte?: string[]; legenda?: string }
): { naArte: boolean; naLegenda: boolean };
export function temNaoEspecialista(texto: string): boolean;
