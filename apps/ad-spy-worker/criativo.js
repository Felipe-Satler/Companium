/**
 * Análise de UM criativo: a dissecação que antes vinha dentro da análise da mineração, uma linha por
 * anúncio, agora pedida peça a peça pelo botão "Analisar Criativo" e salva como item próprio em
 * Mineração › Análises de Criativos.
 *
 * O agente é o MESMO `spyagent`: a dissecação é a leitura dele, e dois agentes dissecando com
 * critérios diferentes tornariam as análises de criativo incomparáveis com o que a equipe já leu. O
 * prompt abre com `## Modo: dissecação de criativo`, que é o que a definição dele usa para trocar de
 * tarefa (ver agent/spyagent.md › "Modo dissecação de criativo").
 *
 * Vídeo sem transcrição é transcrito ANTES (decisão do usuário, 17/10/2026): na Nova Mineração quase
 * todo vídeo do grid ainda não passou pelo Whisper — só os selecionados para a análise passam —, e a
 * fala é onde está o conteúdo de um vídeo. Se a transcrição falhar, a análise segue só com o texto, e
 * o prompt diz isso ao agente.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractContractJson, stripContractFence } from "./agent-contract.js";
import { runAgentCli } from "./agent-cli.js";
import { formatAd } from "./analyze.js";
import { SPY_AGENT_ID, SPY_RUN_TIMEOUT_MS } from "./config.js";

/**
 * A dissecação não pode ser feita, por um motivo que a pessoa precisa saber — e não por uma falha
 * técnica do worker. A mensagem vai para a tela como "Dissecação não é possível: <motivo>".
 */
export class DissecacaoImpossivel extends Error {
  constructor(motivo) {
    super(motivo);
    this.name = "DissecacaoImpossivel";
  }
}

/** A mensagem que a tela mostra para uma dissecação que não pôde ser feita. */
export const mensagemImpossivel = (motivo) => `Dissecação não é possível: ${motivo}.`;

/** Os níveis de consciência que o contrato aceita. Qualquer outra coisa vira vazio. */
export const NIVEIS_CONSCIENCIA = [
  "inconsciente",
  "consciente_problema",
  "consciente_solucao",
  "consciente_produto",
];

const CAMPOS = ["formato", "estrutura", "anatomia_semantica", "anatomia_psicologica"];
const MAX_CAMPO = 4000;
// Versão 2 (20/10/2026): frase a frase, movimentos e blocos. Os tetos são de sanidade, não de
// conteúdo: um VSL de 3 minutos dá ~60 frases.
const MAX_FRASES = 300;
const MAX_MOVIMENTOS = 80;
const MAX_BLOCOS = 12;
const MAX_FUNCOES = 3;
const MAX_CURTO = 300;
// Abaixo disto, o frase a frase cobre pouco da transcrição: o agente pulou trechos (regra D1).
const COBERTURA_MINIMA = 0.85;

/** O prompt da dissecação: o modo, e a peça no mesmo formato que o agente lê na análise do corpus. */
export function buildDissecacaoPrompt(ad, { interno = false } = {}) {
  const linhas = [
    "## Modo: dissecação de criativo",
    "Disseque o anúncio abaixo, conforme o modo dissecação de criativo das suas instruções.",
  ];
  if (interno) {
    // Anúncio do próprio cliente, da conta de anúncios dele: os números são do Meta Ads, não da
    // Biblioteca, e não há longevidade pública a ler.
    linhas.push("Este anúncio é do PRÓPRIO cliente (da conta de anúncios dele), não de um concorrente.");
  }
  linhas.push("", formatAd(ad, 1));
  return linhas.join("\n");
}

const str = (v, max) => String(v ?? "").trim().slice(0, max);
// O agente às vezes manda o índice como string ("3"); qualquer outra coisa não é índice.
const inteiro = (v) => {
  const n = typeof v === "string" && v.trim() ? Number(v) : v;
  return Number.isInteger(n) ? n : null;
};
const naoDecresce = (xs) => xs.every((x, i) => i === 0 || x >= xs[i - 1]);
// Só letras e dígitos, sem acento nem caixa: a cobertura compara conteúdo, não pontuação.
const normaliza = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/**
 * As três listas da versão 2, saneadas, e se as ligações frase → movimento → bloco se sustentam.
 *
 * Ligação quebrada (índice que não existe, frase que volta a um movimento anterior, movimento que
 * volta a um bloco anterior) NÃO derruba a dissecação: as listas ficam, as ligações saem, e a tela
 * mostra listas soltas em vez de um agrupamento errado.
 */
