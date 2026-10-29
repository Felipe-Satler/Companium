/** Tipos do dado compartilhado em `brand-kit.js`. */

import type { Paleta } from "./paleta";

export type FonteDoKit = { id: string; categoria: "sem serifa" | "serifa" };

export type ImagemDoKitId = "logo" | "logo_escuro" | "foto_medico";

export type ElementoDaArteId =
  | "logo"
  | "nome_clinica"
  | "foto_medico"
  | "identificacao"
  | "whatsapp"
  | "telefone"
  | "instagram"
  | "site"
  | "email"
  | "endereco";

export type Endereco = { rotulo: string; linha: string };

export type IdentificacaoDoKit = {
  nome: string;
  /** Só números. */
  crm: string;
  uf: string;
  /** "" quando o médico não tem RQE. */
  rqe: string;
  /** A pós-graduação divulgada, quando não há RQE. É o que liga a regra do "NÃO ESPECIALISTA". */
  pos_graduacao: string;
};

export type BrandKit = {
  cliente: string;
  nome_clinica: string;
  paleta: { [K in keyof Paleta]: string | null };
  fontes: { titulo: string; texto: string };
  contatos: { whatsapp: string; telefone: string; instagram: string; site: string; email: string };
  enderecos: Endereco[];
  identificacao: IdentificacaoDoKit;
  /** A bio do Instagram do cliente traz nome, CRM/UF, "MÉDICO" e RQE — conferido por alguém. */
  bio_conferida: boolean;
  /** Caminhos no bucket, gravados pelo worker no upload. */
  imagens: Record<ImagemDoKitId, string | null>;
};

export const FONTES: FonteDoKit[];
export const FONTE_PADRAO: string;
export const IMAGENS_DO_KIT: { id: ImagemDoKitId; label: string; ajuda: string }[];
export const IMAGEM_IDS: ImagemDoKitId[];
export const MIMES_DE_IMAGEM: string[];
export const MAX_BYTES_IMAGEM: number;
export const UFS: string[];
export const MAX_ENDERECOS: number;
export const ELEMENTOS_DA_ARTE: { id: ElementoDaArteId; label: string }[];

export type TipoDeFotoId = "medico" | "procedimento" | "estrutura" | "equipe" | "outro";
export const TIPOS_DE_FOTO: { id: TipoDeFotoId; label: string }[];
export function kitTemElemento(kit: Partial<BrandKit> | null | undefined, id: ElementoDaArteId): boolean;

export function kitVazio(cliente?: string): BrandKit;
export function normalizarInstagram(v: unknown): string;
export function normalizarBrandKit(bruto: unknown): {
  kit: BrandKit;
  erros: { campo: string; detalhe: string }[];
};
export function linhaDeIdentificacao(
  identificacao: Partial<IdentificacaoDoKit> | null | undefined,
  opcoes?: { naoEspecialista?: boolean }
): string;
export function temIdentificacao(kit: Partial<BrandKit> | null | undefined): boolean;
