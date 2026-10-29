/**
 * A fiação da etapa de Conceitos Estratégicos: o que liga `composer-conceitos.js` (a condução, sem
 * I/O) ao banco, ao agente e ao cancelamento.
 *
 * Mora fora de `index.js` porque tem dois chamadores — as rotas da Nova Composição e o orquestrador,
 * que também abre a etapa de conceitos ao compor — e os dois têm de usar a MESMA fila por
 * composição: uma rejeição feita na tela enquanto o orquestrador ainda está nos conceitos não pode
 * abrir uma segunda chamada simultânea ao agente.
 */

import { cancelavel, registrarCancelavel, soltarCancelavel } from "./cancelamentos.js";
import { montarMaterial, perguntarAoComposer } from "./composer.js";
import { gerarConceito, naFila, naTrava, runConceitos } from "./composer-conceitos.js";
import { getComposition, patchComposition } from "./db.js";

/** O controle de cancelamento da etapa de conceitos: um por composição, enquanto ela estiver nela. */
export function controleDeConceitos(id) {
  let c = cancelavel(id);
  if (!c || c.signal.aborted) {
    c = new AbortController();
    registrarCancelavel(id, c);
  }
  return c;
}

/**
 * Tudo que a etapa de conceitos usa do mundo, para uma composição. `signal` é o do chamador (o
 * orquestrador tem o dele); sem ele, o controle próprio da composição, que a rota de cancelar aborta.
 */
export function depsDeConceitos(row, { log = () => {}, signal = null } = {}) {
  const sinal = signal ?? controleDeConceitos(row.id).signal;
  return {
    log,
    material: () =>
      montarMaterial({
        cliente: row.cliente,
        libraryEntryId: row.library_entry_id,
        entradas: row.entradas,
        extraPrompt: row.extra_prompt || "",
      }),
    perguntar: (content, n) => perguntarAoComposer(content, { cliente: row.cliente, n, signal: sinal, log }),
    ler: () => getComposition(row.id),
    gravar: (patch) => patchComposition(row.id, patch),
    agendar: (n) => agendarConceito(row, n, { log, signal }),
    signal: sinal,
  };
}

/** A primeira chamada da etapa, na fila da composição. Devolve a promessa (o orquestrador espera). */
export function rodarConceitos(row, opts = {}) {
  const deps = depsDeConceitos(row, opts);
  return naFila(row.id, () => runConceitos({ id: row.id, extraPrompt: row.extra_prompt || "", deps }));
}

/** A primeira chamada, solta (a rota responde 202). Falha que não seja cancelamento fecha a linha. */
export function iniciarConceitos(row, { log = () => {} } = {}) {
  const deps = depsDeConceitos(row, { log });
  void rodarConceitos(row, { log }).catch(async (err) => {
    if (deps.signal.aborted) return; // a rota de cancelar já fechou a linha
    const msg = err instanceof Error ? err.message : String(err);
    log(`[conceitos ${row.id}] FALHOU: ${msg}`);
    await patchComposition(row.id, { status: "error", error: msg.slice(0, 500) }).catch(() => {});
    soltarCancelavel(row.id);
  });
}

/** Um conceito novo para o anúncio `n`, na fila da composição. Falha vira `erro` naquele anúncio. */
export function agendarConceito(row, n, { log = () => {}, signal = null } = {}) {
  const deps = depsDeConceitos(row, { log, signal });
  void naFila(row.id, () => gerarConceito({ id: row.id, n, extraPrompt: row.extra_prompt || "", deps })).catch(
    async (err) => {
      if (deps.signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      log(`[conceitos ${row.id}] anúncio ${n + 1} FALHOU: ${msg}`);
      await naTrava(row.id, async () => {
        const atual = await getComposition(row.id);
        if (atual?.status !== "conceitos") return;
        const slots = (atual.conceitos || []).map((s) =>
          s.n === n && s.status === "gerando"
            ? { ...s, status: "erro", error: `A sugestão falhou (${msg.slice(0, 200)}). Peça outra.` }
            : s
        );
        await patchComposition(row.id, { conceitos: slots });
      }).catch(() => {});
    }
  );
}

/** Espera a fila de agente da composição esvaziar (o que já estava agendado termina). */
export const esperarFila = (id) => naFila(id, async () => {});
