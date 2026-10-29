/** Tipos do dado compartilhado em `clickup-doc-tipos.js`. */

export type TipoDoc = {
  id: string;
  label: string;
  padrao: RegExp;
  /** true = pode ser oferecido como insumo do Ad Composer. */
  composer: boolean;
};

export declare const TIPOS_DOC: TipoDoc[];
/** Tipo de quem não casa com rótulo conhecido. Liberado — só não ganha chip na tela. */
export declare const TIPO_OUTRO: string;
/** Nome que indica credencial ("Acessos", "Materiais e Acessos", "Acesso Meta Ads ..."). */
export declare function bloqueadoPorSeguranca(nome: string | null | undefined): boolean;
export declare const MAX_DOCS_COMPOSER_CHARS: number;
export declare function normalizarNomeDoc(nome: string | null | undefined): string;
/** Template da agência (formulário em branco): nunca é material de cliente. */
export declare function ehTemplate(nome: string | null | undefined): boolean;
/** `null` = BLOQUEADO (credencial ou template). Nome sem rótulo conhecido devolve `TIPO_OUTRO`. */
export declare function classificarDoc(nome: string | null | undefined): string | null;
export declare function tipoDoc(id: string | null | undefined): TipoDoc | null;
export declare function podeIngerirConteudo(nome: string | null | undefined): boolean;
export declare function serveAoComposer(tipoId: string | null | undefined): boolean;
