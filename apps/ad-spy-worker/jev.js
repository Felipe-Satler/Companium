/**
 * Cliente do Jev (TypeSafe, servido pelo OpenRouter): perguntas fechadas sobre um texto, com a
 * probabilidade de cada resposta.
 *
 * Fala HTTP direto com o OpenRouter. Não passa pelo agent-cli.js nem pelo agent-contract.js: o Jev
 * não é um agente, não escreve texto e não tem sessão. O formato da API está em docs/jev-api.md,
 * medido em chamadas reais.
 *
 * Três regras que este módulo impõe, para quem chama não precisar lembrar:
 *
 *   - NUNCA LANÇA. Erro de rede, timeout, HTTP de erro, corpo torto: a pergunta volta `null`, o
 *     motivo vai para o log e para `erro`. Quem chama sempre tem o caminho de antes (o agente) e
 *     só precisa saber que não houve resposta.
 *   - SÓ VALE O QUE FOI OFERECIDO. Opção de `choice` que não está na lista, nível de `score` fora da
 *     faixa, `noul` fora de 0 a 1, resposta de outro tipo ou sobre id que não foi perguntado:
 *     descartado, vira `null`.
 *   - DESLIGADO NÃO CHAMA. Sem `JEV_ENABLED=1` (ou sem chave) nenhuma requisição sai, e todas as
 *     respostas voltam `null`.
 *
 * As respostas têm o mesmo formato nos três tipos:
 *
 *   { valor, probabilidade, probabilidades }
 *
 *   - `noul`: `valor` é true/false (sim quando p ≥ 0,5). `probabilidades` é { sim, nao }. Para um
 *     limiar ("descarta se a chance de sim for ≤ 0,1"), use `probabilidades.sim`, não
 *     `probabilidade` — esta é a do valor escolhido, e num "não" ela é a chance de não.
 *   - `choice`: `valor` é o id da opção. `probabilidades` é por opção. Vem também `confianca`, que a
 *     TypeSafe calcula à parte e NÃO é a probabilidade da opção.
 *   - `score`: os níveis são numerados a partir de 1, na ordem em que foram passados (a API conta de
 *     0; a conversão é feita aqui, e só aqui). `valor` é o nível mais provável, `media` é a nota
 *     ponderada (pode cair entre níveis) e `probabilidades` é por nível. Vem também `confianca`.
 */

import {
  JEV_CONCORRENCIA,
  JEV_ENABLED,
  JEV_ENDPOINT,
  JEV_MODELO,
  JEV_TIMEOUT_MS,
  OPENROUTER_API_KEY,
} from "./config.js";

/** Preço de tabela por token de entrada; a saída é grátis. Usado só quando a resposta não traz `usage.cost`. */
export const USD_POR_TOKEN_ENTRADA = 0.042 / 1e6;
/**
 * Teto do estado, em caracteres. O OpenRouter aceita 32 mil tokens por chamada, somando estado e
 * perguntas. Português dá ~3 caracteres por token, então 60 mil caracteres são ~20 mil tokens e
 * deixam folga para as perguntas.
 */
export const MAX_ESTADO_CHARS = 60_000;
export const MAX_OPCOES = 255;
export const MIN_NIVEIS = 2;
export const MAX_NIVEIS = 10;

/** Repete uma vez: rede, timeout, 5xx, 429 (limite) e 529 (sobrecarga, documentado pela TypeSafe). */
const transitorio = (status) => status === 429 || status >= 500;

/**
 * Converte as perguntas para o formato da API, conferindo os limites antes de gastar uma chamada.
 *
 * Formato de entrada:
 *   noul:   { tipo: "noul", instrucoes, criterios?: { sim, nao } }
 *   choice: { tipo: "choice", instrucoes, opcoes: string[] | { [id]: descrição } }
 *   score:  { tipo: "score", instrucoes, niveis: string[] }   (do nível 1 ao último)
 *
 * @returns {{ questions: object, invalidas: Record<string, string> }}
 */