function parseEstrutura(bloco) {
  const blocos = [];
  const vistosB = new Set();
  for (const [i, b] of (Array.isArray(bloco.blocos) ? bloco.blocos : []).slice(0, MAX_BLOCOS).entries()) {
    const nome = str(b?.nome, MAX_CURTO);
    if (!nome) continue;
    const n = inteiro(b?.n) ?? i + 1;
    if (vistosB.has(n)) continue;
    vistosB.add(n);
    blocos.push({ n, nome });
  }

  const movimentos = [];
  const vistosM = new Set();
  for (const [i, m] of (Array.isArray(bloco.movimentos) ? bloco.movimentos : []).slice(0, MAX_MOVIMENTOS).entries()) {
    const nome = str(m?.nome, MAX_CURTO);
    if (!nome) continue;
    const n = inteiro(m?.n) ?? i + 1;
    if (vistosM.has(n)) continue;
    vistosM.add(n);
    movimentos.push({ n, nome, como_funciona: str(m?.como_funciona, MAX_CAMPO), bloco: inteiro(m?.bloco) });
  }

  const frases = [];
  for (const f of (Array.isArray(bloco.frases) ? bloco.frases : []).slice(0, MAX_FRASES)) {
    const texto = str(f?.texto, MAX_CAMPO);
    if (!texto) continue;
    const origem = f?.origem === "texto" ? "texto" : "fala";
    frases.push({
      origem,
      texto,
      original: str(f?.original, MAX_CAMPO),
      funcoes: (Array.isArray(f?.funcoes) ? f.funcoes : [])
        .map((x) => str(x, 80))
        .filter(Boolean)
        .slice(0, MAX_FUNCOES),
      explicacao: str(f?.explicacao, MAX_CAMPO),
      movimento: origem === "fala" ? inteiro(f?.movimento) : null,
    });
  }

  const ordemB = new Map(blocos.map((b, i) => [b.n, i]));
  const ordemM = new Map(movimentos.map((m, i) => [m.n, i]));
  const fala = frases.filter((f) => f.origem === "fala");
  const ligacoes =
    movimentos.length > 0 &&
    blocos.length > 0 &&
    movimentos.every((m) => ordemB.has(m.bloco)) &&
    naoDecresce(movimentos.map((m) => ordemB.get(m.bloco))) &&
    fala.every((f) => ordemM.has(f.movimento)) &&
    naoDecresce(fala.map((f) => ordemM.get(f.movimento)));
  if (!ligacoes) {
    for (const m of movimentos) m.bloco = null;
    for (const f of frases) f.movimento = null;
  }
  return { frases, movimentos, blocos, ligacoes };
}

/**
 * A resposta do agente -> o que vai para o banco.
 *
 * Tolerante no formato, como a análise: sem o bloco JSON, o Markdown ainda é a dissecação inteira, e
 * a tela mostra o texto. O nível de consciência fora da lista vira vazio, em vez de um rótulo
 * inventado que o filtro não conheceria.
 *
 * Duas versões do contrato. A 1 (até 20/10/2026) tem os quatro campos de texto. A 2 acrescenta o
 * frase a frase, os movimentos e os blocos, e deixa de mandar `estrutura`: o worker a escreve a
 * partir dos blocos, para o card da lista e as linhas antigas continuarem lendo o mesmo campo.
 *
 * `transcript` é a fala que o agente recebeu. Com ela, a versão 2 ganha `cobertura_baixa` quando o
 * frase a frase cobre menos que `COBERTURA_MINIMA` do que foi dito — o jeito de saber se a regra
 * "analise TODAS as frases" foi cumprida.
 */
