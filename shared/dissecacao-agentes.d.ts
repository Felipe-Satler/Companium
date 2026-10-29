/** Tipos do dado compartilhado em `dissecacao-agentes.js`. */

export declare function estruturaParaAgentes(
  d:
    | {
        blocos?: { n: number; nome: string }[];
        movimentos?: { n: number; nome: string; como_funciona: string; bloco: number | null }[];
        nivel_consciencia?: string;
        ligacoes?: boolean;
      }
    | null
    | undefined,
): string;
