/**
 * Sugestão de palavras-chave: o agente de pesquisa propõe, a sonda mede, a pessoa escolhe.
 *
 * Ordem importante. Este módulo NÃO decide nada e NÃO gasta crédito da Scrape Creators — ele só
 * gera hipóteses melhores que o chute. Quem diz se um termo presta é `/api/spy/probe`, que mede
 * uma página de verdade contra os filtros de verdade.
 *
 * Por isso o parse aqui é tolerante: se o agente devolver prosa sem o bloco JSON, ou um JSON
 * torto, o que sai é "nenhum termo" com o texto preservado — nunca um termo inventado por nós para
 * preencher. Um termo falso custa 1 crédito e, pior, direciona a busca inteira.
 */

import { extractContractJson, stripContractFence } from "./agent-contract.js";

/** Confianças que o contrato prevê. Qualquer outra coisa vira "palpite" — o grau mais cauteloso. */
const CONFIANCAS = new Set(["visto", "inferido", "palpite"]);

/** Termo utilizável: curto e sem frase de busca. Espelha a regra do prompt. */
function termoValido(t) {
  const termo = String(t ?? "").trim();
  if (termo.length < 2 || termo.length > 60) return null;
  // Até 5 palavras: o prompt pede de 1 a 4, e uma a mais não vale rejeitar uma sugestão boa.
  if (termo.split(/\s+/).length > 5) return null;
  return termo;
}

/**
 * Lê a resposta do agente.
 *
 * @returns {{ resumoMd: string, termos: object[], concorrentes: object[], vocabulario: string[],
 *             fontes: { web: boolean }, semBlocoJson: boolean }}
 */
export function parsePesquisaReply(finalText) {
  const texto = String(finalText ?? "");
  const bloco = extractContractJson(texto);
  const resumoMd = stripContractFence(texto).trim();

  if (!bloco || typeof bloco !== "object") {
    return {
      resumoMd,
      termos: [],
      concorrentes: [],
      vocabulario: [],
      // Sem bloco não dá para saber se ele pesquisou: `false` é a leitura segura.
      fontes: { web: false },
      semBlocoJson: true,
    };
  }

  const vistos = new Set();
  const termos = [];
  for (const row of Array.isArray(bloco.termos) ? bloco.termos : []) {
    const termo = termoValido(row?.termo);
    if (!termo) continue;
    const chave = termo.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const confianca = String(row?.confianca ?? "").toLowerCase();
    termos.push({
      termo,
      porque: String(row?.porque ?? "").trim().slice(0, 300),
      confianca: CONFIANCAS.has(confianca) ? confianca : "palpite",
      onde: String(row?.onde ?? "").trim().slice(0, 300),
    });
    // Teto duro: cada termo que a pessoa testar custa 1 crédito.
    if (termos.length >= 5) break;
  }

  return {
    resumoMd,
    termos,
    concorrentes: (Array.isArray(bloco.concorrentes) ? bloco.concorrentes : [])
      .map((c) => ({
        nome: String(c?.nome ?? "").trim().slice(0, 120),
        onde: String(c?.onde ?? "").trim().slice(0, 300),
      }))
      .filter((c) => c.nome)
      .slice(0, 10),
    vocabulario: (Array.isArray(bloco.vocabulario) ? bloco.vocabulario : [])
      .map((v) => String(v ?? "").trim())
      .filter(Boolean)
      .slice(0, 20),
    // Só confia no `true` que o agente afirmar explicitamente.
    fontes: { web: bloco?.fontes?.web === true },
    semBlocoJson: false,
  };
}

/** O prompt da rodada. Curto de propósito: todo o contexto fixo vive na definição do agente. */
export function buildPesquisaPrompt({ nicho, contexto }) {
  const linhas = [`Nicho ou tema: ${nicho}`];
  if (contexto) {
    linhas.push("", "Contexto do cliente (use para calibrar o vocabulário):", contexto);
  }
  linhas.push(
    "",
    "Proponha as palavras-chave para buscar anúncios desse nicho na Biblioteca de Anúncios da Meta.",
  );
  return linhas.join("\n");
}
