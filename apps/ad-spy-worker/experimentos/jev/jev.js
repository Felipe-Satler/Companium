#!/usr/bin/env node
/**
 * Experimento JEV sobre o corpus da Mineração. Ver README.md desta pasta.
 *
 *   node jev.js anunciantes  --run <id> [--run <id>…]        (lista page_id e nome, para escolher)
 *   node jev.js exportar     --biblioteca <id> | --run <id> | --anunciante <page_id> [--paginas 3] [--max-creditos 40]
 *   node jev.js classificar  [--simular] [--max-usd 0.50] [--amostra N] [--zdr]
 *   node jev.js gabarito     [--n 25]
 *   node jev.js rotular-llm  [--simular] [--modelo-llm anthropic/claude-opus-5.5] [--esforco high]
 *   node jev.js comparar     [--gabarito saida/gabarito.csv]
 *   node jev.js longevidade  [--limiar 30] [--rotulos saida/gabarito-claude.csv] [--por-anunciante]
 *   node jev.js ranking      [--top 10]
 *
 * A chave vem do ambiente (AI_GATEWAY_API_KEY), nunca do código. `exportar` lê o banco e precisa
 * do SUPABASE_SERVICE_KEY do spy.env; os outros comandos trabalham sobre saida/corpus.json e rodam
 * em qualquer máquina.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FAIXAS,
  celulaDoJev,
  resolverDecisao,
  TRANSITORIO,
  concorda,
  confianca,
  comparacaoPorAnunciante,
  correlacao,
  deduplicar,
  emParalelo,
  esperaMs,
  hash,
  lerCsv,
  lerRespostas,
  lerRotuloHumano,
  respostasDoGabarito,
  linhaCsv,
  media,
  notaComposta,
  perguntasParaApi,
  topN,
  validarPerguntas,
} from "./jev-lib.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
// Sobrescrevível só para testar o fluxo contra um servidor falso, sem gastar crédito.
const ENDPOINT = process.env.JEV_ENDPOINT || "https://ai-gateway.vercel.sh/v1/evaluate";
const PARALELO = 8;
const MAX_TENTATIVAS = 6;
// US$ por milhão de tokens de entrada (saída grátis). Só para a estimativa do --simular; o gasto
// real vem do `providerMetadata.gateway.cost` de cada resposta.
const PRECO_ENTRADA = 0.042;

// ---------------------------------------------------------------------------------------------
// Argumentos e arquivos
// ---------------------------------------------------------------------------------------------

function args(argv) {
  const [cmd, ...resto] = argv;
  const o = { _: cmd, biblioteca: [], run: [], anunciante: [] };
  for (let i = 0; i < resto.length; i += 1) {
    const a = resto[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const v = resto[i + 1] && !resto[i + 1].startsWith("--") ? resto[(i += 1)] : true;
    if (Array.isArray(o[k])) o[k].push(v);
    else o[k] = v;
  }
  return o;
}

const opt = args(process.argv.slice(2));
const SAIDA = path.resolve(opt.saida || path.join(AQUI, "saida"));
const arq = (nome) => path.join(SAIDA, nome);
const CORPUS = arq("corpus.json");
const CACHE = arq("respostas.jsonl");

function lerJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

function carregarPerguntas() {
  const p = lerJson(path.resolve(opt.perguntas || path.join(AQUI, "perguntas.json")));
  const erros = validarPerguntas(p);
  if (erros.length) {
    console.error(`perguntas.json inválido:\n  - ${erros.join("\n  - ")}`);
    process.exit(1);
  }
  return p;
}

function carregarCorpus() {
  if (!existsSync(CORPUS)) {
    console.error(`Sem ${CORPUS}. Rode antes: node jev.js exportar --biblioteca <id>`);
    process.exit(1);
  }
  return lerJson(CORPUS);
}

/** respostas.jsonl -> Map(chave -> registro), só das perguntas atuais (hash do conjunto). */
function carregarCache(perguntasHash) {
  const m = new Map();
  if (!existsSync(CACHE)) return m;
  for (const linha of readFileSync(CACHE, "utf8").split("\n")) {
    if (!linha.trim()) continue;
    try {
      const r = JSON.parse(linha);
      if (r.perguntasHash === perguntasHash) m.set(r.chave, r);
    } catch {
      // linha cortada por um Ctrl+C no meio da escrita: ignora, a peça é refeita
    }
  }
  return m;
}

const fmtUsd = (n) => `US$ ${n.toFixed(n < 0.01 ? 5 : 3)}`;
const pct = (n) => (n === null || n === undefined ? "—" : `${(n * 100).toFixed(0)}%`);

