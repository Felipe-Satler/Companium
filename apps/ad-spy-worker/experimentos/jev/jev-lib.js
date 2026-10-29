/**
 * Experimento JEV — a parte pura, sem rede nem banco (testada em src/test/jevExperimento.test.ts).
 *
 * O JEV (TypeSafe AI, servido pelo AI Gateway da Vercel) não escreve texto: recebe um texto e
 * perguntas fechadas e devolve só a resposta, com probabilidade. O experimento quer saber três
 * coisas antes de qualquer peça dele entrar na Mineração:
 *
 *   1. ele entende anúncio de saúde em português?        -> `comparar` contra rótulos humanos
 *   2. a probabilidade dele quer dizer alguma coisa?      -> acerto por faixa de confiança
 *   3. alguma característica do texto acompanha os anúncios que DURAM? -> `longevidade`
 *
 * A 3 é a pergunta que interessa: a nota composta da página que inspirou isto
 * (0,40 especificidade + 0,35 mostra resultado + 0,25 prova) é palpite do autor. Aqui os pesos
 * se medem contra o sinal de desempenho que nós já temos.
 */

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------------------------

const MAX_TRANSCRICAO = 6000;

/** Texto normalizado para achar cópias: o mesmo criativo replicado não pode contar como N anúncios. */
export function normalizarTexto(t) {
  return String(t || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export const hash = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

/** O que o JEV lê de um anúncio: copy, título e transcrição — rotulados, porque o gancho mora em lugares diferentes. */
export function estadoDoAnuncio(ad) {
  const partes = [];
  if (ad.title) partes.push(`Título: ${String(ad.title).trim()}`);
  if (ad.ad_copy) partes.push(`Texto do anúncio: ${String(ad.ad_copy).trim()}`);
  if (ad.transcript) {
    const t = String(ad.transcript).trim();
    partes.push(`Transcrição do vídeo: ${t.length > MAX_TRANSCRICAO ? `${t.slice(0, MAX_TRANSCRICAO)} […]` : t}`);
  }
  return partes.join("\n\n");
}

/**
 * Peças com texto, sem cópias. Cópias viram UMA entrada que guarda os ids e o MAIOR tempo no ar
 * entre elas — o criativo sobreviveu tanto quanto a cópia que mais durou.
 */
export function deduplicar(ads) {
  const porChave = new Map();
  let semTexto = 0;
  for (const ad of ads) {
    const estado = estadoDoAnuncio(ad);
    const norm = normalizarTexto(estado);
    if (norm.length < 20) {
      semTexto += 1;
      continue;
    }
    const chave = hash(norm);
    const atual = porChave.get(chave);
    if (atual) {
      atual.ids.push(ad.id);
      if (Number.isFinite(ad.days_running) && !(atual.dias >= ad.days_running)) atual.dias = ad.days_running;
      continue;
    }
    porChave.set(chave, {
      chave,
      ids: [ad.id],
      fonte: ad.source || "meta",
      anunciante: ad.page_name || null,
      // Id da página na Biblioteca: é ele, e não o nome, que agrupa por anunciante.
      pagina: ad.page_id ? String(ad.page_id) : null,
      dias: Number.isFinite(ad.days_running) ? ad.days_running : null,
      ativo: typeof ad.is_active === "boolean" ? ad.is_active : null,
      replicacao: Number.isFinite(ad.collation_count) ? ad.collation_count : null,
      engajamento: Number.isFinite(ad.metrics?.engagementRate) ? ad.metrics.engagementRate : null,
      temTranscricao: Boolean(ad.transcript && String(ad.transcript).trim()),
      estado,
    });
  }
  return { pecas: [...porChave.values()], semTexto };
}

// ---------------------------------------------------------------------------------------------
// Perguntas
// ---------------------------------------------------------------------------------------------

/** Confere o perguntas.json antes de gastar: um erro de formato custaria uma rodada inteira. */
export function validarPerguntas(p) {
  const erros = [];
  const qs = p?.perguntas;
  if (!qs || typeof qs !== "object" || !Object.keys(qs).length) erros.push("`perguntas` vazio");
  for (const [nome, q] of Object.entries(qs || {})) {
    if (!/^[a-z0-9_]+$/.test(nome)) erros.push(`${nome}: use só a-z, 0-9 e _`);
    if (!["boolean", "choice", "score"].includes(q?.type)) erros.push(`${nome}: type inválido`);
    if (!q?.instructions) erros.push(`${nome}: falta instructions`);
    if (q?.type === "choice" && (!q.criteria || Object.keys(q.criteria).length < 2)) {
      erros.push(`${nome}: choice precisa de 2+ opções em criteria`);
    }
    if (q?.type === "score" && (!Array.isArray(q.criteria) || q.criteria.length < 2)) {
      erros.push(`${nome}: score precisa de 2+ níveis em criteria`);
    }
  }
  for (const [nome, peso] of Object.entries(p?.nota?.pesos || {})) {
    if (!qs?.[nome]) erros.push(`nota.pesos.${nome}: pergunta inexistente`);
    else if (qs[nome].type === "choice") erros.push(`nota.pesos.${nome}: choice não entra na nota (não tem ordem)`);
    if (!Number.isFinite(peso)) erros.push(`nota.pesos.${nome}: peso não numérico`);
  }
  return erros;
}

/** As perguntas no formato da API (sem os campos só nossos). */
export function perguntasParaApi(p) {
  const out = {};
  for (const [nome, q] of Object.entries(p.perguntas)) {
    out[nome] = { type: q.type, instructions: q.instructions, ...(q.criteria ? { criteria: q.criteria } : {}) };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Chamadas
// ---------------------------------------------------------------------------------------------

/** Erros que valem nova tentativa: limite de taxa e indisponibilidade passageira. */
export const TRANSITORIO = new Set([429, 500, 502, 503, 504]);

/**
 * Quanto esperar antes da tentativa `n` (0 = primeira repetição). Respeita o Retry-After quando o
 * servidor manda; senão, exponencial com jitter, para 8 chamadas paralelas não voltarem juntas.
 */
export function esperaMs(n, retryAfter, aleatorio = Math.random, agora = Date.now()) {
  // Ausente chega como null, e Number(null) é 0: sem esta guarda, "sem cabeçalho" virava "tente já",
  // e as 8 chamadas paralelas voltavam todas juntas em cima do limite.
  const bruto = retryAfter === null || retryAfter === undefined ? "" : String(retryAfter).trim();
  if (bruto) {
    const seg = Number(bruto);
    if (Number.isFinite(seg) && seg >= 0) return Math.min(60_000, seg * 1000);
    // O HTTP também permite uma data ("Wed, 21 Oct 2026 07:28:00 GMT").
    const quando = Date.parse(bruto);
    if (Number.isFinite(quando)) return Math.min(60_000, Math.max(0, quando - agora));
  }
  const base = Math.min(30_000, 500 * 2 ** n);
  return Math.round(base / 2 + aleatorio() * (base / 2));
}

/** Executa `fn` sobre os itens com no máximo `limite` em paralelo, na ordem de chegada. */
export async function emParalelo(itens, limite, fn) {
  const resultados = new Array(itens.length);
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < itens.length) {
      const i = proximo++;
      resultados[i] = await fn(itens[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, trabalhador));
  return resultados;
}

/**
 * Uma resposta da API -> valores comparáveis por pergunta:
 *   boolean -> probabilidade de "sim" (0..1)
 *   choice  -> a opção escolhida + a probabilidade dela
 *   score   -> nota normalizada 0..1 (score / (níveis - 1)) + a nota crua
 */
export function lerRespostas(answers, perguntas) {
  const out = {};
  for (const [nome, q] of Object.entries(perguntas)) {
    const a = answers?.[nome];
    if (!a) {
      out[nome] = null;
      continue;
    }
    if (q.type === "boolean") {
      out[nome] = { tipo: "boolean", p: Number(a.probability) };
    } else if (q.type === "choice") {
      const probs = a.probabilities || {};
      out[nome] = { tipo: "choice", escolha: a.choice, p: Number(probs[a.choice] ?? NaN), probs };
    } else {
      const niveis = q.criteria.length;
      const score = Number(a.score);
      const probs = a.probabilities || {};
      // Sem semente NaN: Math.max(..., NaN) é sempre NaN, e a confiança das notas sumia.
      const ps = Object.values(probs).map(Number).filter(Number.isFinite);
      const top = ps.length ? Math.max(...ps) : NaN;
      out[nome] = { tipo: "score", score, norm: score / (niveis - 1), p: top };
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Nota, comparação, longevidade
// ---------------------------------------------------------------------------------------------

/** Nota composta (pesos do perguntas.json), sobre 0..1. Pergunta sem resposta conta 0 — e é contada. */
export function notaComposta(respostas, pesos) {
  let soma = 0;
  let total = 0;
  let faltando = 0;
  for (const [nome, peso] of Object.entries(pesos)) {
    total += peso;
    const r = respostas[nome];
    const v = r?.tipo === "boolean" ? r.p : r?.tipo === "score" ? r.norm : NaN;
    if (Number.isFinite(v)) soma += peso * v;
    else faltando += 1;
  }
  return { nota: total ? soma / total : 0, faltando };
}

/**
 * Top N por nota, sem textos repetidos. A deduplicação já aconteceu no corpus; aqui é a segunda
 * barreira, para quem chamar com peças de outra fonte.
 */
export function topN(pecas, n = 10) {
  const vistas = new Set();
  return [...pecas]
    .sort((a, b) => b.nota - a.nota)
    .filter((p) => {
      const k = normalizarTexto(p.estado);
      if (vistas.has(k)) return false;
      vistas.add(k);
      return true;
    })
    .slice(0, n);
}

/** Resposta humana do gabarito -> o mesmo formato comparável. "" = não rotulado. */
export function lerRotuloHumano(valor, q) {
  const v = String(valor ?? "").trim().toLowerCase();
  if (!v) return null;
  if (q.type === "boolean") {
    if (["sim", "s", "1", "true", "yes"].includes(v)) return true;
    if (["nao", "não", "n", "0", "false", "no"].includes(v)) return false;
    return undefined;
  }
  if (q.type === "choice") return Object.keys(q.criteria).includes(v) ? v : undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n < q.criteria.length ? n : undefined;
}

/** O JEV concorda com o humano? Boolean corta em 0,5; score arredonda para o nível mais perto. */
export function concorda(jev, humano, q) {
  if (!jev || humano === null || humano === undefined) return null;
  if (q.type === "boolean") return jev.p >= 0.5 === humano;
  if (q.type === "choice") return jev.escolha === humano;
  return Math.round(jev.score) === humano;
}

/** Faixas de confiança: a probabilidade do JEV significa acerto? (calibração grosseira) */
export const FAIXAS = [
  [0.5, 0.7],
  [0.7, 0.9],
  [0.9, 1.0001],
];

/** Confiança na resposta dada: no boolean, a distância do 0,5 (p=0,1 é confiante no "não"). */
export const confianca = (r) => (r?.tipo === "boolean" ? Math.max(r.p, 1 - r.p) : r?.p);

/** Correlação de Pearson; null com menos de 3 pares ou variância zero. */
export function correlacao(xs, ys) {
  const pares = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (pares.length < 3) return null;
  const mx = pares.reduce((s, [x]) => s + x, 0) / pares.length;
  const my = pares.reduce((s, [, y]) => s + y, 0) / pares.length;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of pares) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

export const media = (xs) => {
  const v = xs.filter(Number.isFinite);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

// ---------------------------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------------------------

const celula = (v) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const linhaCsv = (valores) => valores.map(celula).join(",");

/**
 * CSV simples com aspas — o suficiente para ler de volta o gabarito exportado por nós mesmos.
 *
 * O separador vem do cabeçalho: nós gravamos com vírgula, mas o Excel em português salva com
 * ponto e vírgula, e aí as vírgulas DENTRO do texto do anúncio vêm sem aspas. Tratar os dois como
 * separador ao mesmo tempo quebraria esses textos em colunas.
 */
export function lerCsv(texto) {
  texto = String(texto).replace(/^\uFEFF/, "");
  const cabecalho = texto.slice(0, texto.search(/\r?\n|$/));
  const sep = (cabecalho.match(/;/g) || []).length > (cabecalho.match(/,/g) || []).length ? ";" : ",";
  const linhas = [];
  let campo = "";
  let linha = [];
  let aspas = false;
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') {
        campo += '"';
        i += 1;
      } else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) {
      linha.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i += 1;
      linha.push(campo);
      if (linha.some((x) => x !== "")) linhas.push(linha);
      linha = [];
      campo = "";
    } else campo += c;
  }
  linha.push(campo);
  if (linha.some((x) => x !== "")) linhas.push(linha);
  const [cab, ...resto] = linhas;
  return resto.map((l) => Object.fromEntries(cab.map((h, i) => [h.trim(), l[i] ?? ""])));
}

// ---------------------------------------------------------------------------------------------
// Rótulos de referência por um modelo de linguagem (rotular-llm) e revisão das discordâncias
// ---------------------------------------------------------------------------------------------

/**
 * O JSON Schema que restringe a resposta do modelo às MESMAS opções do gabarito humano.
 *
 * Nota vira string ("0", "1", "2") e não inteiro: a saída estruturada aceita enum de string com
 * segurança, e o gabarito guarda texto de qualquer jeito.
 */
export function esquemaRotulos(perguntas) {
  const properties = {};
  for (const [nome, q] of Object.entries(perguntas)) {
    if (q.type === "boolean") properties[nome] = { type: "boolean" };
    else if (q.type === "choice") properties[nome] = { type: "string", enum: Object.keys(q.criteria) };
    else properties[nome] = { type: "string", enum: q.criteria.map((_, i) => String(i)) };
  }
  return { type: "object", additionalProperties: false, properties, required: Object.keys(perguntas) };
}

/** Resposta do modelo -> célula do gabarito (o mesmo formato que um humano escreveria). */
export function celulaDoLlm(valor, q) {
  if (q.type === "boolean") return valor === true ? "sim" : valor === false ? "não" : "";
  return valor === undefined || valor === null ? "" : String(valor);
}

/** Resposta do JEV -> célula do gabarito, para pôr lado a lado com a de referência. */
export function celulaDoJev(r, q) {
  if (!r) return "";
  if (q.type === "boolean") return r.p >= 0.5 ? "sim" : "não";
  if (q.type === "choice") return r.escolha ?? "";
  return Number.isFinite(r.score) ? String(Math.round(r.score)) : "";
}

/**
 * A decisão humana numa discordância -> a célula de referência. Aceita o valor em si ("sim",
 * "dor_direta", "2") ou os atalhos "jev" / "llm" (= concordo com aquele lado).
 * @returns {string|null|undefined} null = sem decisão; undefined = decisão inválida
 */
export function resolverDecisao(decisao, { jev, llm }, q) {
  const d = String(decisao ?? "").trim().toLowerCase();
  if (!d) return null;
  if (d === "jev") return jev;
  if (d === "llm" || d === "claude") return llm;
  return lerRotuloHumano(d, q) === undefined ? undefined : d;
}

/**
 * Uma linha de gabarito (humano ou de um modelo) -> o mesmo formato de `lerRespostas`, para o
 * `longevidade --rotulos` usar outro rotulador no lugar do JEV.
 *
 * A pergunta do `longevidade` (o texto acompanha os anúncios que duram?) não depende de QUEM
 * rotulou: dá para testar a ideia antes de pagar pelo JEV. O rótulo é certo ou errado, então a
 * "probabilidade" é 1 ou 0.
 */
export function respostasDoGabarito(linha, perguntas) {
  const out = {};
  for (const [nome, q] of Object.entries(perguntas)) {
    const v = lerRotuloHumano(linha?.[nome], q);
    if (v === null || v === undefined) {
      out[nome] = null;
    } else if (q.type === "boolean") {
      out[nome] = { tipo: "boolean", p: v ? 1 : 0 };
    } else if (q.type === "choice") {
      out[nome] = { tipo: "choice", escolha: v, p: 1, probs: { [v]: 1 } };
    } else {
      out[nome] = { tipo: "score", score: v, norm: v / (q.criteria.length - 1), p: 1 };
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Comparação dentro do mesmo anunciante
// ---------------------------------------------------------------------------------------------

/** Mediana; null sem amostra. */
export function mediana(xs) {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * Criativos longos x curtos DENTRO de cada anunciante, depois combinados.
 *
 * Por que dentro: entre anunciantes, quem roda mais tempo é quem tem mais verba ou outro segmento,
 * e o texto vira sintoma disso (no corpus de 66 peças, "tem oferta" separava ótica de oftalmologista,
 * não anúncio bom de ruim). Dentro de um anunciante, verba, segmento e público ficam quase fixos.
 *
 * Desfecho, por anunciante, a partir da mediana de vida dos criativos que JÁ TERMINARAM (inativos):
 *   longo = vida ≥ mediana (inativo, ou ativo que já passou dela — esse sobreviveu de fato)
 *   curto = inativo com vida < mediana
 *   fora  = ativo ainda abaixo da mediana: o desfecho dele não é conhecido
 *
 * Por sinal: a diferença de médias (longos − curtos) em cada anunciante, combinada com peso
 * min(longos, curtos) — um anunciante com 1 criativo de cada lado pesa pouco —, e em quantos
 * anunciantes o sinal aponta para cada lado. Um efeito real tende a aparecer em vários anunciantes;
 * um que vem de um anunciante só é anedota dele.
 *
 * @param pecas  [{ pagina, anunciante, dias, ativo, ... }]
 * @param sinais [{ rotulo, valor: (peca) => number|NaN }]
 * @param o      { minTerminados = 3 }
 */
export function comparacaoPorAnunciante(pecas, sinais, { minTerminados = 3 } = {}) {
  const grupos = new Map();
  for (const x of pecas) {
    const k = x.pagina || x.anunciante || "?";
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(x);
  }
  const anunciantes = [];
  for (const [k, xs] of grupos) {
    const terminados = xs.filter((x) => x.ativo === false && Number.isFinite(x.dias));
    if (terminados.length < minTerminados) continue;
    const corte = mediana(terminados.map((x) => x.dias));
    const longos = xs.filter((x) => Number.isFinite(x.dias) && x.dias >= corte);
    const curtos = terminados.filter((x) => x.dias < corte);
    if (!longos.length || !curtos.length) continue;
    anunciantes.push({ chave: k, nome: xs[0].anunciante || k, total: xs.length, terminados: terminados.length, corte, longos, curtos });
  }
  const resultados = sinais.map(({ rotulo, valor }) => {
    let soma = 0;
    let pesos = 0;
    let positivos = 0;
    let negativos = 0;
    for (const a of anunciantes) {
      const ml = media(a.longos.map(valor));
      const mc = media(a.curtos.map(valor));
      if (ml === null || mc === null) continue;
      const d = ml - mc;
      const w = Math.min(a.longos.length, a.curtos.length);
      soma += w * d;
      pesos += w;
      if (d > 0) positivos += 1;
      else if (d < 0) negativos += 1;
    }
    return { rotulo, diferenca: pesos ? soma / pesos : null, positivos, negativos };
  });
  return { anunciantes, resultados };
}
