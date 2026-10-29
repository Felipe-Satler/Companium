/** Tipos do dado compartilhado em `relatorio-canais.js`. */

export type CanalCriativo = {
  id: string;
  label: string;
  /** false = registrado mas sem fonte de dados (Google Ads, Instagram orgânico). */
  disponivel: boolean;
  fonte: string | null;
  resumo: string;
};

export declare const CANAIS_CRIATIVO: CanalCriativo[];
export declare const CANAL_IDS: string[];
export declare const MAX_CRIATIVOS_RELATORIO: number;
export declare function getCanal(id: string): CanalCriativo | null;
export declare function canaisDisponiveis(): CanalCriativo[];