// ---------------------------------------------------------------------------------------------
// exportar
// ---------------------------------------------------------------------------------------------

async function exportar() {
  if (!opt.biblioteca.length && !opt.run.length && !opt.anunciante.length && !opt.arquivo) {
    console.error("Informe --biblioteca ID, --run ID, --anunciante PAGE_ID ou --arquivo corpus.json.");
    process.exit(1);
  }
  let ads = [];
  if (opt.arquivo) {
    // Aceita linhas do ad_spy_ads ou o formato mínimo {id, texto}.
    ads = lerJson(path.resolve(opt.arquivo)).map((a) => (a.texto && !a.ad_copy ? { ...a, ad_copy: a.texto } : a));
  }
  if (opt.biblioteca.length || opt.run.length) {
    // Import tardio: quem só usa --arquivo não precisa do SUPABASE_SERVICE_KEY.
    const db = await import("../../db.js");
    if (!db.dbEnabled()) {
      console.error("SUPABASE_SERVICE_KEY ausente. Rode com: node --env-file=../../spy.env jev.js exportar …");
      process.exit(1);
    }
    for (const id of opt.biblioteca) {
      const e = await db.getLibraryEntry(id);
      if (!e) console.error(`biblioteca ${id}: não encontrada`);
      else {
        console.log(`biblioteca ${id} ("${e.titulo || e.tema}"): ${(e.ads || []).length} anúncio(s)`);
        ads.push(...(e.ads || []));
      }
    }
    for (const id of opt.run) {
      const rows = await db.listAds(id);
      console.log(`busca ${id}: ${rows.length} anúncio(s)`);
      ads.push(...rows);
    }
  }
  if (opt.anunciante.length) ads.push(...(await anunciosDosAnunciantes()));
  const { pecas, semTexto } = deduplicar(ads);
  mkdirSync(SAIDA, { recursive: true });
  writeFileSync(CORPUS, JSON.stringify(pecas, null, 2));
  const comDias = pecas.filter((p) => Number.isFinite(p.dias)).length;
  console.log(
    `\n${pecas.length} peça(s) com texto, sem cópias (de ${ads.length} anúncio(s); ${semTexto} sem texto ` +
      `ficaram de fora — o JEV só lê texto). ${comDias} com dias no ar, ` +
      `${pecas.filter((p) => p.temTranscricao).length} com transcrição.\n-> ${CORPUS}`
  );
}

/**
 * Todos os anúncios (ativos E inativos) de cada --anunciante, pela rota "Company Ads" da Scrape
 * Creators: 1 crédito por página. Dois tetos, porque um anunciante grande tem centenas de
 * anúncios: --paginas por anunciante (padrão 3) e --max-creditos no total (padrão 40).
 *
 * A rota ordena por impressões, então um anunciante cortado no teto chega com os anúncios mais
 * vistos primeiro. O resumo diz quem foi cortado — para não tomar uma amostra parcial por inteira.
 */
async function anunciosDosAnunciantes() {
  const meta = await import("../../sources/meta-scrapecreators.js");
  if (!meta.available) {
    console.error("SCRAPECREATORS_API_KEY ausente. Rode com: node --env-file=../../spy.env jev.js exportar …");
    process.exit(1);
  }
  const porAnunciante = Number(opt.paginas || 3);
  const teto = Number(opt["max-creditos"] || 40);
  let creditos = 0;
  const linhas = [];
  for (const pageId of opt.anunciante) {
    if (!/^\d{5,}$/.test(String(pageId))) {
      console.error(`--anunciante ${pageId}: use o page_id numérico (o comando "anunciantes" lista).`);
      continue;
    }
    let cursor = null;
    let paginas = 0;
    let n = 0;
    let nome = null;
    do {
      if (creditos >= teto) break;
      const pg = await meta.fetchCompanyPage(pageId, cursor, { log: () => {} });
      creditos += pg.credits;
      paginas += 1;
      cursor = pg.cursor;
      for (const a of pg.ads) {
        nome = nome || a.pageName;
        n += 1;
        // O formato de linha do ad_spy_ads, que é o que o deduplicar lê.
        linhas.push({
          id: `fb-${a.externalId}`,
          source: "meta",
          page_name: a.pageName,
          page_id: a.pageId || String(pageId),
          ad_copy: a.adCopy,
          title: a.title,
          transcript: null,
          days_running: a.daysRunning,
          is_active: a.isActive,
          collation_count: a.collationCount,
          metrics: a.metrics,
        });
      }
    } while (cursor && paginas < porAnunciante);
    const inativos = linhas.filter((l) => l.page_id === String(pageId) && l.is_active === false).length;
    console.log(
      `anunciante ${pageId} (${nome || "?"}): ${n} anúncio(s), ${inativos} inativo(s), ${paginas} página(s)` +
        (cursor ? " — CORTADO no teto de páginas: há mais anúncios" : "")
    );
    if (creditos >= teto) {
      console.log(`Teto de ${teto} crédito(s) atingido (--max-creditos). Anunciantes seguintes ficaram de fora.`);
      break;
    }
  }
  console.log(`Scrape Creators: ${creditos} crédito(s) nesta exportação.`);
  return linhas;
}

