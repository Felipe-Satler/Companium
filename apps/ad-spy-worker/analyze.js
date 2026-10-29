/**
 * Analysis stage: hand the mined corpus to the dedicated `spyagent` OpenClaw agent.
 *
 * Reuses the bridge's Gateway client directly — `runAgentStream` is a standalone ESM export with
 * no coupling to the chat route, so none of resolveAgent / tenancy / buildCompaniumPrompt comes
 * along with it. That is the whole point: see agent/spyagent.md for why this path is deliberately
 * independent of `chatbot_bots` and of whether the user has a bot assigned.
 *
 * The prompt built here carries ONLY what varies per run. Everything static (persona, Companium
 * background, how to read longevity, the output contract) lives in the agent's own definition, so
 * it is sent once as the agent's system prompt instead of being re-injected into every message —
 * which is what the chat path does with [COMPANIUM_CONTEXT] and the client snapshot. The message
 * below is therefore roughly just the corpus.
 */

import { createHash } from "node:crypto";
import { runAgentStream } from "../openclaw-bridge/openclaw-agent-stream.js";
import { extractContractJson, stripContractFence } from "./agent-contract.js";
import { runAgentCli } from "./agent-cli.js";
import {
  AGENT_TRANSPORT,
  MAX_CORPUS_CHARS,
  SPY_AGENT_ID,
  SPY_RUN_TIMEOUT_MS,
} from "./config.js";

/**
 * Unique session per run.
 *
 * Two reasons it must not be reused: a second `chat.send` on a live sessionKey makes the Gateway
 * ABORT the running turn, and a shared session would leak one theme's corpus into the next run's
 * context. Capped at 64 chars (Codex prompt_cache_key limit), same recipe as the bridge's
 * `web-${userId}-${hash}`.
 */
export function buildSpySessionId(userId, runId, nonce = "") {
  const short = createHash("sha256")
    .update(`${runId}${nonce ? `:${nonce}` : ""}`)
    .digest("hex")
    .slice(0, 16);
  return `spy-${userId}-${short}`;
}

const FONTE_DO_ANUNCIO = {
  meta: "Meta Ads (anúncio pago)",
  tiktok: "TikTok Ads (anúncio pago)",
  google: "Google Ads (anúncio pago, do Centro de Transparência do Google)",
  tiktok_organic: "TikTok (vídeo ORGÂNICO — não é anúncio)",
  instagram: "Instagram (post ORGÂNICO — não é anúncio)",
  youtube: "YouTube Shorts (vídeo ORGÂNICO — não é anúncio)",
};

const organico = (ad) => ad.source === "instagram" || ad.source === "youtube" || ad.source === "tiktok_organic";

/** O corpus inteiro é orgânico: muda as seções que o agente entrega (ver spyagent.md, regra 14). */
export const corpusOrganico = (ads) => ads.length > 0 && ads.every(organico);

const fmtInt = (n) => (Number.isFinite(n) ? n.toLocaleString("pt-BR") : null);

/**
 * A prova de desempenho de cada peça, no vocabulário da fonte dela.
 *
 * Anúncio pago se prova por longevidade e replicação (alguém continua pagando); post orgânico, por
 * visualizações e engajamento. Misturar os dois sob "Rodando há" faria o agente ler a IDADE de um
 * post como prova de verba — exatamente o erro que a regra de leitura dele existe para evitar.
 */