export function parseDissecacao(finalText, { transcript = null } = {}) {
  const texto = String(finalText ?? "");
  const bloco = extractContractJson(texto);
  const md = stripContractFence(texto).trim();
  if (!bloco || typeof bloco !== "object") return { dissecacao: null, md, semBlocoJson: true };
  const dissecacao = {};
  for (const c of CAMPOS) dissecacao[c] = str(bloco[c], MAX_CAMPO);
  const nivel = String(bloco.nivel_consciencia ?? "").trim().toLowerCase();
  dissecacao.nivel_consciencia = NIVEIS_CONSCIENCIA.includes(nivel) ? nivel : "";
  if (inteiro(bloco.versao) !== 2) return { dissecacao, md, semBlocoJson: false };

  const { frases, movimentos, blocos, ligacoes } = parseEstrutura(bloco);
  Object.assign(dissecacao, { versao: 2, frases, movimentos, blocos, ligacoes });
  const sequencia = (blocos.length ? blocos : movimentos).map((x) => x.nome);
  if (sequencia.length) dissecacao.estrutura = sequencia.join(" → ").slice(0, MAX_CAMPO);

  const fala = normaliza(transcript);
  if (fala) {
    const coberto = normaliza(
      frases
        .filter((f) => f.origem === "fala")
        .map((f) => f.original || f.texto)
        .join(" ")
    );
    dissecacao.cobertura_baixa = coberto.length / fala.length < COBERTURA_MINIMA;
  }
  return { dissecacao, md, semBlocoJson: false };
}

/**
 * A dissecação como a LISTA a manda: sem o frase a frase e sem os movimentos, que só a análise
 * aberta mostra. Com 60 frases por peça e 200 peças, a lista ficaria pesada à toa.
 */
export function resumoDaDissecacao(d) {
  if (!d || typeof d !== "object") return d ?? null;
  const { frases: _f, movimentos: _m, ...resto } = d;
  return resto;
}

/** O vídeo precisa passar pelo Whisper antes? */
export function precisaTranscrever(ad, { downloadable = true } = {}) {
  return ad.media_type === "video" && !(ad.transcript && ad.transcript.trim()) && downloadable !== false;
}

/** O snapshot que fica gravado: o anúncio sem os links de CDN, que expiram em horas. */
export function snapshotDoAnuncio(ad) {
  const { media_url: _m, thumb_url: _t, ...resto } = ad || {};
  return resto;
}

/**
 * Roda a análise de um criativo e grava o resultado.
 *
 * Tudo que fala com o mundo entra por `deps`, para os testes não precisarem de banco, Whisper nem
 * OpenClaw: `completar` devolve a peça com o que a fonte acrescentou, `baixar` devolve os bytes do
 * vídeo, `transcrever` devolve `{ text, lang, model }`, `perguntar` devolve o texto do agente,
 * `gravar` e `gravarAnuncio` persistem.
 *
 * Exige vídeo com fala: sem isso lança `DissecacaoImpossivel`, com o motivo.
 */