/** Os anunciantes de uma ou mais buscas, com o page_id — para escolher quem exportar. */
async function anunciantes() {
  if (!opt.run.length) {
    console.error("Informe --run ID (o comando de listar buscas mostra os ids).");
    process.exit(1);
  }
  const db = await import("../../db.js");
  if (!db.dbEnabled()) {
    console.error("SUPABASE_SERVICE_KEY ausente. Rode com: node --env-file=../../spy.env jev.js anunciantes …");
    process.exit(1);
  }
  const porPagina = new Map();
  for (const id of opt.run) {
    for (const a of await db.listAds(id)) {
      if (!a.page_id) continue;
      const x = porPagina.get(a.page_id) || { nome: a.page_name, n: 0 };
      x.n += 1;
      porPagina.set(a.page_id, x);
    }
  }
  const lista = [...porPagina.entries()].sort((a, b) => b[1].n - a[1].n);
  for (const [pid, x] of lista) console.log(`${pid.padEnd(18)} ${String(x.n).padStart(3)} na busca  ${x.nome}`);
  console.log(`\n${lista.length} anunciante(s). Copie os page_id de quem é do MESMO nicho para o exportar --anunciante.`);
}

// ---------------------------------------------------------------------------------------------
// classificar
// ---------------------------------------------------------------------------------------------

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function chamarJev(chave, corpo) {
  for (let n = 0; ; n += 1) {
    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      // Rede ou timeout: transitório como um 503.
      if (n + 1 >= MAX_TENTATIVAS) throw err;
      await dormir(esperaMs(n));
      continue;
    }
    if (res.ok) return res.json();
    const texto = (await res.text().catch(() => "")).slice(0, 300);
    if (TRANSITORIO.has(res.status) && n + 1 < MAX_TENTATIVAS) {
      const ms = esperaMs(n, res.headers.get("retry-after"));
      process.stderr.write(`  ${res.status}, nova tentativa em ${(ms / 1000).toFixed(1)}s\n`);
      await dormir(ms);
      continue;
    }
    const err = new Error(`AI Gateway ${res.status}: ${texto}`);
    err.status = res.status;
    throw err;
  }
}