export function perguntasParaApi(perguntas) {
  const questions = {};
  const invalidas = {};
  for (const [id, p] of Object.entries(perguntas ?? {})) {
    const instructions = String(p?.instrucoes ?? "").trim();
    if (!instructions) {
      invalidas[id] = "sem instruções";
      continue;
    }
    if (p.tipo === "noul") {
      const q = { type: "noul", instructions };
      if (p.criterios?.sim || p.criterios?.nao) {
        q.criteria = { true: String(p.criterios.sim ?? ""), false: String(p.criterios.nao ?? "") };
      }
      questions[id] = q;
    } else if (p.tipo === "choice") {
      const criteria = Array.isArray(p.opcoes)
        ? Object.fromEntries(p.opcoes.map((o) => [String(o), null]))
        : { ...(p.opcoes ?? {}) };
      const n = Object.keys(criteria).length;
      if (n < 2 || n > MAX_OPCOES) {
        invalidas[id] = `choice precisa de 2 a ${MAX_OPCOES} opções (recebeu ${n})`;
        continue;
      }
      questions[id] = { type: "choice", instructions, criteria };
    } else if (p.tipo === "score") {
      const niveis = Array.isArray(p.niveis) ? p.niveis.map(String) : [];
      if (niveis.length < MIN_NIVEIS || niveis.length > MAX_NIVEIS) {
        invalidas[id] = `score precisa de ${MIN_NIVEIS} a ${MAX_NIVEIS} níveis (recebeu ${niveis.length})`;
        continue;
      }
      questions[id] = { type: "score", instructions, criteria: niveis };
    } else {
      invalidas[id] = `tipo desconhecido: ${p?.tipo}`;
    }
  }
  return { questions, invalidas };
}

const prob = (x) => (typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1 ? x : null);

/**
 * Lê UMA resposta contra a pergunta que a pediu. Qualquer coisa fora do que foi oferecido vira null.
 */
export function lerResposta(pergunta, resposta) {
  if (!resposta || typeof resposta !== "object" || resposta.type !== pergunta.type) return null;

  if (pergunta.type === "noul") {
    const sim = prob(resposta.noul);
    if (sim == null) return null;
    const valor = sim >= 0.5;
    // Arredondado: 1 − 0,99 em ponto flutuante dá 0,010000000000000009, e isso vai para a tela.
    const nao = Math.round((1 - sim) * 1e6) / 1e6;
    return { valor, probabilidade: valor ? sim : nao, probabilidades: { sim, nao } };
  }

  if (pergunta.type === "choice") {
    const opcoes = Object.keys(pergunta.criteria);
    if (!opcoes.includes(resposta.choice)) return null;
    const probabilidades = {};
    for (const o of opcoes) probabilidades[o] = prob(resposta.probabilities?.[o]) ?? 0;
    const p = prob(resposta.probabilities?.[resposta.choice]);
    if (p == null) return null;
    return { valor: resposta.choice, probabilidade: p, probabilidades, confianca: prob(resposta.confidence) };
  }

  if (pergunta.type === "score") {
    const n = pergunta.criteria.length;
    const media = resposta.score;
    if (typeof media !== "number" || !Number.isFinite(media) || media < 0 || media > n - 1) return null;
    // A API numera de 0; aqui o nível 1 é o primeiro da lista. Chave fora da faixa invalida tudo:
    // é sinal de que a resposta é sobre outra escala.
    const probabilidades = {};
    for (let i = 0; i < n; i += 1) probabilidades[i + 1] = 0;
    for (const [k, v] of Object.entries(resposta.probabilities ?? {})) {
      const i = Number(k);
      if (!Number.isInteger(i) || i < 0 || i >= n || prob(v) == null) return null;
      probabilidades[i + 1] = v;
    }
    let valor = 1;
    for (let nivel = 2; nivel <= n; nivel += 1) if (probabilidades[nivel] > probabilidades[valor]) valor = nivel;
    if (!(probabilidades[valor] > 0)) return null;
    return { valor, probabilidade: probabilidades[valor], probabilidades, media: media + 1, confianca: prob(resposta.confidence) };
  }

  return null;
}

/** Fila simples: no máximo `limite` funções rodando ao mesmo tempo, na ordem de chegada. */
export function criarFila(limite) {
  let ativos = 0;
  const espera = [];
  const proximo = () => {
    if (ativos >= limite || !espera.length) return;
    ativos += 1;
    const { fn, ok, falha } = espera.shift();
    Promise.resolve()
      .then(fn)
      .then(ok, falha)
      .finally(() => {
        ativos -= 1;
        proximo();
      });
  };
  return (fn) =>
    new Promise((ok, falha) => {
      espera.push({ fn, ok, falha });
      proximo();
    });
}

/**
 * Cria um cliente. O módulo exporta um pronto (`avaliar`), configurado pelo ambiente; a fábrica
 * existe para os testes e para scripts que precisem de outra chave ou outro limite.
 */
