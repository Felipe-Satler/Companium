/** Tipos do dado compartilhado em `estudo-copy.js`. */

export type NivelEstudo = "inconsciente" | "consciente_problema" | "consciente_solucao" | "consciente_produto" | "";

export type IdentificacaoEstudo = {
  nome: string | null;
  crm: string | null;
  /** null quando o Estudo diz que não há ("Não possui"). */
  rqe: string | null;
  /** O que estava escrito no campo RQE, inclusive "Não possui (...)". */
  rqe_texto: string | null;
};

export type AvatarEstudo = {
  /** "A1", "A2"…: estável, pelo número do avatar no Estudo. */
  id: string;
  n: number;
  nome: string;
  nivel: NivelEstudo;
  /** O rótulo do Estudo ("Consciente do Mecanismo (Nível 4)"). */
  nivel_original: string;
  perfil: string;
  dor: string;
  /** O nível foi inferido pelo agente: o Estudo não o dizia (só em Estudo fora do modelo padrão). */
  nivel_inferido?: boolean;
};

export type EstudoLido = {
  identificacao: IdentificacaoEstudo;
  avatares: AvatarEstudo[];
  secoes: string[];
  /** Seções essenciais ausentes, com o nome que a tela mostra. */
  faltando: string[];
};

export declare function ehEstudoDeCopy(nome: string | null | undefined): boolean;
export declare function ehPaginaDeEstudo(p: {
  nome: string | null | undefined;
  docNome?: string | null;
  caminho?: string[] | null;
}): boolean;
export declare function nivelDoEstudo(texto: string | null | undefined): NivelEstudo;
export declare function lerEstudoDeCopy(md: string | null | undefined): EstudoLido;
export declare function partesDoEstudo(md: string | null | undefined): { titulo: string | null; texto: string }[];
export declare function estudoPriorizado(md: string | null | undefined, max: number): string;
export declare function assinaturaDoEstudo(identificacao: Partial<IdentificacaoEstudo> | null | undefined): string;