async function classificar() {
  const p = carregarPerguntas();
  const questions = perguntasParaApi(p);
  const perguntasHash = hash(JSON.stringify(questions) + (opt.modelo || "typesafe-ai/jev"));
  let pecas = carregarCorpus();
  if (opt.amostra) pecas = pecas.slice(0, Number(opt.amostra));

  const cache = carregarCache(perguntasHash);
  const falta = pecas.filter((x) => !cache.has(x.chave));
  const caracteres = falta.reduce((s, x) => s + x.estado.length, 0);
  // ~3,5 caracteres por token em português, mais ~40 tokens por pergunta de instrução/critérios.
  const tokensEst = Math.round(caracteres / 3.5 + falta.length * Object.keys(questions).length * 40);
  const usdEst = (tokensEst / 1e6) * PRECO_ENTRADA;
  console.log(
    `${pecas.length} peça(s); ${cache.size} já classificada(s) com estas perguntas; ${falta.length} a classificar.\n` +
      `Estimativa: ~${tokensEst.toLocaleString("pt-BR")} tokens de entrada ≈ ${fmtUsd(usdEst)}.`
  );
  if (opt.simular || !falta.length) {
    if (falta.length) console.log("(--simular: nenhuma chamada feita)");
    return escreverRotulos(pecas, cache, p);
  }

  const chave = process.env.AI_GATEWAY_API_KEY;
  if (!chave) {
    console.error("AI_GATEWAY_API_KEY ausente no ambiente. Ex.: node --env-file=.env jev.js classificar");
    process.exit(1);
  }
  const teto = Number(opt["max-usd"] ?? 0.5);
  let gasto = 0;
  let feitas = 0;
  let erros = 0;
  let parou = false;

  await emParalelo(falta, PARALELO, async (peca) => {
    if (parou) return;
    if (gasto >= teto) {
      parou = true;
      return;
    }
    const corpo = {
      model: opt.modelo || "typesafe-ai/jev",
      state: peca.estado,
      questions,
      providerOptions: {
        // `only`: sem isso, uma regra de fallback do time poderia responder com um modelo de
        // linguagem — e o experimento mediria outra coisa sem avisar.
        gateway: { only: ["typesafe-ai"], ...(opt.zdr ? { zeroDataRetention: true } : {}) },
      },
    };
    try {
      const r = await chamarJev(chave, corpo);
      const custo = Number(r?.providerMetadata?.gateway?.cost ?? 0);
      gasto += Number.isFinite(custo) ? custo : 0;
      const registro = {
        chave: peca.chave,
        perguntasHash,
        modelo: r.model,
        answers: r.answers,
        usage: r.usage,
        custo,
        em: new Date().toISOString(),
      };
      // Uma linha por resposta, gravada na hora: um Ctrl+C no meio não perde o que já foi pago.
      appendFileSync(CACHE, `${JSON.stringify(registro)}\n`);
      cache.set(peca.chave, registro);
      feitas += 1;
      if (feitas % 25 === 0) console.log(`  ${feitas}/${falta.length} · ${fmtUsd(gasto)}`);
    } catch (err) {
      erros += 1;
      console.error(`  peça ${peca.chave}: ${err.message}`);
      // Chave inválida ou sem crédito não melhora tentando as outras 500.
      if (err.status === 401 || err.status === 402 || err.status === 403) parou = true;
    }
  });

  console.log(
    `\n${feitas} classificada(s), ${erros} erro(s), gasto ${fmtUsd(gasto)}` +
      (parou && gasto >= teto ? ` — PAROU no teto de ${fmtUsd(teto)} (--max-usd)` : "") +
      (parou && gasto < teto ? " — PAROU por erro de autenticação/crédito" : "")
  );
  escreverRotulos(pecas, cache, p);
}

function escreverRotulos(pecas, cache, p) {
  const nomes = Object.keys(p.perguntas);
  const pesos = p.nota?.pesos || {};
  const linhas = [
    linhaCsv(["chave", "fonte", "anunciante", "dias", "ativo", "copias", "nota", ...nomes, "texto"]),
  ];
  for (const peca of pecas) {
    const r = cache.get(peca.chave);
    if (!r) continue;
    const resp = lerRespostas(r.answers, p.perguntas);
    const { nota } = notaComposta(resp, pesos);
    linhas.push(
      linhaCsv([
        peca.chave,
        peca.fonte,
        peca.anunciante,
        peca.dias,
        peca.ativo,
        peca.ids.length,
        nota.toFixed(3),
        ...nomes.map((n) => {
          const x = resp[n];
          if (!x) return "";
          if (x.tipo === "boolean") return x.p.toFixed(2);
          if (x.tipo === "choice") return `${x.escolha} (${x.p.toFixed(2)})`;
          return x.score.toFixed(2);
        }),
        peca.estado.slice(0, 500),
      ])
    );
  }
  mkdirSync(SAIDA, { recursive: true });
  writeFileSync(arq("rotulos.csv"), `${linhas.join("\n")}\n`);
  console.log(`-> ${arq("rotulos.csv")} (${linhas.length - 1} linha(s))`);
}

// ---------------------------------------------------------------------------------------------
// gabarito e comparar
// ---------------------------------------------------------------------------------------------

