/** Tipos do dado compartilhado em `avaliacao-tags.js`. */

export type TagAvaliacao = {
  id: string;
  label: string;
  /** Nome do componente em `lucide-react`. Quem renderiza faz o mapa — o `shared/` não importa UI. */
  icone: string;
  /** Família de cor do Tailwind: amber | emerald | blue | zinc | red | slate. */
  cor: string;
  descricao: string;
};

export type AlvoAvaliacao = "analise" | "composicao" | "criativo";
/** `1` positivo, `-1` negativo, `null` sem voto. Não há terceiro estado guardado. */
export type Voto = 1 | -1 | null;

export declare const TAGS_AVALIACAO: TagAvaliacao[];
export declare const TAG_IDS: string[];
export declare const ALVOS: AlvoAvaliacao[];
export declare function getTag(id: string | null | undefined): TagAvaliacao | null;
export declare function tagValida(id: string | null | undefined): boolean;
export declare function alvoValido(tipo: string | null | undefined): boolean;
export declare function normalizarVoto(v: unknown): Voto;
