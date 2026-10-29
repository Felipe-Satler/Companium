/**
 * A estrutura de um criativo dissecado, no formato feito para AGENTES DE IA — DADO COMPARTILHADO
 * entre o frontend e o worker.
 *
 * Mora fora de `src/` pelo mesmo motivo de `shared/ad-formats.js`: o Composer (worker) manda este
 * texto ao agente e a tela de Análises de Criativos o mostra, na seção recolhida "Estrutura para
 * agentes de IA". Uma função só garante que quem lê a tela vê EXATAMENTE o que o agente recebe.
 *
 * ## Por que não leva o frase a frase
 *
 * O frase a frase traz as palavras do concorrente. Com elas no prompt, o caminho mais curto para o
 * agente que compõe é parafrasear — e o anúncio novo sai parecido com o original. Aqui vão só os
 * blocos, os movimentos e o `como_funciona` de cada um, que o spyagent escreve sem produto, marca
 * ou trecho literal da peça (ver agent/spyagent.md › "Modo dissecação de criativo", regra D7). É
 * uma receita: o agente preenche cada passo com o produto do cliente.
 */

const NIVEL = {
  inconsciente: "inconsciente do problema",
  consciente_problema: "consciente do problema",
  consciente_solucao: "consciente da solução",
  consciente_produto: "consciente do produto",
};

const linhaMovimento = (m, rotulo) =>
  `${rotulo} ${m.nome}${m.como_funciona ? ` — ${m.como_funciona}` : ""}`;

/**
 * O texto para agentes, ou "" quando a dissecação não tem estrutura (as da versão 1, de antes de
 * 20/10/2026, ou uma resposta sem blocos nem movimentos).
 */
export function estruturaParaAgentes(d) {
  if (!d || typeof d !== "object") return "";
  const blocos = Array.isArray(d.blocos) ? d.blocos : [];
  const movimentos = Array.isArray(d.movimentos) ? d.movimentos : [];
  if (!blocos.length && !movimentos.length) return "";

  const linhas = [
    "Estrutura de persuasão para modelar (feita para agentes de IA).",
    "Siga os blocos e os movimentos na ordem. Faça cada movimento como o \"como funciona\" descreve, " +
      "com o produto, o público e as palavras do anúncio NOVO: esta estrutura não traz, de propósito, " +
      "as palavras, o produto nem a história da peça original.",
  ];
  if (NIVEL[d.nivel_consciencia]) linhas.push("", `Nível de consciência do público: ${NIVEL[d.nivel_consciencia]}.`);
  linhas.push("");

  // Com as ligações válidas, cada movimento sabe o seu bloco: a receita sai aninhada. Sem elas, os
  // blocos e os movimentos vão como duas listas — a ordem continua valendo, o agrupamento não.
  const ligado = d.ligacoes !== false && movimentos.length > 0 && movimentos.every((m) => m.bloco != null);
  if (ligado && blocos.length) {
    blocos.forEach((b, i) => {
      linhas.push(`${i + 1}. ${b.nome}`);
      movimentos
        .filter((m) => m.bloco === b.n)
        .forEach((m, j) => linhas.push(linhaMovimento(m, `   ${i + 1}.${j + 1}`)));
    });
  } else {
    if (blocos.length) {
      linhas.push("Blocos, na ordem:");
      blocos.forEach((b, i) => linhas.push(`${i + 1}. ${b.nome}`));
      linhas.push("");
    }
    if (movimentos.length) {
      linhas.push("Movimentos, na ordem:");
      movimentos.forEach((m, i) => linhas.push(linhaMovimento(m, `${i + 1}.`)));
    }
  }
  return linhas.join("\n").trim();
}