/** Embaralhamento determinístico: rodar duas vezes gera o mesmo gabarito. */
function embaralhar(lista, semente = 42) {
  let s = semente;
  const rand = () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function gabarito() {
  const p = carregarPerguntas();
  const pecas = embaralhar(carregarCorpus()).slice(0, Number(opt.n || 25));
  const nomes = Object.keys(p.perguntas);
  const destino = arq("gabarito.csv");
  if (existsSync(destino) && !opt.sobrescrever) {
    console.error(`${destino} já existe (talvez já rotulado). Use --sobrescrever para gerar de novo.`);
    process.exit(1);
  }
  const linhas = [linhaCsv(["chave", "fonte", "texto", ...nomes])];
  for (const x of pecas) linhas.push(linhaCsv([x.chave, x.fonte, x.estado, ...nomes.map(() => "")]));
  writeFileSync(destino, `﻿${linhas.join("\n")}\n`);

  // As respostas aceitas, num arquivo à parte para não poluir a planilha.
  const leia = nomes.map((n) => {
    const q = p.perguntas[n];
    const aceitos =
      q.type === "boolean"
        ? "sim | não"
        : q.type === "choice"
          ? Object.entries(q.criteria).map(([k, v]) => `${k} (${v})`).join("\n      ")
          : q.criteria.map((c, i) => `${i} = ${c}`).join("\n      ");
    return `${n}: ${q.instructions}\n      ${aceitos}`;
  });
  writeFileSync(
    arq("gabarito-LEIA.txt"),
    "Preencha cada coluna SEM olhar o rotulos.csv — o gabarito vale porque é às cegas.\n" +
      "Célula vazia = não rotulado (não conta). Respostas aceitas:\n\n" +
      `${leia.join("\n\n")}\n`
  );
  console.log(`-> ${destino}\n-> ${arq("gabarito-LEIA.txt")}\n${pecas.length} peça(s) para rotular à mão.`);
}

/**
 * JEV contra a referência do gabarito (humana, do Claude, ou as duas).
 *
 * Com rótulos do Claude, concordar não prova acerto. Por isso cada discordância vai para
 * saida/discordancias.csv, com uma coluna `voce_decide`: preenchida (o valor certo, ou "jev" /
 * "llm"), ela vira a referência daquela célula na próxima rodada. O que se decide nunca é
 * apagado ao regravar o arquivo.
 */
function comparar() {
  const p = carregarPerguntas();
  const perguntasHash = hash(JSON.stringify(perguntasParaApi(p)) + (opt.modelo || "typesafe-ai/jev"));
  const cache = carregarCache(perguntasHash);
  const linhas = lerCsv(readFileSync(path.resolve(opt.gabarito || arq("gabarito.csv")), "utf8"));
  const porLlm = linhas.filter((l) => l._rotulado_por).length;

  // Decisões já tomadas, por chave|pergunta.
  const arqDisc = arq("discordancias.csv");
  const decisoes = new Map();
  if (existsSync(arqDisc)) {
    for (const d of lerCsv(readFileSync(arqDisc, "utf8"))) {
      if (String(d.voce_decide ?? "").trim()) decisoes.set(`${d.chave}|${d.pergunta}`, d.voce_decide);
    }
  }

  console.log(
    `${linhas.length} linha(s) no gabarito` +
      (porLlm ? `, ${porLlm} rotulada(s) pelo Claude` : "") +
      (decisoes.size ? `; ${decisoes.size} discordância(s) já decidida(s) por você` : "") +
      ".\n"
  );

  const textoDe = new Map(linhas.map((l) => [l.chave, l.texto]));
  const pendentes = [];
  let decididasUsadas = 0;
  let llmErrou = 0;
  // Decisão que não é valor aceito nem atalho: avisada, não engolida — senão a pessoa acha que
  // decidiu e a célula continua contando pela referência antiga.
  const decisoesInvalidas = [];

  for (const [nome, q] of Object.entries(p.perguntas)) {
    const pares = [];
    const invalidos = [];
    for (const l of linhas) {
      const r = cache.get(l.chave);
      if (!r) continue;
      const jev = lerRespostas(r.answers, p.perguntas)[nome];
      const celJev = celulaDoJev(jev, q);
      const celRef = String(l[nome] ?? "").trim();
      let ref = lerRotuloHumano(celRef, q);
      if (ref === undefined) invalidos.push(celRef);
      if (ref === null || ref === undefined) continue;

      // Discordância com decisão humana: a decisão vira a referência.
      const chave = `${l.chave}|${nome}`;
      const ok0 = concorda(jev, ref, q);
      if (!ok0 && decisoes.has(chave)) {
        const dec = resolverDecisao(decisoes.get(chave), { jev: celJev, llm: celRef }, q);
        if (dec === undefined) decisoesInvalidas.push(`${l.chave} · ${nome}: "${decisoes.get(chave)}"`);
        if (dec !== null && dec !== undefined) {
          decididasUsadas += 1;
          if (l._rotulado_por && String(dec) !== celRef.toLowerCase()) llmErrou += 1;
          ref = lerRotuloHumano(dec, q);
        }
      } else if (!ok0) {
        pendentes.push({ chave: l.chave, pergunta: nome, jev: celJev, ref: celRef, origem: l._rotulado_por ? "llm" : "humano" });
      }
      pares.push({ ok: concorda(jev, ref, q), conf: confianca(jev), h: String(ref) });
    }
    if (!pares.length) {
      console.log(`${nome}: sem rótulos${invalidos.length ? ` (${invalidos.length} inválido(s): ${invalidos.slice(0, 3).join(", ")})` : ""}`);
      continue;
    }
    const acerto = pares.filter((x) => x.ok).length / pares.length;
    // Linha de base: quem responde sempre o rótulo mais comum. 90% de acerto num rótulo que é
    // "não" em 90% dos casos não diz nada.
    const freq = {};
    for (const x of pares) freq[x.h] = (freq[x.h] || 0) + 1;
    const base = Math.max(...Object.values(freq)) / pares.length;
    const faixas = FAIXAS.map(([a, b]) => {
      const f = pares.filter((x) => x.conf >= a && x.conf < b);
      return `${a.toFixed(1)}–${Math.min(b, 1).toFixed(1)}: ${f.length ? `${pct(f.filter((x) => x.ok).length / f.length)} de ${f.length}` : "—"}`;
    });
    console.log(
      `${nome.padEnd(18)} ${porLlm ? "concorda" : "acerto"} ${pct(acerto)} em ${pares.length} (chute do mais comum: ${pct(base)})` +
        `${invalidos.length ? ` · ${invalidos.length} rótulo(s) inválido(s)` : ""}\n` +
        `${"".padEnd(18)} por confiança — ${faixas.join(" · ")}`
    );
  }

  // Regrava as discordâncias: as decididas ficam (com a decisão), as novas entram em branco.
  const antigas = existsSync(arqDisc) ? lerCsv(readFileSync(arqDisc, "utf8")) : [];
  const vistas = new Set();
  const saida = [linhaCsv(["chave", "pergunta", "resposta_jev", "resposta_referencia", "origem_referencia", "voce_decide", "texto"])];
  for (const d of antigas) {
    if (!String(d.voce_decide ?? "").trim()) continue;
    vistas.add(`${d.chave}|${d.pergunta}`);
    saida.push(linhaCsv([d.chave, d.pergunta, d.resposta_jev, d.resposta_referencia, d.origem_referencia, d.voce_decide, d.texto]));
  }
  for (const d of pendentes) {
    if (vistas.has(`${d.chave}|${d.pergunta}`)) continue;
    saida.push(linhaCsv([d.chave, d.pergunta, d.jev, d.ref, d.origem, "", textoDe.get(d.chave) ?? ""]));
  }
  writeFileSync(arqDisc, `\uFEFF${saida.join("\n")}\n`);

  console.log(
    `\n${pendentes.length} discordância(s) sem decisão -> ${arqDisc}\n` +
      "Preencha `voce_decide` com o valor certo, ou \"jev\" / \"llm\" para concordar com um dos lados, e rode o comparar de novo." +
      (decididasUsadas
        ? `\n${decididasUsadas} decisão(ões) sua(s) aplicada(s)` +
          (porLlm ? `; nelas o Claude estava errado ${llmErrou} vez(es) — é a medida de quanto a referência dele é confiável.` : ".")
        : "") +
      (decisoesInvalidas.length
        ? `\n⚠ ${decisoesInvalidas.length} decisão(ões) inválida(s), ignorada(s) — use um valor do gabarito-LEIA.txt, "jev" ou "llm":\n  - ${decisoesInvalidas.join("\n  - ")}`
        : "") +
      "\n\nLeitura: concordância bem acima do chute = ele entende a pergunta em português. Acerto que SOBE com " +
      "a confiança = a probabilidade quer dizer algo. Pergunta ruim: reescreva a instrução (ver README) antes de descartá-la."
  );
}

// ---------------------------------------------------------------------------------------------
// longevidade
// ---------------------------------------------------------------------------------------------

function longevidade() {
  const p = carregarPerguntas();
  const perguntasHash = hash(JSON.stringify(perguntasParaApi(p)) + (opt.modelo || "typesafe-ai/jev"));
  const cache = carregarCache(perguntasHash);
  const limiar = Number(opt.limiar || 30);
  // --rotulos <csv>: rótulos de um gabarito (humano ou de um modelo) no lugar dos do JEV. A
  // verdade aqui é a longevidade, que vem dos dados — não importa quem rotulou o texto.
  let pecas;
  if (opt.rotulos) {
    const porChave = new Map(lerCsv(readFileSync(path.resolve(opt.rotulos), "utf8")).map((l) => [l.chave, l]));
    pecas = carregarCorpus()
      .filter((x) => porChave.has(x.chave))
      .map((x) => ({ ...x, resp: respostasDoGabarito(porChave.get(x.chave), p.perguntas) }));
    console.log(`Rótulos de ${opt.rotulos} (${porChave.size} linha(s); ${pecas.length} casaram com o corpus), não do JEV.\n`);
  } else {
    pecas = carregarCorpus()
      .filter((x) => cache.has(x.chave))
      .map((x) => ({ ...x, resp: lerRespostas(cache.get(x.chave).answers, p.perguntas) }));
  }

  if (opt["por-anunciante"]) return longevidadePorAnunciante(pecas, p);

  // Pago: "duraram" = no ar há ≥ limiar dias. "não duraram" = INATIVO com menos que isso. Ativo com
  // menos que o limiar fica de fora: ainda pode durar, e contá-lo como fracasso seria inventar.
  const pagos = pecas.filter((x) => x.fonte !== "instagram" && x.fonte !== "youtube" && Number.isFinite(x.dias));
  const duraram = pagos.filter((x) => x.dias >= limiar);
  const naoDuraram = pagos.filter((x) => x.dias < limiar && x.ativo === false);
  const organicos = pecas.filter((x) => Number.isFinite(x.engajamento));

  console.log(
    `Pagos com dias no ar: ${pagos.length} — duraram (≥${limiar}d): ${duraram.length}, ` +
      `não duraram (inativos <${limiar}d): ${naoDuraram.length}, ` +
      `${pagos.length - duraram.length - naoDuraram.length} ativos recentes fora (desfecho desconhecido).\n` +
      `Orgânicos com engajamento: ${organicos.length}.\n`
  );
  if (duraram.length < 10 || naoDuraram.length < 10) {
    console.log(
      `⚠ Grupos pequenos (menos de 10 de um lado): as diferenças abaixo são anedota, não padrão. ` +
        `Junte mais buscas no exportar — de preferência com status "Ativos e inativos".\n`
    );
  }

  const linhasCsv = [linhaCsv(["sinal", "media_duraram", "media_nao_duraram", "diferenca", "corr_log_dias", "corr_engajamento_organico"])];
  const resultados = [];
  const valorDe = (x, nome, opcao) => {
    const r = x.resp[nome];
    if (!r) return NaN;
    if (r.tipo === "boolean") return r.p;
    if (r.tipo === "score") return r.norm;
    return Number(r.probs?.[opcao] ?? (r.escolha === opcao ? 1 : 0));
  };
  for (const [nome, q] of Object.entries(p.perguntas)) {
    const opcoes = q.type === "choice" ? Object.keys(q.criteria) : [null];
    for (const opcao of opcoes) {
      const rotulo = opcao ? `${nome}=${opcao}` : nome;
      const a = media(duraram.map((x) => valorDe(x, nome, opcao)));
      const b = media(naoDuraram.map((x) => valorDe(x, nome, opcao)));
      const corrDias = correlacao(
        pagos.map((x) => valorDe(x, nome, opcao)),
        pagos.map((x) => Math.log1p(x.dias))
      );
      const corrEng = correlacao(
        organicos.map((x) => valorDe(x, nome, opcao)),
        organicos.map((x) => x.engajamento)
      );
      const dif = a !== null && b !== null ? a - b : null;
      resultados.push({ rotulo, a, b, dif, corrDias, corrEng });
      linhasCsv.push(linhaCsv([rotulo, a?.toFixed(3), b?.toFixed(3), dif?.toFixed(3), corrDias?.toFixed(3), corrEng?.toFixed(3)]));
    }
  }
  resultados.sort((x, y) => Math.abs(y.dif ?? 0) - Math.abs(x.dif ?? 0));
  const f = (n) => (n === null || n === undefined ? "  —  " : n.toFixed(2).padStart(5));
  console.log(`${"sinal".padEnd(34)} duraram  não   dif   corr(dias)  corr(engaj.)`);
  for (const r of resultados) {
    console.log(`${r.rotulo.padEnd(34)} ${f(r.a)}  ${f(r.b)}  ${f(r.dif)}  ${f(r.corrDias)}       ${f(r.corrEng)}`);
  }
  writeFileSync(arq("longevidade.csv"), `${linhasCsv.join("\n")}\n`);
  console.log(
    `\n-> ${arq("longevidade.csv")}\n` +
      "Leitura: 'dif' positiva = o sinal aparece mais nos anúncios que duraram. É correlação num " +
      "corpus pequeno, não causa — mas é medida no NOSSO nicho, ao contrário dos pesos da nota."
  );
}

/** O desenho que controla verba e segmento: longos x curtos dentro de cada anunciante. */
function longevidadePorAnunciante(pecas, p) {
  const sinais = [];
  for (const [nome, q] of Object.entries(p.perguntas)) {
    for (const op of q.type === "choice" ? Object.keys(q.criteria) : [null]) {
      sinais.push({
        rotulo: op ? `${nome}=${op}` : nome,
        valor: (x) => {
          const r = x.resp[nome];
          if (!r) return NaN;
          if (r.tipo === "boolean") return r.p;
          if (r.tipo === "score") return r.norm;
          return Number(r.probs?.[op] ?? (r.escolha === op ? 1 : 0));
        },
      });
    }
  }
  const minTerminados = Number(opt["min-terminados"] || 3);
  const { anunciantes, resultados } = comparacaoPorAnunciante(pecas, sinais, { minTerminados });
  console.log(`Anunciantes com ≥${minTerminados} criativo(s) terminado(s) e os dois lados: ${anunciantes.length}`);
  for (const a of anunciantes) {
    console.log(`  ${String(a.nome).slice(0, 40).padEnd(40)} ${a.total} peça(s), ${a.terminados} terminada(s), corte ${a.corte}d → ${a.longos.length} longa(s) × ${a.curtos.length} curta(s)`);
  }
  if (anunciantes.length < 5) {
    console.log("\n⚠ Menos de 5 anunciantes: o que aparecer abaixo é anedota de poucos anunciantes, não padrão.");
  }
  const f = (n) => (n === null || n === undefined ? "  —  " : n.toFixed(2).padStart(5));
  console.log(`\n${"sinal".padEnd(34)}  dif   anunciantes a favor × contra`);
  for (const r of resultados.filter((r) => r.positivos + r.negativos > 0).sort((a, b) => Math.abs(b.diferenca ?? 0) - Math.abs(a.diferenca ?? 0))) {
    console.log(`${r.rotulo.padEnd(34)} ${f(r.diferenca)}   ${r.positivos} × ${r.negativos}`);
  }
  console.log(
    "\nLeitura: 'dif' positiva = o sinal aparece mais nos criativos que duraram mais QUE OS OUTROS DO MESMO " +
      "anunciante. Vale mais um sinal que aponta para o mesmo lado em muitos anunciantes do que uma 'dif' grande em poucos."
  );
}

// ---------------------------------------------------------------------------------------------
// ranking
// ---------------------------------------------------------------------------------------------

function ranking() {
  const p = carregarPerguntas();
  const perguntasHash = hash(JSON.stringify(perguntasParaApi(p)) + (opt.modelo || "typesafe-ai/jev"));
  const cache = carregarCache(perguntasHash);
  const pesos = p.nota?.pesos || {};
  const pecas = carregarCorpus()
    .filter((x) => cache.has(x.chave))
    .map((x) => ({ ...x, ...notaComposta(lerRespostas(cache.get(x.chave).answers, p.perguntas), pesos) }));
  const top = topN(pecas, Number(opt.top || 10));
  console.log(`Pesos: ${JSON.stringify(pesos)} — palpite até o 'longevidade' dizer outra coisa.\n`);
  top.forEach((x, i) => {
    const texto = x.estado.replace(/\s+/g, " ").slice(0, 140);
    console.log(
      `${String(i + 1).padStart(2)}. ${x.nota.toFixed(2)}  [${x.fonte}${Number.isFinite(x.dias) ? ` · ${x.dias}d` : ""}` +
        `${x.ids.length > 1 ? ` · ${x.ids.length} cópias` : ""}] ${x.anunciante || ""}\n    ${texto}…`
    );
  });
}

// ---------------------------------------------------------------------------------------------

async function rotularLlm() {
  const p = carregarPerguntas();
  const arquivo = path.resolve(opt.gabarito || arq("gabarito.csv"));
  if (!existsSync(arquivo)) {
    console.error(`Sem ${arquivo}. Rode antes: node jev.js gabarito`);
    process.exit(1);
  }
  // Import tardio: só este comando precisa do SDK da Anthropic (npm install nesta pasta).
  const { rotularGabarito, MODELO_PADRAO } = await import("./rotular-llm.js");
  await rotularGabarito({
    arquivo,
    perguntas: p.perguntas,
    modelo: opt["modelo-llm"] || MODELO_PADRAO,
    effort: opt.esforco || "high",
    simular: Boolean(opt.simular),
  });
}

const comandos = { anunciantes, exportar, classificar, gabarito, "rotular-llm": rotularLlm, comparar, longevidade, ranking };
const cmd = comandos[opt._];
if (!cmd) {
  console.error(`Comando desconhecido: ${opt._ ?? "(nenhum)"}. Use: ${Object.keys(comandos).join(", ")}.`);
  process.exit(1);
}
await cmd();
