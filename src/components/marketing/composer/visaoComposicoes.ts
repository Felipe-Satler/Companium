/**
 * Qual visão das composições salvas abrir. **Puro**, para a regra ter teste.
 *
 * A regra tem uma assimetria que vale escrever: **a lista é o padrão do site e a grade é a exceção**.
 * O armazenamento guarda a exceção, não a preferência — `cards` só vence quando foi escolhido de
 * propósito, e qualquer outra coisa (nada guardado, valor de uma versão anterior, leitura que lança
 * em janela anônima) cai na lista.
 *
 * Isto é uma função e não três linhas dentro do `useState` porque o padrão já se perdeu uma vez:
 * enquanto ele vivia só no `localStorage`, "lista é o padrão" valia para quem tinha clicado em lista
 * e para mais ninguém — quem abrisse em outro computador caía na grade. O teste existe para essa
 * regressão não voltar sem ninguém perceber.
 */

export type VisaoComposicoes = "cards" | "lista";

export const VISAO_KEY = "marketing-composicoes-visao";

export const VISAO_PADRAO: VisaoComposicoes = "lista";

/** O valor guardado -> a visão. Só `"cards"` desvia do padrão. */
export function visaoDoArmazenado(valor: string | null | undefined): VisaoComposicoes {
  return valor === "cards" ? "cards" : VISAO_PADRAO;
}

/**
 * Lê a preferência, tolerando um `localStorage` que não existe ou lança.
 *
 * Janela anônima, "block site data" e alguns contextos de preview fazem o próprio acessor lançar —
 * não é só devolver `null`. Falhar aqui não pode impedir a tela de abrir.
 */
export function lerVisao(): VisaoComposicoes {
  try {
    return visaoDoArmazenado(localStorage.getItem(VISAO_KEY));
  } catch {
    return VISAO_PADRAO;
  }
}

/** Guarda a escolha. Falha é silenciosa: preferência é conveniência, não pode bloquear a troca. */
export function guardarVisao(v: VisaoComposicoes) {
  try {
    localStorage.setItem(VISAO_KEY, v);
  } catch {
    /* sem armazenamento: a troca vale para esta sessão e pronto */
  }
}
