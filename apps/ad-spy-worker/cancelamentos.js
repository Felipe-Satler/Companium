/**
 * O que pode ser cancelado neste processo: id da linha -> AbortController.
 *
 * Um registro só, compartilhado, porque a mesma composição pode ter nascido de dois lugares: da
 * rota do Composer (o controller é dela) ou de dentro de uma orquestração (o controller é o da
 * orquestração inteira — cancelar a composição dela cancela a orquestração, que não tem o que
 * fazer depois). Quem cancela não precisa saber de onde veio: procura pelo id.
 *
 * Linha `running` que NÃO está aqui não está rodando neste processo — sobrou de uma vida anterior,
 * e quem cancela pode fechá-la direto.
 */

const controladores = new Map();

export function registrarCancelavel(id, controller) {
  controladores.set(String(id), controller);
}

export function soltarCancelavel(id) {
  controladores.delete(String(id));
}

/** @returns {AbortController|null} */
export function cancelavel(id) {
  return controladores.get(String(id)) ?? null;
}