export function criarClienteJev({
  habilitado = JEV_ENABLED,
  chave = OPENROUTER_API_KEY,
  endpoint = JEV_ENDPOINT,
  modelo = JEV_MODELO,
  timeoutMs: timeoutPadrao = JEV_TIMEOUT_MS,
  concorrencia = JEV_CONCORRENCIA,
  fetch: fetchFn = globalThis.fetch,
  log = (m) => console.log(`[jev] ${m}`),
} = {}) {
  const naFila = criarFila(Math.max(1, concorrencia));

  async function postar(corpo, timeoutMs) {
    let ultimoErro = "";
    for (let tentativa = 0; tentativa < 2; tentativa += 1) {
      // AbortController e não AbortSignal.timeout: o mesmo código roda no worker e no jsdom dos
      // testes, e o timer cobre também a leitura do corpo.
      const ctrl = new AbortController();
      let estourou = false;
      const timer = setTimeout(() => {
        estourou = true;
        ctrl.abort();
      }, timeoutMs);
      try {
        const res = await fetchFn(endpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
          body: JSON.stringify(corpo),
          signal: ctrl.signal,
        });
        if (res.ok) {
          const texto = await res.text();
          try {
            return { json: JSON.parse(texto) };
          } catch {
            return { erro: "resposta sem corpo JSON" };
          }
        }
        const texto = (await res.text().catch(() => "")).slice(0, 200);
        ultimoErro = `HTTP ${res.status}${texto ? `: ${texto}` : ""}`;
        if (!transitorio(res.status)) break;
      } catch (err) {
        ultimoErro = estourou ? `timeout de ${timeoutMs} ms` : String(err?.message || err);
      } finally {
        clearTimeout(timer);
      }
    }
    return { erro: ultimoErro };
  }

  /**
   * @param {{ estado: string|object, perguntas: Record<string, object>, timeoutMs?: number }} args
   * @returns {Promise<{ respostas: Record<string, object|null>, latenciaMs: number|null,
   *   tokens: { entrada: number, saida: number }|null, custoUsd: number|null, truncado: boolean,
   *   modelo: string|null, erro: string|null }>}
   */
  async function avaliar({ estado, perguntas, timeoutMs = timeoutPadrao }) {
    const ids = Object.keys(perguntas ?? {});
    const vazio = (erro, extra = {}) => ({
      respostas: Object.fromEntries(ids.map((id) => [id, null])),
      latenciaMs: null,
      tokens: null,
      custoUsd: null,
      truncado: false,
      modelo: null,
      erro,
      ...extra,
    });

    if (!habilitado) return vazio("desligado");
    if (!chave) {
      log("OPENROUTER_API_KEY ausente; nenhuma chamada feita");
      return vazio("sem chave");
    }

    const { questions, invalidas } = perguntasParaApi(perguntas);
    for (const [id, motivo] of Object.entries(invalidas)) log(`pergunta "${id}" ignorada: ${motivo}`);
    if (!Object.keys(questions).length) return vazio("nenhuma pergunta válida");

    let texto = typeof estado === "string" ? estado : JSON.stringify(estado ?? "");
    const truncado = texto.length > MAX_ESTADO_CHARS;
    if (truncado) texto = `${texto.slice(0, MAX_ESTADO_CHARS)}\n[texto truncado]`;
    if (!texto.trim()) return vazio("estado vazio");

    return naFila(async () => {
      const t0 = performance.now();
      const { json, erro } = await postar({ model: modelo, state: texto, questions }, timeoutMs);
      const latenciaMs = Math.round(performance.now() - t0);
      if (erro || !json || typeof json !== "object") {
        const motivo = erro || "resposta sem corpo JSON";
        log(`chamada falhou: ${motivo}`);
        return vazio(motivo, { latenciaMs, truncado });
      }

      const respostas = {};
      for (const id of ids) {
        const r = questions[id] ? lerResposta(questions[id], json.answers?.[id]) : null;
        if (questions[id] && r == null) log(`resposta de "${id}" descartada: fora do que foi perguntado`);
        respostas[id] = r;
      }

      const entrada = Number(json.usage?.input_tokens);
      const saida = Number(json.usage?.output_tokens);
      const tokens = Number.isFinite(entrada) ? { entrada, saida: Number.isFinite(saida) ? saida : 0 } : null;
      const cost = Number(json.usage?.cost);
      const custoUsd = Number.isFinite(cost) ? cost : tokens ? tokens.entrada * USD_POR_TOKEN_ENTRADA : null;

      return { respostas, latenciaMs, tokens, custoUsd, truncado, modelo: json.model ?? null, erro: null };
    });
  }

  return { avaliar };
}

const padrao = criarClienteJev();
export const avaliar = padrao.avaliar;
