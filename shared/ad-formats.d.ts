/** Tipos do dado compartilhado em `ad-formats.js`. */

export type CampoFormato = {
  id: string;
  label: string;
  tipo: "texto" | "lista";
  /** Limite de caracteres. Em `tipo: "lista"`, vale POR ITEM. */
  limite?: number;
  /** true = a plataforma rejeita acima disso; false = só corta na exibição. */
  limiteRigido?: boolean;
  itens?: { min: number; max: number };
  ajuda: string;
};

export type AdFormat = {
  id: string;
  label: string;
  midia: "video" | "imagem" | "texto";
  disponivel: boolean;
  resumo: string;
  campos: CampoFormato[];
};

export type AvisoLimite = {
  campo: string;
  /** Posição no item da lista, ou null quando o campo é texto. */
  indice: number | null;
  tipo: "excede_limite_rigido" | "excede_recomendado" | "itens_de_menos" | "itens_demais";
  detalhe: string;
};

export declare const AD_FORMATS: AdFormat[];
export declare const FORMATO_IDS: string[];
/** Quantos anúncios uma composição pode ter. */
export declare const MAX_ANUNCIOS: number;
export declare function getFormato(id: string): AdFormat | null;
export declare function formatosDisponiveis(): AdFormat[];
export declare function validarLimites(
  formatoId: string,
  composicao: Record<string, unknown> | null | undefined,
): AvisoLimite[];
