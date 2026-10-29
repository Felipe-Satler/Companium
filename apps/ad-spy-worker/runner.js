/**
 * Orquestração da Mineração v2.
 *
 * O pipeline deixou de ser automático de ponta a ponta. Agora são dois momentos separados por uma
 * decisão humana:
 *
 *   BUSCA   searchBlock()      -> bloco de anúncios que passam nos filtros -> "awaiting_selection"
 *           (repetível: cada "carregar mais" chama de novo)
 *   ANÁLISE analyzeSelected()  -> download -> transcrição -> análise, SÓ dos marcados -> "done"
 *
 * Todo resultado vai para a linha da run, nunca para a resposta HTTP: atrás do nginx a desconexão
 * do browser é indetectável, e a UI acompanha por polling (mesma lição do persistBackgroundReply do
 * openclaw-bridge). Nenhuma função exportada aqui lança — são chamadas com `void`.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { analyzeRun } from "./analyze.js";
import { KEEP_VIDEO, MAX_RUNS_INFLIGHT, MAX_SEARCHES_INFLIGHT } from "./config.js";
import {
  getRun,
  isCancelRequested,
  listSelectedAds,
  patchAd,
  patchRun,
  seedStages,
  storageUpload,
} from "./db.js";
import { fetchMedia, fetchNextBlock } from "./search.js";
import { lanesFor, providerForAd } from "./sources/index.js";
import { transcribeBatch } from "./transcribe.js";

// Dois contadores, de propósito. O pico de 3.9 GB medido em produção é da ANÁLISE (Whisper na RAM
// + download de vídeos). Buscar um bloco é outra ordem de grandeza — com a Scrape Creators é HTTP e
// meia dúzia de thumbnails. Com um contador só, uma análise em andamento impedia TODO MUNDO de
// sequer navegar pelos anúncios.
let analysisInFlight = 0;
let searchInFlight = 0;
export function runsInFlight() {
  return { analysis: analysisInFlight, search: searchInFlight };
}
export function hasAnalysisCapacity() {
  return analysisInFlight < MAX_RUNS_INFLIGHT;
}
export function hasSearchCapacity() {
  return searchInFlight < MAX_SEARCHES_INFLIGHT;
}

// runId -> AbortController da análise em andamento. O cancelamento por flag no banco só é lido nos
// checkpoints ENTRE etapas (assertNotCanceled); a chamada ao agente é um único await longo, sem
// checkpoint interno. Como o mesmo processo serve o HTTP e roda o pipeline, guardamos o controller
// aqui e a rota /cancel o aborta na hora — o agent-cli mata o subprocesso `openclaw` no SIGKILL.
const activeAnalyses = new Map();

/**
 * Aborta a análise em andamento da run, se houver. Complementa requestCancel (que grava a flag):
 * a flag cobre as etapas de busca/download; o abort cobre a etapa "enviando ao agente".
 * @returns {boolean} true se havia uma análise para abortar.
 */
export function cancelAnalysis(runId) {
  const controller = activeAnalyses.get(runId);
  if (controller) controller.abort();
  return Boolean(controller);
}

class Canceled extends Error {
  constructor() {
    super("Run cancelada pelo usuário.");
    this.name = "Canceled";
  }
}

/**
 * Visão mutável do `stages` da run, que grava a cada mudança. Parte das etapas JÁ GRAVADAS — a
 * análise acontece depois da busca e não pode apagar o "Busca: concluída" que veio antes.
 */