export async function runCriativo({ id, ad, log, deps }) {
  const say = (m) => log?.(`[criativo ${id}] ${m}`);
  let peca = { ...ad };

  // A fonte completa a peça antes: o texto que a busca não trouxe, a legenda do YouTube, ou — no
  // criativo interno — o vídeo inteiro, a partir do link do post.
  if (deps.completar) {
    await deps.gravar({ etapa: deps.etapaCompletar || "buscando o anúncio na fonte" });
    try {
      peca = (await deps.completar(peca)) || peca;
    } catch (err) {
      if (err instanceof DissecacaoImpossivel) throw err;
      say(`completar: ${err.message}`);
    }
  }

  // Sem vídeo não há dissecação (decisão do usuário, 19/10/2026): o que a peça diz e faz está na
  // fala, e dissecar só a legenda de uma imagem seria dar como leitura o que é palpite.
  if (peca.media_type !== "video") throw new DissecacaoImpossivel("o anúncio não tem vídeo");

  if (precisaTranscrever(peca, { downloadable: deps.downloadable })) {
    await deps.gravar({ etapa: "transcrevendo o vídeo" });
    let r;
    try {
      const bytes = await deps.baixar(peca);
      r = await deps.transcrever(peca, bytes);
    } catch (err) {
      say(`transcrição: ${err.message}`);
      throw new DissecacaoImpossivel(`não foi possível baixar ou transcrever o vídeo (${err.message})`);
    }
    if (r?.text && r.text.trim()) {
      peca = { ...peca, transcript: r.text, transcript_lang: r.lang || null, transcript_model: r.model || null };
      // A transcrição também volta para o anúncio da busca: ele não precisa ser transcrito de novo
      // na análise da mineração, nem numa segunda análise de criativo.
      await deps.gravarAnuncio?.(peca.id, {
        transcript: peca.transcript,
        transcript_lang: peca.transcript_lang,
        transcript_model: peca.transcript_model,
      });
    }
  }

  // Vídeo sem fala (só música) ou fonte sem legenda: não há o que dissecar além da legenda.
  if (!(peca.transcript && peca.transcript.trim())) {
    throw new DissecacaoImpossivel("o vídeo não tem fala que dê para transcrever");
  }

  await deps.gravar({ etapa: "analisando o criativo", ad: snapshotDoAnuncio(peca) });
  const finalText = await deps.perguntar(buildDissecacaoPrompt(peca, { interno: deps.interno }));
  const { dissecacao, md, semBlocoJson } = parseDissecacao(finalText, { transcript: peca.transcript });
  if (semBlocoJson) say("resposta sem o bloco JSON — mantendo só o texto");
  if (dissecacao?.versao === 2 && !dissecacao.ligacoes) say("frase → movimento → bloco sem ligação válida — mantendo as listas soltas");
  if (dissecacao?.cobertura_baixa) say("o frase a frase cobre pouco da transcrição");
  if (!md && !dissecacao) throw new Error("o agente respondeu vazio");
  const final = { status: "done", etapa: null, error: null, dissecacao, dissecacao_md: md };
  await deps.gravar(final);
  return final;
}

/** O `perguntar` de produção: o spyagent pela CLI, numa sessão só desta análise. */
export function perguntarAoSpyagent({ id, signal, log }) {
  return async (content) => {
    const { finalText } = await runAgentCli({
      agentId: SPY_AGENT_ID,
      content,
      // Sessão nova por análise: a dissecação de uma peça não pode herdar o corpus de outra.
      sessionId: `criativo-${String(id).slice(0, 36)}`,
      timeoutMs: SPY_RUN_TIMEOUT_MS,
      signal,
      log,
    });
    return finalText;
  };
}

