/**
 * Quando o nome, o CRM e o RQE do médico TÊM de estar na arte — DADO COMPARTILHADO entre a pré-etapa
 * da criação do estático (que trava as chaves), o worker (que confere o que o agente devolveu) e os
 * templates (que desenham).
 *
 * ## De onde vêm as regras
 *
 * Do Manual de Publicidade Médica (Res. CFM nº 2.336/2023), como a equipe as resumiu em 27/10/2026.
 * Não é parecer jurídico: é a leitura que a Groohub adotou, codificada NUM lugar só para que mudar
 * uma regra seja mudar este arquivo — e não caçar `if` espalhado pela tela, pelo worker e pelo
 * template.
 *
 *   1. Feed orgânico, com a bio do Instagram completa (nome, CRM/UF, "MÉDICO", RQE): a identificação
 *      na arte é OPCIONAL. A bio é que cumpre a regra.
 *   2. Feed orgânico SEM a bio conferida: não há como saber se a bio cumpre — então ela vai na arte.
 *   3. Peça que vai circular FORA do Instagram (WhatsApp, Telegram): obrigatória NA ARTE. Fora do
 *      perfil, não há bio do lado.
 *   4. Vídeo (Reels, Stories longos): obrigatória na peça. Não há vídeo estático hoje, mas a regra
 *      fica aqui para os reels.
 *   5. Pago (tráfego para quem não segue o perfil): na arte OU, bem explícita, na legenda. A pessoa
 *      escolhe; não incluir em nenhuma das duas não é opção.
 *   6. Sem RQE e divulgando pós-graduação lato sensu: "NÃO ESPECIALISTA", em caixa alta, onde a pós
 *      for citada.
 *
 * As regras se somam pela mais restrita: um anúncio pago que também vai para o WhatsApp cai na 3.
 */

/** Como a identificação entra numa peça. */
export const EXIGENCIAS = {
  OBRIGATORIA_NA_ARTE: "obrigatoria_na_arte",
  ARTE_OU_LEGENDA: "arte_ou_legenda",
  OPCIONAL: "opcional",
};

export const USOS = ["organico", "pago"];

/** Onde a pessoa escolheu pôr a identificação, quando a regra deixa escolher. */
export const ONDE_IDENTIFICAR = ["arte", "legenda", "nenhum"];

/**
 * A exigência para esta peça, com o motivo em linguagem de quem vai ler na tela.
 *
 * @param {{ uso: "organico"|"pago", circulaFora?: boolean, bioConferida?: boolean,
 *           midia?: "imagem"|"video" }} contexto
 * @returns {{ exigencia: string, motivo: string }}
 */
export function exigenciaDeIdentificacao({ uso, circulaFora = false, bioConferida = false, midia = "imagem" }) {
  if (midia === "video") {
    return {
      exigencia: EXIGENCIAS.OBRIGATORIA_NA_ARTE,
      motivo: "Em vídeo, o CFM pede a identificação legível na própria peça.",
    };
  }
  if (circulaFora) {
    return {
      exigencia: EXIGENCIAS.OBRIGATORIA_NA_ARTE,
      motivo: "Fora do Instagram (WhatsApp, Telegram) não há bio do lado: a identificação vai na arte.",
    };
  }
  if (uso === "pago") {
    return {
      exigencia: EXIGENCIAS.ARTE_OU_LEGENDA,
      motivo: "Anúncio pago aparece para quem não segue o perfil: identificação na arte ou, bem explícita, na legenda.",
    };
  }
  if (!bioConferida) {
    return {
      exigencia: EXIGENCIAS.OBRIGATORIA_NA_ARTE,
      motivo: "A bio do Instagram não está marcada como conferida no Brand kit: sem ela, a identificação vai na arte.",
    };
  }
  return {
    exigencia: EXIGENCIAS.OPCIONAL,
    motivo: "Feed orgânico com a bio conferida: a identificação na arte é opcional.",
  };
}

/**
 * Onde a identificação entra de fato, juntando a exigência com a escolha da pessoa.
 *
 * Nunca devolve menos do que a regra pede: escolher "nenhum" num pago vira erro (a tela não deixa
 * chegar aqui, e o worker confere de novo), e numa peça obrigatória a arte é ligada mesmo que a
 * escolha diga o contrário.
 *
 * @returns {{ naArte: boolean, naLegenda: boolean, erro: string | null }}
 */
export function ondeIdentificar(exigencia, escolha) {
  if (exigencia === EXIGENCIAS.OBRIGATORIA_NA_ARTE) {
    return { naArte: true, naLegenda: escolha === "legenda", erro: null };
  }
  if (exigencia === EXIGENCIAS.ARTE_OU_LEGENDA) {
    if (escolha === "arte") return { naArte: true, naLegenda: false, erro: null };
    if (escolha === "legenda") return { naArte: false, naLegenda: true, erro: null };
    return {
      naArte: false,
      naLegenda: true,
      erro: "Anúncio pago precisa da identificação na arte ou na legenda.",
    };
  }
  return { naArte: escolha === "arte", naLegenda: escolha === "legenda", erro: null };
}

/** As escolhas que a tela oferece para esta exigência (as outras ficam desabilitadas). */
export function escolhasPermitidas(exigencia) {
  if (exigencia === EXIGENCIAS.OBRIGATORIA_NA_ARTE) return ["arte"];
  if (exigencia === EXIGENCIAS.ARTE_OU_LEGENDA) return ["arte", "legenda"];
  return ["arte", "legenda", "nenhum"];
}

const semAcento = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const CITA_POS = /\bpos[\s-]?gradua/;

/**
 * O texto cita a pós-graduação? Pela palavra ("pós-graduação", "pós-graduado") ou pelo nome da pós
 * como está no Brand kit ("Medicina do Sono pelo Hospital X").
 */
export function citaPosGraduacao(texto, posGraduacao = "") {
  const t = semAcento(texto);
  if (!t) return false;
  if (CITA_POS.test(t)) return true;
  const pos = semAcento(posGraduacao).trim();
  return pos.length >= 8 && t.includes(pos);
}

/**
 * A regra 6: sem RQE, a arte (ou a legenda) que cita a pós-graduação leva "NÃO ESPECIALISTA".
 *
 * Conferido pelo CÓDIGO sobre o texto final — não pedido ao agente —, porque é o tipo de regra que um
 * modelo esquece justamente na peça em que ela importa.
 *
 * @param {{ rqe?: string, pos_graduacao?: string }} identificacao
 * @param {{ arte: string[], legenda: string }} textos
 * @returns {{ naArte: boolean, naLegenda: boolean }}
 */
export function precisaNaoEspecialista(identificacao, { arte = [], legenda = "" } = {}) {
  const id = identificacao || {};
  if (String(id.rqe ?? "").trim()) return { naArte: false, naLegenda: false };
  const pos = id.pos_graduacao || "";
  return {
    naArte: arte.some((t) => citaPosGraduacao(t, pos)),
    naLegenda: citaPosGraduacao(legenda, pos),
  };
}

/** O texto em que "NÃO ESPECIALISTA" já aparece, em caixa alta, como a regra pede. */
export const temNaoEspecialista = (texto) => String(texto ?? "").includes("NÃO ESPECIALISTA");
