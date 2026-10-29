/**
 * Cliente HTTP da Scrape Creators, comum a todas as fontes que passam por ela (Meta, Instagram,
 * TikTok).
 *
 * Toda rota cobra 1 crédito por REQUISIÇÃO (não por item), autentica pelo header `x-api-key` e
 * responde JSON com `credits_remaining`. Um cliente só garante que o 402 vire a mesma frase em
 * qualquer fonte, e que nenhuma delas use `res.json()` — que arredonda ids acima de 2^53.
 */

import { SCRAPECREATORS_API_KEY } from "../config.js";
import { parseJsonKeepingIds } from "./shared.js";

export const BASE = "https://api.scrapecreators.com";
export const hasKey = () => Boolean(SCRAPECREATORS_API_KEY);

export function requireKey(fonte) {
  if (!SCRAPECREATORS_API_KEY) {
    throw new Error(`${fonte}: SCRAPECREATORS_API_KEY não está definida no spy.env do worker.`);
  }
}

/**
 * GET numa rota da Scrape Creators. `params` com valor vazio/nulo não vão na URL.
 * @returns {Promise<object>}
 */
export async function scGet(path, params, { signal, fonte = "Scrape Creators" } = {}) {
  requireKey(fonte);
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  }
  const url = `${BASE}${path}${q.toString() ? `?${q}` : ""}`;
  const res = await fetch(url, { headers: { "x-api-key": SCRAPECREATORS_API_KEY }, signal });
  if (res.status === 402) throw new Error("Scrape Creators: créditos insuficientes (402).");
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 200);
    // O status vai no erro para quem precisa distinguir um caso (o 503 do `require_play_counts`).
    throw Object.assign(new Error(`${fonte} — Scrape Creators ${res.status}: ${body}`), { status: res.status });
  }
  // Não `res.json()`: ids numéricos acima de 2^53 seriam arredondados antes de chegarem aqui.
  return parseJsonKeepingIds(await res.text());
}
