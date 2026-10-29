/**
 * O que varia por cliente no Contexto Operacional: a ficha, e só.
 *
 * Sem I/O e sem import de config, para poder ser testado em qualquer máquina. Tudo que é estático
 * (persona, o que é a Companium, o contrato de saída) mora na definição do agente —
 * `agent/briefagent.md`.
 *
 * ## Por que NÃO há métrica aqui
 *
 * Até setembro de 2026 este prompt mandava os números de duas semanas fechadas e o resumo tinha uma
 * seção "Resultados da semana". Isso saiu daqui de propósito: o recorte em que alguém discute
 * resultado é mês, campanha ou "desde que mudamos a oferta" — nunca "a semana passada, porque é a
 * última que fechou". Quem faz leitura de número agora é o Relatório, que recebe o período escolhido
 * e as metas dele (`report-prompt.js`).
 *
 * O que sobra aqui é o que só o ClickUp sabe, e é o que este agente faz de melhor: em que pé está a
 * operação deste cliente. A ficha continua vindo porque ela é o chão do texto: sem ela, um ClickUp
 * indisponível deixaria o agente sem NADA verdadeiro para escrever.
 */

import { extractContractJson, stripContractFence } from "./agent-contract.js";

/**
 * @param {object} p
 * @param {object} p.ficha nome, especialidades[], plano, squad, desde, mesesDeCasa, temCRM
 */
export function buildBriefPrompt({ ficha = {} } = {}) {
  const esp = Array.isArray(ficha.especialidades) ? ficha.especialidades.filter(Boolean) : [];
  return [
    `Cliente: ${ficha.nome || "(sem nome)"}`,
    esp.length
      ? `Especialidade(s): ${esp.join(", ")}`
      : ficha.especialidadesIndisponiveis
        ? "Especialidade(s): (não foi possível ler agora — NÃO afirme que o cliente não tem " +
          "especialidade cadastrada; apenas não fale do assunto)"
        : "Especialidade(s): (não cadastrada)",
    `Plano: ${ficha.plano || "(não informado)"}`,
    `Líder de RevOps: ${ficha.squad || "(não informado)"}`,
    ficha.desde
      ? `Cliente desde: ${ficha.desde}${
          Number.isFinite(ficha.mesesDeCasa) ? ` (${ficha.mesesDeCasa} meses de casa)` : ""
        }`
      : "Cliente desde: (não informado)",
    `Usa CRM: ${
      ficha.temCRM === null || ficha.temCRM === undefined ? "(não informado)" : ficha.temCRM ? "sim" : "não"
    }`,
    "",
    // O ClickUp é acessível só pelas ferramentas do agente no servidor — não passa por aqui.
    "Consulte o ClickUp deste cliente e escreva o CONTEXTO OPERACIONAL: como a operação dele roda " +
      "hoje, em que pé estão as frentes, quem responde por quê, o que travou e desde quando, e o " +
      "que de histórico alguém que nunca mexeu nesse cliente precisa saber. Em prosa — não é lista " +
      "de tarefas e não é relatório de status.",
    "Se não conseguir acessar o ClickUp, escreva o que der com a ficha, DIGA no texto que a " +
      "situação das frentes não pôde ser verificada, e registre `clickup: false` no bloco final.",
    "",
    "Você NÃO recebeu número nenhum, e isso é de propósito: investimento, lead, CPL, faturamento e " +
      "ROAS são assunto do Relatório, que analisa um período escolhido com as metas dele. Não " +
      "estime, não cite e não comente resultado numérico aqui — nem de memória, nem 'por volta de'.",
  ].join("\n");
}

/**
 * A resposta do agente: prosa + bloco estruturado.
 *
 * Bloco ausente ou inválido NÃO é erro — a prosa é o que a tela mostra primeiro, e perder o resumo
 * inteiro por causa de uma vírgula no JSON seria o pior negócio possível.
 *
 * `contexto` e `situacao` são lidos como fallback porque as linhas gravadas ANTES da reestruturação
 * continuam na tabela (o upsert é por cliente, e o job só reescreve quem precisa). Ler os dois
 * nomes é o que faz a tela não esvaziar no meio do deploy; escrever, só no nome novo.
 */
export function parseBriefReply(finalText) {
  const bruto = extractContractJson(finalText);
  const briefMd = stripContractFence(finalText || "") || "";
  if (!bruto) return { briefMd, brief: null, fontes: {} };

  const riscos = Array.isArray(bruto.riscos)
    ? bruto.riscos
        .filter((r) => r && typeof r === "object")
        .map((r) => ({
          titulo: String(r.titulo ?? "").trim(),
          // Só as três que a UI sabe pintar; qualquer outra coisa vira "media".
          gravidade: ["alta", "media", "baixa"].includes(String(r.gravidade ?? "").toLowerCase())
            ? String(r.gravidade).toLowerCase()
            : "media",
          detalhe: String(r.detalhe ?? "").trim(),
        }))
        .filter((r) => r.titulo)
    : [];

  const texto = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

  return {
    briefMd,
    brief: {
      contexto_operacional:
        texto(bruto.contexto_operacional) ?? texto(bruto.contexto) ?? texto(bruto.situacao),
      riscos,
    },
    fontes: {
      clickup: bruto.fontes?.clickup === true,
      supabase: bruto.fontes?.supabase !== false,
    },
  };
}
