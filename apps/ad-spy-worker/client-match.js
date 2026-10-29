/**
 * Casamento de nome de cliente — porte do que `src/data/clienteAliases.ts` faz.
 *
 * O worker precisa somar o investimento de uma conta de anúncio ao cliente certo. Esse casamento
 * NÃO é comparação de string: passa por aliases explícitos e por uma heurística que limpa prefixos
 * de conta ("CA 1.1.1 - ", "GROOHUB - ", "Dr. "). Sem isso, uma conta como "CA 2.4.01" não casa com
 * ninguém, o investimento do cliente vira zero — e o agente escreve, com toda a confiança, que o
 * cliente parou de investir.
 *
 * Os DADOS (os mapas de alias) não são copiados: vêm de `shared/client-aliases.js`, o mesmo arquivo
 * que o frontend usa. Só a LÓGICA está portada aqui, e `src/test/clientMatchParidade.test.ts`
 * compara função a função com a versão TypeScript. Se alguém mudar um lado, o teste quebra.
 */

import {
  ADS_CLIENT_ALIASES,
  ADS_CLIENT_MERGES,
  CLIENT_ALIASES,
} from "../../shared/client-aliases.js";

export function stripAccents(s) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Chave para matching frouxo: insensível a caixa, acento e underscore-vs-espaço. */
export function clientMatchKey(s) {
  if (!s) return "";
  return stripAccents(s).toLowerCase().replace(/[\s_]+/g, "_").trim();
}

export function normalizeClientName(name) {
  if (!name) return "";
  const trimmed = String(name).trim();
  if (CLIENT_ALIASES[trimmed]) return CLIENT_ALIASES[trimmed];
  const alt = trimmed.replace(/_/g, " ");
  if (CLIENT_ALIASES[alt]) return CLIENT_ALIASES[alt];
  const altUnderscore = trimmed.replace(/ /g, "_");
  if (CLIENT_ALIASES[altUnderscore]) return CLIENT_ALIASES[altUnderscore];
  return trimmed;
}

/** Nome de conta de Ads -> slug canônico do Kommo. Alias explícito ganha da heurística. */
export function canonicalizeAdsClient(raw) {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";
  if (ADS_CLIENT_ALIASES[trimmed]) return ADS_CLIENT_ALIASES[trimmed];

  let s = trimmed;
  s = s.replace(/\s*[-–—|I]?\s*Groohub\s*$/i, "");
  s = s.replace(/\s+-\s*C\.?\s*A\.?\s*\d+(\s*\.\s*\d+)*\s*\.?\s*$/i, "");
  s = s.replace(/^\(Groohub\)\s*-\s*/i, "");
  s = s.replace(/^GROOHUB\s*\d*\s*-\s*/i, "");
  s = s.replace(/^Groohub\s+/i, "");
  s = s.replace(/^Conta\s+de\s+An[úu]ncios\s*-\s*/i, "");
  s = s.replace(/^C\.?\s*A\.?(\s+GROOHUB)?\s*-\s*/i, "");
  s = s.replace(/^CA\d+\s*-\s*/i, "");
  s = s.replace(/^C\.?A\.?\s*\d+(\.\d+)*\s*-\s*/i, "");
  s = s.trim();
  s = s.replace(/^Dra?\.?\s+/i, "");
  s = s.trim();

  if (CLIENT_ALIASES[s]) return CLIENT_ALIASES[s];
  const slug = s.replace(/\s+/g, "_");
  if (CLIENT_ALIASES[slug]) return CLIENT_ALIASES[slug];
  return slug;
}

/**
 * Conta de Ads que pertence a outro cliente do CRM (médicos que dividem o mesmo cliente no Kommo).
 * O resumo soma os dois canais, então vale a fusão — `channel: "meta"` é o único caso em que não.
 */
export function foldMergedAdsClient(canonical, channel) {
  if (channel === "meta") return canonical;
  const merge = ADS_CLIENT_MERGES[clientMatchKey(canonical)];
  return merge ? merge.crmCanonical : canonical;
}

// Conectivos ignorados na chave "frouxa": deixa "Instituto Urológico Aurora" casar com
// "Instituto Urológico DE Contagem".
const CONECTIVOS = new Set(["de", "da", "do", "das", "dos", "e"]);

/**
 * Chaves candidatas de um nome da planilha, da mais forte para a mais fraca.
 *
 * A planilha traz "Dr. José Ramos - VascuMed" (médico + clínica) e o slug do dashboard é só
 * "Jose_Ramos": o nome inteiro não casa, por isso as partes antes e depois do traço também entram.
 */
export function chavesCandidatas(cliente) {
  const out = [];
  const add = (s) => {
    const k = clientMatchKey(canonicalizeAdsClient(s));
    if (k && !out.includes(k)) out.push(k);
  };
  add(cliente);
  const corte = String(cliente || "").indexOf(" - ");
  if (corte > 0) {
    add(cliente.slice(0, corte));
    add(cliente.slice(corte + 3));
  }
  return out;
}

/** Variante frouxa da chave, sem conectivos. Usada como último recurso ao casar planilha x CRM. */
export function chaveFrouxa(s) {
  return clientMatchKey(s)
    .split("_")
    .filter((t) => t && !CONECTIVOS.has(t))
    .join("_");
}