function createStageTracker(runId, initial) {
  const template = seedStages();
  const current = Array.isArray(initial) ? initial : [];
  // Mescla com o modelo: runs antigas (com "collect") ou vazias ganham as etapas que faltam.
  const stages = template.map((t) => ({ ...t, ...(current.find((c) => c.key === t.key) || {}) }));
  const byKey = new Map(stages.map((s) => [s.key, s]));
  const flush = () => patchRun(runId, { stages }).catch(() => {});
  const now = () => new Date().toISOString();

  return {
    stages,
    async reset(keys) {
      for (const k of keys) {
        const s = byKey.get(k);
        if (!s) continue;
        Object.assign(s, { status: "pending", done: 0, total: null, started_at: null, ended_at: null, note: null });
      }
      await flush();
    },
    async start(key, total = null, note = null) {
      const s = byKey.get(key);
      if (!s) return;
      Object.assign(s, { status: "running", started_at: now(), ended_at: null, total, done: 0, note });
      await flush();
    },
    async progress(key, done, total = undefined, note = undefined) {
      const s = byKey.get(key);
      if (!s) return;
      s.done = done;
      if (total !== undefined) s.total = total;
      if (note !== undefined) s.note = note;
      await flush();
    },
    async finish(key, note = undefined) {
      const s = byKey.get(key);
      if (!s) return;
      Object.assign(s, { status: "done", ended_at: now() });
      if (note !== undefined) s.note = note;
      if (s.total == null) s.total = s.done;
      await flush();
    },
    async fail(key, note) {
      const s = byKey.get(key);
      if (!s) return;
      Object.assign(s, { status: "error", ended_at: now(), note });
      await flush();
    },
    async skip(key, note) {
      const s = byKey.get(key);
      if (!s) return;
      Object.assign(s, { status: "skipped", ended_at: now(), note });
      await flush();
    },
    /** Marca o que ficou pendurado, para uma falha não deixar spinner girando para sempre. */
    async abandon(keys, note) {
      for (const k of keys) {
        const s = byKey.get(k);
        if (s && (s.status === "pending" || s.status === "running")) {
          Object.assign(s, { status: "skipped", note: s.note || note, ended_at: now() });
        }
      }
      await flush();
    },
  };
}

async function assertNotCanceled(runId) {
  if (await isCancelRequested(runId)) throw new Canceled();
}

// =============================================================================================
// BUSCA
// =============================================================================================

/**
 * Traz o próximo bloco. `first` = primeiro bloco da run: se ele vier vazio, a run falha (não há o
 * que selecionar). Nos seguintes, um bloco vazio ou um erro NÃO derrubam a run — a pessoa continua
 * com o que já está na tela, e a nota explica o que houve.
 */
export async function searchBlock({ runId, userId, first = false, log }) {
  searchInFlight += 1;
  const say = (msg) => log?.(`[busca ${runId}] ${msg}`);
  let stage = null;
  try {
    const run = await getRun(runId);
    if (!run) return;
    stage = createStageTracker(runId, run.stages);

    const { lanes, skipped } = lanesFor(run);
    if (!lanes.length) throw new Error(skipped.join(" ") || "Nenhuma fonte de busca válida nesta mineração.");

    await patchRun(runId, { status: "searching", error: null });
    await stage.start("discover", null, first ? "buscando o primeiro bloco" : "buscando mais anúncios");

    const { added, state, note } = await fetchNextBlock({
      run,
      lanes,
      skippedNotes: skipped,
      userId,
      log: say,
    });

    await stage.finish("discover", note || `+${added} anúncio(s)`);

    if (first && added === 0) {
      await patchRun(runId, {
        status: "error",
        search_state: state,
        error:
          note ||
          `Nenhum anúncio utilizável para "${run.tema}". Tente um tema mais amplo, ou relaxe a ` +
            "longevidade mínima e o mínimo de anúncios usando o criativo.",
      });
      return;
    }
    await patchRun(runId, { status: "awaiting_selection", search_state: state, error: null });
  } catch (err) {
    const message = String(err?.message || err).slice(0, 1000);
    say(`ERRO: ${message}`);
    await stage?.fail("discover", message);
    // Com anúncios já na tela, o erro de um bloco extra não pode tirar a pessoa da seleção.
    await patchRun(runId, { status: first ? "error" : "awaiting_selection", error: message }).catch(
      () => {}
    );
  } finally {
    searchInFlight -= 1;
  }
}

// =============================================================================================
// ANÁLISE
// =============================================================================================

/**
 * Baixa o vídeo de um anúncio, renovando o link se tiver expirado.
 *
 * Na v1 o download vinha segundos depois da busca. Agora vem depois da SELEÇÃO — que pode ser horas
 * depois —, e as CDNs (Meta, Instagram, TikTok) assinam os links com validade curta. Se o download falhar e a fonte
 * souber buscar o anúncio pelo id, renova o link uma vez e tenta de novo.
 */
