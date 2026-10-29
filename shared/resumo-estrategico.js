/**
 * Resumo Estratégico — o documento que todo cliente tem na Central de Copy do ClickUp (desde
 * 26/10/2026), obrigatório em toda composição e escolhido por padrão no Composer.
 * DADO COMPARTILHADO entre o frontend e o worker.
 *
 * Em `shared/` pelo mesmo motivo de `estudo-copy.js`: a tela marca o Resumo sozinha e exige um
 * para compor, e o worker confere de novo — os dois pela MESMA regra de nome. E pelo NOME, não
 * pelo `tipo` do sync, pelo mesmo motivo de lá: o nome vale na hora, para todas as páginas.
 */

/** minúsculas, sem acento, espaços colapsados — a régua de `estudo-copy.js`. */
const normaliza = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * "Resumo Estratégico", "Resumo Estratégico – Dr. Fulano", "1. Resumo Estratégico" e variações:
 * a numeração na frente é como as subpáginas aparecem no ClickUp.
 */
export function ehResumoEstrategico(nome) {
  const n = normaliza(nome).replace(/^\d+\s*[.)\-–—:]?\s*/, "");
  return /^resumo\s+estrategico\b/.test(n);
}

/**
 * A página é (parte de) um Resumo Estratégico? Pelo título dela ou pelo de qualquer página acima
 * dela (`caminho`): subpágina de Resumo é Resumo, como no Estudo de Copy. O nome do Doc NÃO entra,
 * ao contrário do Estudo: o Resumo é uma página dentro da Central de Copy, um Doc com todos os
 * clientes, e não um Doc próprio.
 */
export function ehPaginaDeResumo({ nome, caminho = [] } = {}) {
  return [nome, ...(Array.isArray(caminho) ? caminho : [])].some(ehResumoEstrategico);
}

/**
 * A página de CIMA de um Resumo: a que é Resumo pelo próprio título, sem outra página de Resumo
 * acima dela. É ela que se escolhe — escolher a página traz as subpáginas junto.
 */
export function ehTopoDoResumo({ nome, caminho = [] } = {}) {
  return ehResumoEstrategico(nome) && !(Array.isArray(caminho) ? caminho : []).some(ehResumoEstrategico);
}
