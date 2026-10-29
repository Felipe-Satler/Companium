/**
 * Órfãs — o que ficou `running` no banco depois de o worker morrer no meio.
 *
 * Orquestração e composição rodam DENTRO deste processo: a rota responde 202 e o trabalho segue
 * solto. Se o processo reinicia (qualquer push dispara um deploy), o trabalho some e a linha fica
 * `running` para sempre — ninguém mais vai fechá-la. Na tela isso é um spinner que não acaba e,
 * no orquestrador, o botão de disparar travado em "uma por vez".
 *
 * Como só existe UM processo do worker, a regra no boot é exata, sem relógio nem palpite: toda
 * linha `running` que ele encontrar ao subir é órfã, porque quem a estava escrevendo era ele mesmo,
 * na vida anterior.
 */

import { avisosDoConjunto, resumoDoPlano } from "./composer-conjunto.js";
import {
  listComposicoesRodando,
  listOrquestracoesRodando,
  patchComposition,
  patchOrquestracao,
} from "./db.js";

export const MOTIVO_REINICIO = "Interrompida: o worker reiniciou no meio da execução.";

/** As etapas de uma orquestração parada: a que estava rodando fecha como erro, com o motivo. */
export function fecharEtapas(etapas, motivo, agora = new Date().toISOString()) {
  return (Array.isArray(etapas) ? etapas : []).map((e) =>
    e.status === "running" ? { ...e, status: "error", note: motivo, ended_at: agora } : e
  );
}

/**
 * Uma composição interrompida, sem jogar fora o que já estava pronto.
 *
 * Com pelo menos um anúncio escrito ela vai para REVISÃO (desde 19/10/2026 nada fica salvo sem
 * ser revisto), e os que faltavam ficam marcados como
 * erro — três anúncios prontos não podem sumir da tela porque o quarto não chegou. Sem nenhum, a
 * composição inteira é erro. Nos dois casos `error` guarda o motivo: numa composição em revisão é o
 * que diz à tela que o conjunto ficou pela metade, e por quê (reinício, cancelamento).
 *
 * @returns {object} o patch da linha
 */
export function fecharComposicao(anuncios, motivo) {
  const lista = Array.isArray(anuncios) ? anuncios : [];
  if (!lista.some((a) => a.status === "ok")) return { status: "error", error: motivo };
  const fechados = lista.map((a) =>
    a.status === "ok" || a.status === "error" ? a : { ...a, status: "error", error: motivo }
  );
  return {
    status: "revisao",
    error: motivo,
    anuncios: fechados,
    plano: resumoDoPlano(fechados),
    avisos: avisosDoConjunto(fechados),
  };
}

export const MOTIVO_CONCEITO_INTERROMPIDO = "A sugestão foi interrompida por um reinício do servidor. Peça outra.";

/**
 * Uma composição na etapa de CONCEITOS quando o worker caiu. Duas situações órfãs:
 *
 *   - a primeira chamada estava em curso (nenhum conceito e nenhum aviso de insumo): sem ela não há
 *     o que mostrar, então a composição fecha como erro;
 *   - um anúncio estava `gerando` um conceito novo: ele vira `erro`, com o motivo, e quem compõe pede
 *     outro.
 *
 * @returns {object|null} o patch da linha, ou null quando nada estava rodando
 */
export function destravarConceitos(composicao) {
  const slots = Array.isArray(composicao?.conceitos) ? composicao.conceitos : [];
  if (!slots.length) {
    return composicao?.insumos_insuficientes ? null : { status: "error", error: MOTIVO_REINICIO };
  }
  if (!slots.some((s) => s.status === "gerando")) return null;
  return {
    conceitos: slots.map((s) =>
      s.status === "gerando" ? { ...s, status: "erro", error: MOTIVO_CONCEITO_INTERROMPIDO } : s
    ),
  };
}

export const MOTIVO_REVISAO_INTERROMPIDA =
  "A revisão foi interrompida por um reinício do servidor — o anúncio ficou como estava.";

/**
 * Uma composição EM REVISÃO com um anúncio que estava sendo revisado quando o worker caiu.
 *
 * Diferente de `fecharComposicao`: aqui o anúncio "running" TEM conteúdo — a revisão não o apaga
 * enquanto roda —, então ele volta a `ok` como estava, com o motivo à vista.
 */
export function destravarRevisao(anuncios) {
  const lista = (Array.isArray(anuncios) ? anuncios : []).map((a) =>
    a.status === "running" ? { ...a, status: "ok", error: MOTIVO_REVISAO_INTERROMPIDA } : a
  );
  return { anuncios: lista, plano: resumoDoPlano(lista), avisos: avisosDoConjunto(lista) };
}

/**
 * Fecha tudo que ficou `running`. Chamada UMA vez, quando o worker sobe.
 *
 * Nunca lança: é faxina, e uma falha aqui não pode impedir o worker de atender.
 *
 * @returns {Promise<{ orquestracoes: number, composicoes: number }>}
 */
export async function fecharOrfas({ log = () => {} } = {}) {
  const feitas = { orquestracoes: 0, composicoes: 0 };
  try {
    for (const o of await listOrquestracoesRodando()) {
      await patchOrquestracao(o.id, {
        status: "error",
        error: MOTIVO_REINICIO,
        etapas: fecharEtapas(o.etapas, MOTIVO_REINICIO),
      });
      feitas.orquestracoes += 1;
    }
    for (const c of await listComposicoesRodando()) {
      // Em revisão: só o anúncio que estava sendo revisado trava; a composição continua em revisão.
      // Em conceitos: só o que estava sendo gerado (ver `destravarConceitos`).
      const patch =
        c.status === "conceitos"
          ? destravarConceitos(c)
          : c.status === "revisao"
            ? destravarRevisao(c.anuncios)
            : fecharComposicao(c.anuncios, MOTIVO_REINICIO);
      if (!patch) continue;
      await patchComposition(c.id, patch);
      feitas.composicoes += 1;
    }
  } catch (err) {
    log(`órfãs: não foi possível fechar tudo (${err?.message || err})`);
  }
  if (feitas.orquestracoes || feitas.composicoes) {
    log(
      `órfãs: ${feitas.orquestracoes} orquestração(ões) e ${feitas.composicoes} composição(ões) ` +
        "interrompidas pelo reinício foram fechadas"
    );
  }
  return feitas;
}