function linhasDeDesempenho(ad) {
  const m = ad.metrics || {};
  const lines = [];
  if (organico(ad)) {
    lines.push(
      Number.isFinite(ad.days_running)
        ? `Publicado há: ${ad.days_running} dias (em ${ad.started_running_on || "?"})`
        : "Publicado há: desconhecido"
    );
    const eng = [
      fmtInt(m.views) && `${fmtInt(m.views)} visualizações`,
      fmtInt(m.likes) && `${fmtInt(m.likes)} curtidas`,
      fmtInt(m.comments) && `${fmtInt(m.comments)} comentários`,
      // Só o TikTok orgânico traz: salvar e compartilhar são sinais mais fortes que curtir.
      fmtInt(m.shares) && `${fmtInt(m.shares)} compartilhamentos`,
      fmtInt(m.saves) && `${fmtInt(m.saves)} salvamentos`,
    ].filter(Boolean);
    if (eng.length) lines.push(`Engajamento: ${eng.join(", ")}`);
    if (Number.isFinite(m.engagementRate)) {
      const pct = (m.engagementRate * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
      lines.push(
        `Taxa de engajamento: ${pct}% ${m.engagementBasis === "followers" ? "dos seguidores (post sem visualizações)" : "das visualizações"}`
      );
    }
    if (Number.isFinite(m.viewsPerFollower)) {
      lines.push(`Visualizações = ${m.viewsPerFollower.toLocaleString("pt-BR")}× os seguidores do perfil`);
    }
    if (fmtInt(m.followers)) {
      lines.push(`${ad.source === "youtube" ? "Inscritos no canal" : "Seguidores do perfil"}: ${fmtInt(m.followers)}`);
    }
    if (m.paidPartnership) lines.push("Marcado como parceria paga (publi).");
    return lines;
  }
  if (Number.isFinite(ad.days_running)) {
    const ate = (ad.source === "tiktok" || ad.source === "google") && m.lastShownOn ? ` até ${m.lastShownOn}` : "";
    lines.push(`Rodando há: ${ad.days_running} dias (desde ${ad.started_running_on || "?"}${ate})`);
  } else {
    lines.push("Rodando há: desconhecido");
  }
  // Replicação: quantos anúncios usam este mesmo criativo+texto. Junto com a longevidade, é o sinal
  // público mais forte de que o anunciante está colocando dinheiro na peça.
  if (Number.isFinite(ad.collation_count) && ad.collation_count > 1) {
    lines.push(`Anúncios usando este mesmo criativo: ${ad.collation_count}`);
  }
  if (ad.source === "meta" && fmtInt(m.pageLikes)) {
    lines.push(`Curtidas da página do anunciante: ${fmtInt(m.pageLikes)} (tamanho do anunciante, não desempenho da peça)`);
  }
  if (ad.source === "google") {
    if (m.googleFormat) lines.push(`Formato no Google: ${m.googleFormat}`);
    if (m.impressionsRange?.min != null || m.impressionsRange?.max != null) {
      lines.push(`Impressões (faixa do Google): ${fmtInt(m.impressionsRange.min) ?? "?"} a ${fmtInt(m.impressionsRange.max) ?? "?"}`);
    }
    if (ad.transcript_model === "legendas-google") lines.push("A fala do vídeo é a legenda do YouTube.");
  }
  if (ad.source === "tiktok") {
    if (m.estimatedAudience) lines.push(`Alcance estimado: ${m.estimatedAudience}`);
    if (fmtInt(m.impressions)) lines.push(`Impressões: ${fmtInt(m.impressions)}`);
    if (Number.isFinite(m.ctr)) lines.push(`CTR (Creative Center): ${m.ctr}`);
    const eng = [
      fmtInt(m.likes) && `${fmtInt(m.likes)} curtidas`,
      fmtInt(m.comments) && `${fmtInt(m.comments)} comentários`,
      fmtInt(m.shares) && `${fmtInt(m.shares)} compartilhamentos`,
    ].filter(Boolean);
    if (eng.length) lines.push(`Engajamento: ${eng.join(", ")}`);
  }
  return lines;
}

/** A compact, stable label for one ad in the corpus. */
export function formatAd(ad, index) {
  const lines = [`### Anúncio #${index}`];
  lines.push(
    `Fonte: ${
      ad.found_via === "instagram_ads"
        ? "Instagram Ads (anúncio pago da Biblioteca da Meta, rodando no Instagram)"
        : FONTE_DO_ANUNCIO[ad.source] || ad.source || "Meta Ads (anúncio pago)"
    }`
  );
  lines.push(
    `${ad.source === "instagram" || ad.source === "tiktok_organic" ? "Perfil" : ad.source === "youtube" ? "Canal" : "Anunciante"}: ${ad.page_name || "(desconhecido)"}`
  );
  lines.push(...linhasDeDesempenho(ad));
  if (ad.media_type) lines.push(`Mídia: ${ad.media_type}`);
  if (ad.cta_text) lines.push(`CTA: ${ad.cta_text}`);
  if (ad.title) lines.push(`Título: ${ad.title}`);
  lines.push("");
  lines.push(
    ad.source === "instagram"
      ? "Legenda do post:"
      : ad.source === "tiktok_organic"
        ? "Legenda do vídeo:"
        : ad.source === "youtube"
          ? "Descrição do short:"
          : "Texto do anúncio:"
  );
  lines.push((ad.ad_copy || "(sem texto)").trim());
  if (ad.transcript && ad.transcript.trim()) {
    lines.push("");
    // A do YouTube é a legenda da plataforma, muitas vezes automática: pode errar nome e termo técnico.
    lines.push(
      ad.transcript_model?.startsWith("legendas-")
        ? "Transcrição do vídeo (legenda da plataforma, pode ser automática):"
        : "Transcrição do vídeo:"
    );
    lines.push(ad.transcript.trim());
  } else if (ad.media_type === "video") {
    lines.push("");
    lines.push("Transcrição do vídeo: (não disponível)");
  }
  return lines.join("\n");
}

/**
 * Trim the corpus to fit `MAX_CORPUS_CHARS`, shortening the LONGEST transcripts first.
 *
 * Dropping whole ads would bias the sample; truncating the longest transcripts costs the tail of a
 * few long videos, where the useful signal (the hook) is already in the first seconds. The prompt
 * says when this happened so the agent does not read a cut-off transcript as a complete one.
 */
const TRUNC_MARK = " […transcrição truncada]";
// Below this there is nothing useful left to cut — the hook lives in the first seconds anyway.
const MIN_TRANSCRIPT_KEEP = 400;

function corpusSize(list) {
  // +200 per ad approximates the fixed header lines (advertiser, longevity, CTA, labels).
  return list.reduce(
    (n, a) => n + (a.ad_copy?.length || 0) + (a.transcript?.length || 0) + 200,
    0
  );
}

function fitCorpus(ads) {
  if (corpusSize(ads) <= MAX_CORPUS_CHARS) return { ads, trimmed: 0 };

  const working = ads.map((a) => ({ ...a }));
  // Track WHICH ads were cut, not how many cuts happened: an ad can be shortened more than once
  // and must still count as one truncated transcript in the notice to the agent.
  const trimmedIds = new Set();

  // Repeatedly shrink whichever transcript is currently longest. Converges quickly and needs no
  // global allocation pass.
  for (let guard = 0; guard < 500; guard += 1) {
    if (corpusSize(working) <= MAX_CORPUS_CHARS) break;
    let longest = null;
    for (const a of working) {
      if (!a.transcript) continue;
      if (!longest || a.transcript.length > longest.transcript.length) longest = a;
    }
    if (!longest || longest.transcript.length <= MIN_TRANSCRIPT_KEEP) break;
    // An ad can be picked again on a later pass; cut the ORIGINAL text, not the already-marked
    // string, so the marker never doubles up or ends up half-sliced.
    const base = longest.transcript.endsWith(TRUNC_MARK)
      ? longest.transcript.slice(0, -TRUNC_MARK.length)
      : longest.transcript;
    const keep = Math.max(MIN_TRANSCRIPT_KEEP, Math.floor(base.length * 0.6));
    if (keep >= base.length) break; // cannot shrink further; avoid spinning
    longest.transcript = base.slice(0, keep) + TRUNC_MARK;
    trimmedIds.add(longest.id);
  }
  return { ads: working, trimmed: trimmedIds.size };
}

/** O marcador do corpus só orgânico. O MESMO texto está na regra 14 do spyagent. */
export const CORPUS_ORGANICO = "## Corpus orgânico";

/** The per-run prompt. Intentionally small — the static context lives in the agent. */
export function buildSpyPrompt({ tema, settings = {}, ads, extraPrompt }) {
  const { ads: fitted, trimmed } = fitCorpus(ads);

  const params = [];
  params.push(`País: ${settings.country || "BR"}`);
  if (settings.language) params.push(`Idioma: ${settings.language}`);
  params.push(`Status: ${settings.status || "ACTIVE"}`);
  params.push(`Tipo de mídia: ${settings.mediaType || "all"}`);
  if (settings.startDate || settings.endDate) {
    params.push(`Período: ${settings.startDate || "?"} a ${settings.endDate || "hoje"}`);
  }
  if (settings.minDaysRunning) {
    params.push(`Longevidade mínima aplicada na coleta: ${settings.minDaysRunning} dias`);
  }
  if (settings.maxPerAdvertiser) {
    params.push(`Máximo por anunciante: ${settings.maxPerAdvertiser}`);
  }

  const advertisers = new Set(fitted.map((a) => a.page_name || "?"));
  const withTranscript = fitted.filter((a) => a.transcript && a.transcript.trim()).length;
  const porFonte = {};
  for (const a of fitted) porFonte[a.source || "meta"] = (porFonte[a.source || "meta"] || 0) + 1;
  const organicos = fitted.filter(organico).length;
  const soOrganico = corpusOrganico(fitted);

  const out = [
    // Primeira linha de propósito: é por ela que o agente troca as seções (regra 14), e o teste
    // confere que o texto aqui é o mesmo das instruções dele.
    ...(soOrganico ? [CORPUS_ORGANICO, ""] : []),
    `## Tema pesquisado`,
    tema,
    "",
    `## Parâmetros da coleta`,
    params.join("\n"),
    "",
    `## Corpus`,
    `${fitted.length} anúncios, de ${advertisers.size} anunciantes distintos. ` +
      `${withTranscript} com transcrição de vídeo.`,
  ];
  if (Object.keys(porFonte).length > 1 || organicos) {
    out.push(
      "Fontes: " +
        Object.entries(porFonte)
          .map(([f, n]) => `${n} de ${FONTE_DO_ANUNCIO[f] || f}`)
          .join("; ") +
        "."
    );
  }
  if (organicos && !soOrganico) {
    out.push(
      `Atenção: ${organicos} peça(s) são posts ORGÂNICOS (Instagram/TikTok/YouTube Shorts), não anúncios. Para elas, a ` +
        `prova de desempenho é o engajamento, não a data — não leia a idade de um post como ` +
        `longevidade de verba. Os números citam todas como "Anúncio #n" só para manter a numeração.`
    );
  }
  if (trimmed > 0) {
    out.push(
      `Atenção: ${trimmed} transcrição(ões) foram truncadas por limite de tamanho — estão marcadas ` +
        `com "[…transcrição truncada]". Não trate o fim dessas como o fim do vídeo.`
    );
  }
  out.push("");
  fitted.forEach((ad, i) => {
    out.push(formatAd(ad, i + 1));
    out.push("");
  });

  if (extraPrompt && extraPrompt.trim()) {
    out.push("## Instrução adicional do usuário");
    out.push(
      "Atenda ao pedido abaixo dentro do formato de resposta definido nas suas instruções. " +
        "Ele direciona o foco da análise; não substitui a estrutura do relatório nem o bloco JSON final."
    );
    out.push("");
    out.push(extraPrompt.trim());
  }

  return out.join("\n");
}

/**
 * The structured analysis, or null. / The prose without the contract block.
 *
 * Both are thin re-exports of the shared contract parser in `agent-contract.js` — the briefs job
 * reads agent replies the same way, and two copies of this parser would diverge on the first fix.
 * Kept exported under these names because they are this module's published surface.
 */
export const extractAnalysisJson = extractContractJson;
export const stripTrailingJsonFence = stripContractFence;

/**
 * Run the analysis.
 * @returns {Promise<{ analysisMd: string, analysis: object|null, stopReason: string }>}
 */
export async function analyzeRun({
  userId,
  runId,
  tema,
  settings,
  ads,
  extraPrompt,
  // Retentativa: muda a sessão para o agente não ver o turno que falhou no contexto.
  nonce = "",
  ctx = {},
}) {
  const content = buildSpyPrompt({ tema, settings, ads, extraPrompt });
  const sessionId = buildSpySessionId(userId, runId, nonce);
  ctx.log?.(
    `análise: ${ads.length} anúncios, ${content.length} chars, agente=${SPY_AGENT_ID}, sessão=${sessionId}`
  );

  const viaCli = () =>
    runAgentCli({
      agentId: SPY_AGENT_ID,
      content,
      sessionId,
      timeoutMs: SPY_RUN_TIMEOUT_MS,
      signal: ctx.signal,
      log: ctx.log,
    });

  let finalText;
  let stopReason;

  if (AGENT_TRANSPORT === "cli") {
    ({ finalText, stopReason } = await viaCli());
  } else {
    try {
      ({ finalText, stopReason } = await runAgentStream({
        agentId: SPY_AGENT_ID,
        content,
        sessionId,
        runTimeoutMs: SPY_RUN_TIMEOUT_MS,
        signal: ctx.signal,
        onDelta: ctx.onDelta,
      }));
    } catch (err) {
      const msg = String(err?.message || err);
      // O Gateway recusa o handshake quando falta identidade de dispositivo/credencial. Como
      // este worker não transmite nada para ninguém (o progresso vai para o banco e a UI faz
      // polling), a CLI serve igualmente bem — então cai para ela em vez de perder a run
      // inteira depois de já ter minerado, baixado e transcrito tudo.
      const handshakeFailed =
        /device identity|identity required|unauthorized|forbidden|hello-ok|connect/i.test(msg);
      if (AGENT_TRANSPORT === "gateway" || !handshakeFailed) throw err;
      ctx.log?.(`Gateway recusou (${msg.slice(0, 120)}); usando a CLI do openclaw`);
      ({ finalText, stopReason } = await viaCli());
    }
  }

  const analysis = extractAnalysisJson(finalText);
  if (!analysis) {
    ctx.log?.("bloco JSON de análise ausente ou inválido — mantendo só a prosa");
  }
  return {
    analysisMd: stripTrailingJsonFence(finalText),
    analysis,
    stopReason,
  };
}
