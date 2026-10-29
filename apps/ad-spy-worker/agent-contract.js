/**
 * O contrato de resposta dos agentes: prosa em Markdown + UM bloco ```json no fim.
 *
 * Mora sozinho, sem importar nada, por dois motivos:
 *
 *   1. É o único dialeto. A Mineração (`analyze.js`) e o resumo de clientes (`briefs-prompt.js`)
 *      leem a resposta do agente do MESMO jeito — duas cópias divergiriam na primeira correção.
 *   2. `analyze.js` importa o cliente do Gateway, que por sua vez importa `ws` de um caminho que
 *      só existe no servidor (`/usr/lib/node_modules/openclaw/...`). Qualquer teste que tocasse
 *      nele quebraria fora de produção. Aqui não há import nenhum, então dá para testar o parser
 *      em qualquer máquina.
 */

/**
 * Acha o bloco do contrato: o ÚLTIMO bloco cercado que parseia como objeto JSON.
 *
 * Devolve o span junto com o valor, para a remoção da prosa apagar EXATAMENTE o bloco que foi
 * parseado. Varrer de trás para frente importa porque o relatório pode legitimamente citar JSON
 * antes (um exemplo, um payload), e o agente é instruído a pôr o contrato por último.
 *
 * @returns {{ value: object, start: number, end: number } | null}
 */
export function locateContractFence(text) {
  if (!text) return null;
  // Corpo não-guloso, e a cerca de fechamento tem de começar uma linha — assim uma cerca não
  // engole as seguintes. `matchAll` dá cada bloco independente; a escolha é de trás para frente.
  const fences = [...text.matchAll(/```[ \t]*(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n?```/gi)];
  for (let i = fences.length - 1; i >= 0; i -= 1) {
    const m = fences[i];
    const body = m[1].trim();
    if (!body.startsWith("{")) continue;
    try {
      const value = JSON.parse(body);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return { value, start: m.index, end: m.index + m[0].length };
      }
    } catch {
      /* não é o bloco do contrato; tenta o de cima */
    }
  }
  return null;
}

/**
 * O bloco estruturado, ou null.
 *
 * Falha de parse NÃO é erro de propósito: a prosa continua inteira, então um bloco ruim degrada
 * para "resumo sem os painéis estruturados" em vez de derrubar a execução.
 */
export function extractContractJson(text) {
  return locateContractFence(text)?.value ?? null;
}

/**
 * A prosa sem o bloco do contrato, para a UI não renderizar JSON cru embaixo do texto.
 *
 * Corta exatamente o span que `locateContractFence` casou. Uma tentativa anterior usava uma regex
 * ancorada no fim da string, que apagava em silêncio tudo a partir da PRIMEIRA cerca sempre que o
 * relatório citava JSON no meio — levando seções reais junto.
 */
export function stripContractFence(text) {
  if (!text) return text;
  const found = locateContractFence(text);
  if (!found) return text.trimEnd();
  return (text.slice(0, found.start) + text.slice(found.end)).trimEnd();
}