/** O `transcrever` de produção: um lote de um vídeo no mesmo Whisper da análise. */
export function transcreverComWhisper({ transcribeBatch, log }) {
  return async (ad, bytes) => {
    const dir = await mkdtemp(path.join(tmpdir(), "adspy-criativo-"));
    try {
      const videoPath = path.join(dir, `${ad.id}.mp4`);
      await writeFile(videoPath, bytes);
      const { results, errors, model } = await transcribeBatch([{ id: ad.id, videoPath, bytes }], { log });
      const r = results.get(ad.id);
      if (!r) throw new Error(errors.get(ad.id) || "o Whisper não devolveu texto");
      return { text: r.text, lang: r.lang, model };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  };
}

// ---------------------------------------------------------------------------------------------
// Criativo INTERNO (o anúncio do próprio cliente, da conta de anúncios dele)
// ---------------------------------------------------------------------------------------------

// As formas de link de vídeo do Facebook que a conta de anúncios grava: o vídeo da página (com ou
// sem o trecho do título antes do id), o reel e o "watch". Só o domínio do Facebook: é a guarda
// de que nada que não seja vídeo do Facebook vai à API, e cada ida custa um crédito.
const FACEBOOK_VIDEO_RE = new RegExp(
  "^https://(?:www\\.|m\\.|web\\.)?facebook\\.com/(?:" +
    "[A-Za-z0-9.\\-_]+/videos/(?:[^/?#\\s]+/)?\\d{5,25}" +
    "|reel/\\d{5,25}" +
    "|watch/?\\?(?:[^\\s]*&)?v=\\d{5,25}" +
    ")/?(?:[?#][^\\s]*)?$"
);

/** O link do post do vídeo é do Facebook e tem forma de vídeo? Senão não vai à API. */
export const permalinkValido = (u) => FACEBOOK_VIDEO_RE.test(String(u || ""));

/** O arquivo do vídeo guardado pela ingestão da conta de anúncios (Storage do Supabase). */
const arquivoValido = (u) => /^https:\/\/[^\s]+$/.test(String(u || ""));

/**
 * A linha de "Criativos Meta Ads" -> a peça no formato que o agente lê (o mesmo de um anúncio da
 * Mineração). O texto e o vídeo ainda não estão aqui: vêm do post, em `completarInterno`.
 */
export function pecaDoCriativoInterno(row) {
  return {
    id: null,
    source: "meta",
    external_id: String(row.Ad_ID ?? ""),
    page_name: row.Client || null,
    title: row.Headline || null,
    ad_copy: "",
    cta_text: null,
    // Só o vídeo interessa (sem vídeo não há dissecação); a imagem fica para a miniatura. Vídeo é
    // o arquivo guardado OU o link do post — o arquivo é o mesmo que a aba Meta Ads toca.
    media_type:
      arquivoValido(row.Video_URL) || permalinkValido(row.Video_Permalink)
        ? "video"
        : row.Media_URL
          ? "image"
          : null,
    // O arquivo guardado já é baixável: com ele, o vídeo não precisa ir ao Facebook.
    media_url: arquivoValido(row.Video_URL) ? row.Video_URL : null,
    thumb_public_url: row.Thumbnail_URL || row.Media_URL || null,
    permalink: row.Video_Permalink || null,
    nome_anuncio: row.Nome_Anuncio || null,
    started_running_on: row.Ad_Criado_Em ? String(row.Ad_Criado_Em).slice(0, 10) : null,
    days_running: null,
    transcript: null,
  };
}

/**
 * Completa o criativo interno pelo post do vídeo (Scrape Creators, 1 crédito): o arquivo do vídeo e
 * o texto do post, que é o texto do anúncio. Post que o Facebook só mostra com login (anúncio em
 * post não publicado) não tem como ser lido — e isso é motivo, não falha.
 */
export async function completarInterno(peca, { scGet, signal }) {
  // Com o arquivo guardado, o vídeo já está aqui. O post ainda vale pelo TEXTO do anúncio, então
  // vai à API se o link servir — e qualquer falha nisso é perda do texto, não da dissecação.
  if (peca.media_url) {
    if (!permalinkValido(peca.permalink)) return { ...peca, media_type: "video" };
    try {
      const json = await scGet("/v1/facebook/post", { url: peca.permalink }, { signal, fonte: "Facebook" });
      return { ...peca, media_type: "video", ad_copy: String(json?.description || "").trim() };
    } catch {
      return { ...peca, media_type: "video" };
    }
  }
  if (!permalinkValido(peca.permalink)) {
    // Dizer QUAL link não serviu é o que torna este caso diagnosticável: "não tem vídeo" sozinho,
    // com o vídeo tocando na tela, não dá pista nenhuma.
    throw new DissecacaoImpossivel(
      peca.permalink
        ? `o link do vídeo não está numa forma que se consiga ler (${String(peca.permalink).slice(0, 200)})`
        : "o anúncio não tem vídeo"
    );
  }
  const json = await scGet("/v1/facebook/post", { url: peca.permalink }, { signal, fonte: "Facebook" });
  const urls = [];
  const varrer = (v, d = 0) => {
    if (!v || typeof v !== "object" || d > 5) return;
    for (const k of ["hd_url", "sd_url"]) if (typeof v[k] === "string" && /^https:\/\//.test(v[k])) urls.push(v[k]);
    for (const x of Object.values(v)) varrer(x, d + 1);
  };
  varrer(json);
  if (!urls.length) {
    throw new DissecacaoImpossivel(
      json?.message
        ? "o vídeo do anúncio não está público (o Facebook só o mostra com login)"
        : "o Facebook não devolveu o arquivo do vídeo"
    );
  }
  return {
    ...peca,
    media_type: "video",
    media_url: urls[0],
    ad_copy: String(json?.description || "").trim(),
  };
}