export async function downloadVideo(ad, provider, { log, signal }) {
  if (ad.media_url) {
    try {
      return await fetchMedia(ad.media_url, signal);
    } catch (err) {
      log?.(`vídeo do anúncio ${ad.id}: ${err.message} — tentando renovar o link`);
    }
  }
  if (typeof provider?.fetchAdById !== "function" || !ad.external_id) {
    throw new Error("link do vídeo expirado e a fonte não permite renovar");
  }
  const fresh = await provider.fetchAdById(ad.external_id, { log, signal });
  if (!fresh?.mediaUrl) throw new Error("a fonte não devolveu um link de vídeo novo");
  await patchAd(ad.id, { media_url: fresh.mediaUrl, thumb_url: fresh.thumbUrl || ad.thumb_url });
  return fetchMedia(fresh.mediaUrl, signal);
}

/**
 * Transcrição + análise dos anúncios marcados. A seleção já foi gravada pela rota antes de chamar.
 *
 * Anúncios que JÁ têm transcrição (de uma análise anterior da mesma run) não são retranscritos:
 * trocar dois anúncios da seleção não deveria custar a CPU dos outros vinte de novo.
 */
export async function analyzeSelected({ runId, userId, log }) {
  analysisInFlight += 1;
  const controller = new AbortController();
  activeAnalyses.set(runId, controller);
  const say = (msg) => log?.(`[análise ${runId}] ${msg}`);
  const PIPE = ["download", "transcribe", "analyze"];
  let stage = null;
  let workDir = null;
  try {
    const run = await getRun(runId);
    if (!run) return;
    stage = createStageTracker(runId, run.stages);
    await stage.reset(PIPE);
    await patchRun(runId, {
      status: "running",
      error: null,
      cancel_requested: false,
      analysis_md: null,
      analysis: null,
    });

    const ads = await listSelectedAds(runId);
    if (!ads.length) throw new Error("Nenhum anúncio selecionado para analisar.");

    const settings = run.settings || {};
    const wantTranscripts = settings.transcribe !== false;

    // ---- completar (Instagram/TikTok)
    // A busca dessas fontes devolve peças sem texto: o reel de perfil quase nunca traz a legenda e o
    // anúncio da biblioteca pública do TikTok não traz texto nenhum. O detalhe completa, a 1 crédito
    // por peça — e por isso só aqui, para as SELECIONADAS, e uma vez só (`metrics.hydrated`).
    // Falhar aqui não impede nada: a peça segue com o que tem, e o vídeo ainda vai pela transcrição.
    const toHydrate = ads.filter((a) => providerForAd(a.source)?.needsHydration?.(a));
    if (toHydrate.length) {
      await stage.start("download", null, `completando ${toHydrate.length} peça(s) pela fonte`);
      let completadas = 0;
      for (const ad of toHydrate) {
        await assertNotCanceled(runId);
        try {
          const fresh = await providerForAd(ad.source).fetchAdById(ad.external_id, {
            log: say,
            signal: controller.signal,
            // O Google precisa do anunciante além do id do criativo para montar o link do detalhe.
            ad,
          });
          const patch = { metrics: { ...(ad.metrics || {}), hydrated: true } };
          if (fresh) {
            if (fresh.adCopy) patch.ad_copy = fresh.adCopy;
            if (fresh.title && !ad.title) patch.title = fresh.title;
            // Fonte sem arquivo de vídeo (YouTube): a transcrição é a legenda da própria plataforma,
            // e o modelo diz isso — quem lê sabe que não passou pelo Whisper.
            if (fresh.transcript && !(ad.transcript && ad.transcript.trim())) {
              patch.transcript = fresh.transcript;
              patch.transcript_lang = fresh.transcriptLang || null;
              patch.transcript_model = `legendas-${ad.source}`;
            }
            if (fresh.linkUrl && !ad.link_url) patch.link_url = fresh.linkUrl;
            if (fresh.mediaUrl) patch.media_url = fresh.mediaUrl;
            if (fresh.thumbUrl) patch.thumb_url = fresh.thumbUrl;
            // Números do detalhe completam os da busca, sem apagar o que só a busca trouxe.
            for (const [k, v] of Object.entries(fresh.metrics || {})) {
              if (v !== null && v !== undefined) patch.metrics[k] = v;
            }
            if (fresh.adCopy || fresh.transcript) completadas += 1;
          }
          await patchAd(ad.id, patch);
        } catch (err) {
          say(`completar a peça ${ad.id}: ${err.message}`);
        }
      }
      say(`completadas ${completadas} de ${toHydrate.length} peça(s) (${toHydrate.length} crédito(s))`);
      ads.splice(0, ads.length, ...(await listSelectedAds(runId)));
    }

    const toTranscribe = ads.filter(
      (a) =>
        wantTranscripts &&
        a.media_type === "video" &&
        !(a.transcript && a.transcript.trim()) &&
        // Fonte que não expõe o arquivo (YouTube) não tem o que baixar: a transcrição dela veio,
        // ou não, pela legenda no passo acima.
        providerForAd(a.source)?.downloadable !== false
    );

    // ---- download
    workDir = await mkdtemp(path.join(tmpdir(), `adspy-${runId.slice(0, 8)}-`));
    const downloaded = [];
    if (!toTranscribe.length) {
      await stage.skip(
        "download",
        wantTranscripts ? "nada novo para baixar" : "transcrição desligada"
      );
    } else {
      await stage.start("download", toTranscribe.length, "baixando os vídeos selecionados");
      let n = 0;
      for (const ad of toTranscribe) {
        await assertNotCanceled(runId);
        try {
          const bytes = await downloadVideo(ad, providerForAd(ad.source), {
            log: say,
            signal: controller.signal,
          });
          const localPath = path.join(workDir, `${ad.id}.mp4`);
          await writeFile(localPath, bytes);
          downloaded.push({ id: ad.id, videoPath: localPath, bytes });
        } catch (err) {
          say(`vídeo do anúncio ${ad.id}: ${err.message}`);
        }
        n += 1;
        await stage.progress("download", n);
      }
      await stage.finish("download", `${downloaded.length} de ${toTranscribe.length} vídeo(s)`);
    }

    // ---- transcrição
    if (!downloaded.length) {
      await stage.skip(
        "transcribe",
        toTranscribe.length ? "nenhum vídeo pôde ser baixado" : "já transcritos ou sem vídeo"
      );
    } else {
      await assertNotCanceled(runId);
      await stage.start("transcribe", downloaded.length, "transcrevendo localmente");
      try {
        const { results, errors, device, model } = await transcribeBatch(downloaded, {
          log: say,
          onProgress: (done, total) => void stage.progress("transcribe", done, total),
        });
        for (const [adId, r] of results) {
          await patchAd(adId, {
            transcript: r.text,
            transcript_lang: r.lang,
            transcript_model: model,
            duration_sec: r.duration || null,
          });
        }
        for (const [adId, message] of errors) say(`transcrição do anúncio ${adId}: ${message}`);
        await stage.finish(
          "transcribe",
          `${results.size} transcrito(s)` +
            (errors.size ? `, ${errors.size} com falha` : "") +
            (device ? ` · ${model} em ${device}` : "")
        );
      } catch (err) {
        // Transcrição que falha empobrece a análise, mas não invalida o corpus.
        say(`transcrição falhou: ${err.message}`);
        await stage.fail("transcribe", `${err.message} — seguindo só com os textos.`);
      }
      if (KEEP_VIDEO) {
        for (const item of downloaded) {
          try {
            const objectPath = `${userId}/${runId}/${item.id}.mp4`;
            await storageUpload(objectPath, item.bytes, "video/mp4");
            await patchAd(item.id, { media_path: objectPath });
          } catch (err) {
            say(`upload do vídeo ${item.id}: ${err.message}`);
          }
        }
      }
      for (const item of downloaded) item.bytes = null;
    }

    // ---- análise
    await assertNotCanceled(runId);
    await stage.start("analyze", null, "enviando ao agente");
    const corpus = await listSelectedAds(runId);
    const { analysisMd, analysis } = await analyzeRun({
      userId,
      runId,
      tema: run.tema,
      settings,
      ads: corpus,
      extraPrompt: run.extra_prompt,
      // Sessão nova a cada análise: a mesma run pode ser analisada várias vezes com seleções
      // diferentes, e o agente não deve carregar a anterior no contexto.
      nonce: String(Date.now()),
      ctx: { log: say, signal: controller.signal },
    });
    await stage.finish("analyze", analysis ? null : "resposta sem bloco JSON — só o relatório em texto");
    await patchRun(runId, { status: "done", analysis_md: analysisMd, analysis: analysis || null, error: null });
    say(`concluída: ${corpus.length} anúncio(s)`);
  } catch (err) {
    // Um abort (cancelamento durante o download ou o envio ao agente) chega como erro comum do
    // subprocesso, não como Canceled — o signal.aborted é a fonte da verdade.
    const canceled = err instanceof Canceled || controller.signal.aborted;
    await stage?.abandon(PIPE, canceled ? "cancelada" : "interrompida por erro");
    // Voltar para "awaiting_selection" e não "error": a seleção e o grid continuam valendo, e a
    // pessoa pode ajustar e tentar de novo sem buscar nada outra vez.
    await patchRun(runId, {
      status: canceled ? "awaiting_selection" : "error",
      error: canceled ? null : String(err?.message || err).slice(0, 1000),
    }).catch(() => {});
    say(canceled ? "cancelada" : `ERRO: ${err?.message || err}`);
  } finally {
    activeAnalyses.delete(runId);
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
    analysisInFlight -= 1;
  }
}

