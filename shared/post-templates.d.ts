/** Tipos de `post-templates.js` e do post renderizável. */

import type { ElementoDaArteId } from "./brand-kit";
import type { UsoDaArte } from "./regras-identificacao";
import type { FundoDoPost } from "./fundos";

export type Proporcao = "4:5" | "1:1" | "9:16";
export type PapelDoSlide = "unico" | "capa" | "conteudo" | "cta";
export type SlotId = "titulo" | "apoio" | "destaque" | "cta";

export type Slot = { id: SlotId; label: string; limite: number; obrigatorio?: boolean; ajuda: string };

export type Layout = { label: string; aceitaFoto: boolean; slots: Slot[] };

export type TemplateDeArte = {
  id: string;
  versao: string;
  label: string;
  resumo: string;
  proporcoes: Proporcao[];
  layouts: Record<PapelDoSlide, Layout>;
};

export type SlideDoPost = {
  papel: PapelDoSlide;
  titulo?: string;
  apoio?: string;
  destaque?: string;
  cta?: string;
  /** Índice em `fotos` da arte, ou null. */
  foto: number | null;
  alt: string;
};

export type IdentificacaoDoPost = {
  nome: string;
  crm: string;
  uf: string;
  rqe: string;
  /** A linha pronta: "Dr. Fulano | CRM/RS 12345 | RQE 678". */
  linha: string;
  naArte: boolean;
  naLegenda: boolean;
  naoEspecialista: boolean;
};

export type PostRenderizavel = {
  schema: "post_renderizavel@1";
  template: { id: string; versao: string };
  proporcao: Proporcao;
  slides: SlideDoPost[];
  legenda: string;
  hashtags: string[];
  identificacao: IdentificacaoDoPost;
  elementos: Partial<Record<ElementoDaArteId, boolean>>;
  uso: UsoDaArte;
  circula_fora: boolean;
  /** Fundo abstrato desenhado pelo template (`shared/fundos.js`). Ausente ou null = liso. */
  fundo?: FundoDoPost | null;
};

export type AvisoDoPost = { slide: number | null; campo: string; tipo: string; detalhe: string };

export const SCHEMA_DO_POST: "post_renderizavel@1";
export const PROPORCOES: Record<Proporcao, { largura: number; altura: number; label: string }>;
export const MAX_SLIDES: number;
export const PAPEIS: PapelDoSlide[];
export const TEMPLATES: TemplateDeArte[];
export const TEMPLATE_PADRAO: string;
export function getTemplate(id: string): TemplateDeArte | null;
export function papeisPermitidos(i: number, total: number): PapelDoSlide[];
export function normalizarSlides(slides: unknown, template: TemplateDeArte, opcoes?: { fotos?: number }): SlideDoPost[];
export function validarSlides(slides: SlideDoPost[], template: TemplateDeArte): AvisoDoPost[];
export function textosDaArte(slides: SlideDoPost[]): string[];
export function nomeDoArquivoDoSlide(base: string, indice: number, extensao?: string): string;