/**
 * Refaz SÓ a análise sobre os anúncios já selecionados e transcritos — sem baixar nem transcrever.
 * Para falhas do agente (envelope estranho, handshake), que não têm nada a ver com o corpus.
 */
export async function reanalyzeRun({ runId, userId, extraPrompt, log }) {
  analysisInFlight += 1;
  const controller = new AbortController();
  activeAnalyses.set(runId, controller);
  const say = (msg) => log?.(`[reanálise ${runId}] ${msg}`);
  let stage = null;
  try {
    const run = await getRun(runId);
    if (!run) return;
    const ads = await listSelectedAds(runId);
    if (!ads.length) {
      await patchRun(runId, { status: "error", error: "Não há anúncios selecionados para reanalisar." });
      return;
    }
    stage = createStageTracker(runId, run.stages);
    await patchRun(runId, { status: "running", error: null });
    await stage.start("analyze", null, "reanalisando");

    const prompt = extraPrompt !== undefined ? extraPrompt : run.extra_prompt;
    const { analysisMd, analysis } = await analyzeRun({
      userId,
      runId,
      tema: run.tema,
      settings: run.settings || {},
      ads,
      extraPrompt: prompt,
      nonce: String(Date.now()),
      ctx: { log: say, signal: controller.signal },
    });
    await stage.finish("analyze", analysis ? "reanalisada" : "resposta sem bloco JSON — só o relatório em texto");
    await patchRun(runId, {
      status: "done",
      analysis_md: analysisMd,
      analysis: analysis || null,
      error: null,
      ...(extraPrompt !== undefined ? { extra_prompt: extraPrompt || null } : {}),
    });
  } catch (err) {
    // Cancelamento durante o envio ao agente volta para a seleção (não é erro); o resto é erro real.
    if (controller.signal.aborted) {
      await stage?.abandon(["analyze"], "cancelada");
      await patchRun(runId, { status: "awaiting_selection", error: null }).catch(() => {});
      say("cancelada");
    } else {
      const message = String(err?.message || err).slice(0, 1000);
      say(`ERRO: ${message}`);
      await stage?.fail("analyze", message);
      await patchRun(runId, { status: "error", error: message }).catch(() => {});
    }
  } finally {
    activeAnalyses.delete(runId);
    analysisInFlight -= 1;
  }
}
