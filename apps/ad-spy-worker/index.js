/**
 * ad-spy-worker — HTTP da Mineração v2.
 *
 * Separado do openclaw-bridge de propósito: Playwright + sidecar Python/Whisper incharia um
 * processo cuja função é chat, e um crash no scraper não pode derrubar o assistente.
 *
 *   POST   /api/spy/pesquisa              { nicho, contexto? } -> palavras-chave sugeridas
 *   POST   /api/spy/probe                 { termos, settings } -> 1 página por termo (1 crédito)
 *   POST   /api/spy/runs                    cria a run e busca o 1º bloco (volta na hora)
 *   GET    /api/spy/runs/:id                run + anúncios  <- endpoint de polling
 *   POST   /api/spy/runs/:id/more           próximo bloco
 *   POST   /api/spy/runs/:id/analyze        { adIds } -> transcreve e analisa só os marcados
 *   POST   /api/spy/runs/:id/reanalyze      refaz só a análise, sobre a seleção já transcrita
 *   POST   /api/spy/runs/:id/cancel         pede cancelamento da análise
 *   POST   /api/spy/runs/:id/ask            { pergunta } -> veredito por peça (polling na run)
 *   DELETE /api/spy/runs/:id/ask            apaga a pergunta e as respostas
 *   POST   /api/spy/runs/:id/save           { especialidade, titulo } -> Biblioteca
 *   DELETE /api/spy/runs/:id                apaga a run
 *   GET    /api/spy/library                 lista (?especialidade=…, repetível)
 *   GET    /api/spy/library/:id             uma análise salva
 *   DELETE /api/spy/library/:id             só quem salvou ou admin
 *   PUT    /api/spy/library/:id/favorito    { favorito } -> estrela DO USUÁRIO
 *   POST   /api/spy/criativos               { runId|libraryEntryId, adId, especialidade, titulo? }
 *                                          -> dissecação de UM anúncio (polling no item)
 *   GET    /api/spy/criativos               lista (?especialidade=…, repetível)
 *   GET    /api/spy/criativos/:id           uma análise de criativo  <- endpoint de polling
 *   DELETE /api/spy/criativos/:id           só quem pediu ou admin
 *   PUT    /api/spy/criativos/:id/favorito  { favorito } -> estrela DO USUÁRIO
 *   POST   /api/spy/criativos/interno       { cliente, metaAdId } -> dissecação de um criativo DO CLIENTE
 *   PATCH  /api/spy/criativos/:id           { especialidade?, titulo? } -> onde a análise fica salva
 *   GET    /api/spy/media/:adId/:kind       thumb.jpg | avatar.jpg | video.mp4, do bucket
 *                                          privado ou, para o vídeo, da CDN da Meta
 *   GET    /api/spy/briefs                lista os resumos de Marketing › Clientes
 *   GET    /api/spy/briefs/:cliente       um resumo
 *   POST   /api/spy/briefs/:cliente/refresh  reescreve o resumo daquele cliente
 *   GET    /api/spy/clientes/:cliente/documentos
 *   GET    /api/spy/clientes/:cliente/documentos  páginas de Doc daquele cliente (da tabela)
 *   GET    /api/spy/clientes/:cliente/documentos/:docId/conteudo  o corpo de uma delas (page_id)
 *   POST   /api/spy/documentos/sync      sincroniza a carteira inteira com o ClickUp
 *   POST   /api/spy/relatorios            { cliente, snapshot, observacao? } -> diagnóstico do período
 *   GET    /api/spy/relatorios?cliente=…    histórico de relatórios
 *   GET    /api/spy/relatorios/:id        um relatório  <- endpoint de polling
 *   PATCH  /api/spy/relatorios/:id        renomeia (só quem criou ou admin)
 *   DELETE /api/spy/relatorios/:id        só quem criou ou admin
 *   POST   /api/spy/compositions          { cliente, libraryEntryId?, entradas, extraPrompt? }
 *                                         -> 1 a 8 anúncios; quantos e de que uso, decide o agente
 *   GET    /api/spy/compositions?cliente=…   composições salvas (sem `cliente`: de toda a carteira)
 *   GET    /api/spy/compositions/:id      uma composição  <- endpoint de polling
 *   POST   /api/spy/compositions/:id/cancel  para a que está rodando (os anúncios prontos ficam)
 *   POST   /api/spy/compositions/:id/conceitos/:n/aprovar   aprova o conceito sugerido do anúncio n
 *   POST   /api/spy/compositions/:id/conceitos/:n/rejeitar  { motivo? } -> o agente sugere outro
 *   POST   /api/spy/compositions/:id/conceitos/seguir       insumos insuficientes: seguir reciclando
 *   POST   /api/spy/compositions/:id/conceitos/confirmar    todos aprovados -> escreve os anúncios
 *   PATCH  /api/spy/compositions/:id/anuncios/:i          { campos } -> edição à mão (em revisão)
 *   POST   /api/spy/compositions/:id/anuncios/:i/revisao  { pedido } -> o agente revisa o anúncio
 *   POST   /api/spy/compositions/:id/anuncios/:i/desfazer volta à versão anterior do anúncio
 *   POST   /api/spy/compositions/:id/salvar               fecha a revisão (e a orquestração dela)
 *   DELETE /api/spy/compositions/:id      só quem criou ou admin
 *   POST   /api/spy/orquestracoes         { cliente, pedido? } -> números, plano, análise (da
 *                                         Biblioteca ou minerada), pedido e composição, sozinho
 *   GET    /api/spy/orquestracoes?cliente=…  orquestrações
 *   GET    /api/spy/orquestracoes/:id     uma orquestração  <- endpoint de polling
 *   POST   /api/spy/orquestracoes/:id/cancel  para a que está rodando (ou destrava uma órfã)
 *   DELETE /api/spy/orquestracoes/:id     só quem criou ou admin (a composição e a análise ficam)
 *   GET    /api/spy/avaliacoes/:tipo          voto e tag de análises|composições
 *   PUT    /api/spy/avaliacoes/:tipo/:id/voto { voto: 1|-1|null } — voto DO usuário
 *   PUT    /api/spy/avaliacoes/:tipo/:id/tag  { tag: id|null } — a tag do item
 *   GET    /api/spy/clientes/:cliente/brand-kit   (+ PUT; e /imagens/:tipo GET|PUT|DELETE) —
 *                                         Brand kit, em brand-kit-rotas.js
 *   POST   /api/spy/artes                 { compositionId, indice, opcoes } -> arte estática de um
 *                                         anúncio salvo (+ GET, PATCH, fotos, render), em artes-rotas.js
 *   GET    /api/spy/health
 *
 * Toda rota é só para usuário interno — imposto AQUI (auth.js), não confiado ao frontend.
 */

import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import express from "express";
import { AuthError, ForbiddenError, requireInternalUser } from "./auth.js";
import { runRelatorio, validarSnapshot } from "./relatorio.js";
import { alvoValido, normalizarVoto, tagValida } from "../../shared/avaliacao-tags.js";
import { MAX_ANUNCIOS } from "../../shared/ad-formats.js";
import { ehPaginaDeEstudo } from "../../shared/estudo-copy.js";
import { ehPaginaDeResumo } from "../../shared/resumo-estrategico.js";
import { contarSubpaginas } from "./docs-atribuicao.js";
import {
  AGENT_TRANSPORT,
  BLOCK_SIZE,
  COMPOSER_AGENT_ID,
  CLICKUP_TOKEN_ENV,
  RELATORIO_AGENT_ID,
  GATEWAY_HAS_PASSWORD,
  GATEWAY_HAS_TOKEN,
  GATEWAY_URL,
  HOST,
  MAX_EXTRA_PROMPT_CHARS,
  MAX_PAGES_PER_BLOCK,
  MAX_PERGUNTAS_INFLIGHT,
  PERGUNTA_AGENT_ID,
  PERGUNTA_RUN_TIMEOUT_MS,
  MAX_RUNS_INFLIGHT,
  MAX_SEARCHES_INFLIGHT,
  MAX_SELECTED,
  MAX_TEMA_CHARS,
  MAX_TITULO_RELATORIO,
  META_PROVIDER,
  PESQUISA_AGENT_ID,
  PESQUISA_RUN_TIMEOUT_MS,
  TARGET_MAX,
  TARGET_MIN,
  PORT,
  SPY_AGENT_ID,
} from "./config.js";
import {
  dbEnabled,
  deleteComposition,
  deleteLibraryEntry,
  deleteReport,
  getBrief,
  getComposition,
  insertComposition,
  insertReport,
  getReport,
  listReports,
  patchReport,
  listBriefs,
  listCompositions,
  patchComposition,
  listFavoritos,
  setFavorito,
  upsertBrief,
  deleteRun,
  getAd,
  getLibraryEntry,
  getRun,
  insertRun,
  patchRun,
  isAdmin,
  listAds,
  listLibrary,
  listClientDocPages,
  deleteAvaliacoes,
  readAvaliacoes,
  readProjetosLista,
  setTag,
  setVoto,
  requestCancel,
  setSelection,
  storageDownload,
  deleteCriativo,
  getCriativo,
  getCriativoInterno,
  readCriativoMetaAd,
  insertCriativo,
  listCriativos,
  listCriativosRodando,
  listFavoritosCriativos,
  patchAd,
  patchCriativo,
  setFavoritoCriativo,
} from "./db.js";
import {
  analyzeSelected,
  cancelAnalysis,
  hasAnalysisCapacity,
  hasSearchCapacity,
  reanalyzeRun,
  runsInFlight,
  searchBlock,
  downloadVideo,
} from "./runner.js";
import { clientesAtivos, refreshBrief } from "./briefs.js";
import { clickupHabilitado, conteudoDoDocumento } from "./clickup.js";
import { sincronizarDocs } from "./docs-sync.js";
import { runComposition } from "./composer.js";
import { salvarRunNaBiblioteca } from "./biblioteca.js";
import {
  OrquestracaoCancelada,
  orquestracaoAoConfirmar,
  orquestracaoAoFalhar,
  orquestracaoAoTerminar,
  runOrquestracao,
  semearEtapas,
} from "./orquestrador.js";
import { fecharComposicao, fecharEtapas, fecharOrfas } from "./orfas.js";
import { cancelavel, registrarCancelavel, soltarCancelavel } from "./cancelamentos.js";
import { MOTIVO_CANCELADA, revisarAnuncio } from "./composer.js";
import {
  AcaoInvalida,
  aprovar as aprovarConceito,
  naTrava,
  rejeitar as rejeitarConceito,
  seguirAssimMesmo,
} from "./composer-conceitos.js";
import { agendarConceito, iniciarConceitos } from "./conceitos-servico.js";
import { avisosDoConceito, todosAprovados } from "./conceitos.js";
import {
  avisosDoConjunto,
  comVersaoAnterior,
  normalizarCampos,
  resumoDoPlano,
  tirarUltimaVersao,
} from "./composer-conjunto.js";
import {
  deleteOrquestracao,
  getOrquestracaoDaComposicao,
  getOrquestracao,
  insertOrquestracao,
  listOrquestracoes,
  patchOrquestracao,
} from "./db.js";
import {
  MAX_ORQUESTRACOES_INFLIGHT,
  ORQ_MIN_DIAS,
  ORQ_TARGET_ADS,
  ORQUESTRADOR_AGENT_ID,
} from "./config.js";
import { creditBudget, isExhausted, loadState, MEDIA_UA, targetAds } from "./search.js";
import { MAX_PROBE_CALLS, MAX_PROBE_TERMS, parseProbeTerms, probeTerms } from "./probe.js";
import { buildPesquisaPrompt, parsePesquisaReply } from "./pesquisa.js";
import {
  MAX_PERGUNTA_ADS,
  MAX_PERGUNTA_CHARS,
  PERGUNTA_STALE_MS,
  runPergunta,
  trocarPergunta,
} from "./pergunta.js";
import { runAgentCli } from "./agent-cli.js";
import {
  lanesFor,
  parseAdvertiser,
  PROBE_SOURCE_IDS,
  providerForAd,
  providerStatus,
  SOURCE_IDS,
} from "./sources/index.js";
import { cleanHashtag, parseInstagramTarget } from "./sources/instagram.js";
import { parseGoogleTarget } from "./sources/google.js";
import {
  completarInterno,
  DissecacaoImpossivel,
  mensagemImpossivel,
  pecaDoCriativoInterno,
  perguntarAoSpyagent,
  resumoDaDissecacao,
  runCriativo,
  snapshotDoAnuncio,
  transcreverComWhisper,
} from "./criativo.js";
import { scGet } from "./sources/scrapecreators.js";
import { fetchMedia } from "./search.js";
import { parseTiktokTarget } from "./sources/tiktok-organic.js";
import { parseYoutubeTarget } from "./sources/youtube.js";
import { probe, transcribeBatch } from "./transcribe.js";
import { registrarRotasDoBrandKit } from "./brand-kit-rotas.js";
import { registrarRotasDasArtes } from "./artes-rotas.js";

const app = express();
app.disable("x-powered-by");
// Only JSON settings come in through this service; creatives are fetched OUTBOUND by the worker.
app.use(express.json({ limit: "256kb" }));

const log = (msg) => console.log(`[spy] ${msg}`);

// ---------------------------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------------------------

const VALID_SOURCES = new Set(SOURCE_IDS);
// Perfis/links do Instagram (e canais/links do YouTube) por busca. Cada um é uma trilha, e cada trilha gasta ao menos 1 crédito
// por bloco — o teto é de gasto, não de interface.
const MAX_INSTAGRAM_TARGETS = 10;
const VALID_STATUS = new Set(["ACTIVE", "INACTIVE", "ALL"]);
const VALID_MEDIA = new Set(["all", "video", "image"]);
const VALID_SORT = new Set(["impressions", "relevancy"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

class BadRequest extends Error {
  constructor(message) {
    super(message);
    this.name = "BadRequest";
    this.status = 400;
  }
}

/** Decimal dentro da faixa, com no máximo `casas` casas — para taxa e multiplicador. */
function clampNum(value, min, max, fallback, casas = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const f = 10 ** casas;
  return Math.min(max, Math.max(min, Math.round(n * f) / f));
}

/** Pisos aceitos para o alcance estimado do TikTok — os degraus das faixas que a biblioteca usa. */
const TIKTOK_AUDIENCE_FLOORS = new Set([0, 1_000, 10_000, 100_000, 1_000_000, 10_000_000]);

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/**
 * Normalize and bound the request body. Everything the pipeline reads comes from here, so this is
 * the one place that decides what a run may ask for.
 */
/**
 * Normaliza e valida os ajustes da busca.
 *
 * Separado de `parseRunRequest` porque a SONDA usa os mesmos ajustes sem tema, sem fonte e sem
 * instrução adicional: ela testa palavras-chave contra os mesmos filtros que a busca de verdade
 * aplicaria — senão o placar da sonda não diria nada sobre o que a busca traria.
 */
function parseSettings(raw) {
  const s = raw ?? {};
  const country = String(s.country || "BR").toUpperCase().slice(0, 2);
  const status = VALID_STATUS.has(String(s.status).toUpperCase())
    ? String(s.status).toUpperCase()
    : "ACTIVE";
  const mediaType = VALID_MEDIA.has(String(s.mediaType).toLowerCase())
    ? String(s.mediaType).toLowerCase()
    : "all";
  const sortBy = VALID_SORT.has(String(s.sortBy)) ? String(s.sortBy) : "impressions";

  for (const key of ["startDate", "endDate"]) {
    if (s[key] && !ISO_DATE.test(String(s[key]))) {
      throw new BadRequest(`${key} deve estar no formato YYYY-MM-DD.`);
    }
  }
  if (s.startDate && s.endDate && String(s.startDate) > String(s.endDate)) {
    throw new BadRequest("A data inicial não pode ser depois da data final.");
  }

  const settings = {
    country,
    language: s.language ? String(s.language).toLowerCase().slice(0, 5) : null,
    status,
    mediaType,
    sortBy,
    startDate: s.startDate ? String(s.startDate) : null,
    endDate: s.endDate ? String(s.endDate) : null,
    // Quantos anúncios esta busca persegue. Múltiplo de 4 porque o orçamento de créditos é por
    // grupo de 4; `targetAds()` normaliza, aqui só cortamos o que está fora de faixa.
    targetAds: clampInt(s.targetAds, TARGET_MIN, TARGET_MAX, BLOCK_SIZE),
    minDaysRunning: clampInt(s.minDaysRunning, 0, 3650, 0),
    // Mínimo de anúncios usando o mesmo criativo+texto (collation_count). 0/1 = sem filtro.
    minCollationCount: clampInt(s.minCollationCount, 0, 1000, 0),
    maxPerAdvertiser: clampInt(s.maxPerAdvertiser, 0, 50, 0),
    minCopyChars: clampInt(s.minCopyChars, 0, 5000, 0),
    // Transcription is on unless explicitly disabled — it is the feature's main value-add.
    transcribe: s.transcribe !== false,
    // Instagram (orgânico). Só são lidos quando a fonte correspondente foi pedida.
    // Mínimo de visualizações: a prova do orgânico, como a longevidade é a do anúncio.
    minViews: clampInt(s.minViews, 0, 1_000_000_000, 0),
    // Orgânico: (curtidas + comentários) / visualizações, em %. Reels e Shorts de marca ficam na
    // casa de 0,4-0,6% em média (Socialinsider, Dash Social 2025).
    minEngagementPct: clampNum(s.minEngagementPct, 0, 100, 0, 2),
    // Instagram: visualizações ÷ seguidores do autor. 1 = alcançou o tamanho da própria base.
    minViewsPerFollower: clampNum(s.minViewsPerFollower, 0, 1000, 0, 1),
    // TikTok: piso da faixa de alcance estimado. Só os degraus que a biblioteca usa.
    minTikTokAudience: TIKTOK_AUDIENCE_FLOORS.has(Number(s.minTikTokAudience)) ? Number(s.minTikTokAudience) : 0,
    // Vazio = derivada do tema ("harmonização facial" -> #harmonizacaofacial).
    instagramHashtag: cleanHashtag(s.instagramHashtag) || null,
    instagramProfiles: parseInstagramTargets(s.instagramProfiles),
    // YouTube Shorts: mesma lógica — hashtag vazia sai do tema; canais/links viram trilhas.
    // Google Ads: anunciantes por id "AR…", domínio ou link do Centro de Transparência.
    googleAdvertisers: parseTargets(s.googleAdvertisers, parseGoogleTarget, "um id de anunciante (AR…), domínio nem link do Centro de Transparência do Google", "anunciantes ou sites do Google"),
    // TikTok orgânico: idem.
    tiktokHashtag: cleanHashtag(s.tiktokHashtag) || null,
    tiktokProfiles: parseTargets(s.tiktokProfiles, parseTiktokTarget, "um @perfil nem o link de um vídeo do TikTok", "perfis ou links do TikTok"),
    youtubeHashtag: cleanHashtag(s.youtubeHashtag) || null,
    youtubeChannels: parseTargets(s.youtubeChannels, parseYoutubeTarget, "um @canal nem o link de um short/vídeo do YouTube", "canais ou links do YouTube"),
  };

  return settings;
}

/**
 * Lista de alvos (@perfil/@canal ou link), um por item, normalizada pelo `parse` da fonte.
 * Inválido é erro, não sumiço silencioso.
 */
function parseTargets(raw, parse, oQueNaoE, nomeDoPlural) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!String(item ?? "").trim()) continue;
    const alvo = parse(item);
    if (!alvo) throw new BadRequest(`"${String(item).slice(0, 80)}" não é ${oQueNaoE}.`);
    if (!out.includes(alvo)) out.push(alvo);
  }
  if (out.length > MAX_INSTAGRAM_TARGETS) {
    throw new BadRequest(`Informe no máximo ${MAX_INSTAGRAM_TARGETS} ${nomeDoPlural}.`);
  }
  return out;
}

const parseInstagramTargets = (raw) =>
  parseTargets(raw, parseInstagramTarget, "um @perfil nem o link de um post/reel do Instagram", "perfis ou links do Instagram");

function parseRunRequest(body) {
  // "Minerar este anunciante": a busca é pela página, não por palavra-chave. Vai sozinha — misturar
  // com outra fonte dividiria o bloco com peças que não são do anunciante que a pessoa pediu.
  const pedidas = Array.isArray(body?.sources) ? body.sources.map((s) => String(s).toLowerCase()) : [];
  const anunciante = pedidas.includes("meta_advertiser") ? parseAdvertiser(body?.settings?.advertiser) : null;
  if (pedidas.includes("meta_advertiser")) {
    if (pedidas.length > 1) throw new BadRequest("A busca por anunciante não se combina com outras fontes.");
    if (!anunciante) {
      throw new BadRequest("Este anúncio não traz o id da página do anunciante na Biblioteca da Meta.");
    }
  }

  // Sem palavra-chave, o "tema" da run é o nome do anunciante: é o que a tela e a Biblioteca mostram.
  const tema = (String(body?.tema ?? "").trim() || anunciante?.pageName || "").slice(0, MAX_TEMA_CHARS + 1);
  if (!tema) throw new BadRequest("Informe um tema de interesse.");
  if (tema.length > MAX_TEMA_CHARS) {
    throw new BadRequest(`O tema deve ter até ${MAX_TEMA_CHARS} caracteres.`);
  }

  const rawSources = Array.isArray(body?.sources) ? body.sources : ["meta"];
  const sources = [...new Set(rawSources.map((s) => String(s).toLowerCase()))].filter((s) =>
    VALID_SOURCES.has(s)
  );
  if (!sources.length) throw new BadRequest("Selecione pelo menos uma fonte.");
  const settings = parseSettings(body?.settings);
  if (anunciante) {
    settings.advertiser = anunciante;
    // Com um anunciante só, o limite por anunciante seria um teto na busca inteira.
    settings.maxPerAdvertiser = 0;
  }
  if (sources.includes("youtube_channel") && !settings.youtubeChannels.length) {
    throw new BadRequest("Informe ao menos um @canal ou link do YouTube, ou desmarque \"Canais e links\".");
  }
  if (sources.includes("google_advertiser") && !settings.googleAdvertisers.length) {
    throw new BadRequest("Informe ao menos um anunciante ou site do Google, ou desmarque \"Anunciantes e sites\".");
  }
  if (sources.includes("tiktok_profile") && !settings.tiktokProfiles.length) {
    throw new BadRequest("Informe ao menos um @perfil ou link do TikTok, ou desmarque \"Perfis e links\".");
  }
  if (sources.includes("instagram_profile") && !settings.instagramProfiles.length) {
    throw new BadRequest("Informe ao menos um @perfil ou link do Instagram, ou desmarque \"Perfis e links\".");
  }

  const extraPrompt = String(body?.extraPrompt ?? "").trim();
  if (extraPrompt.length > MAX_EXTRA_PROMPT_CHARS) {
    throw new BadRequest(
      `A instrução adicional deve ter até ${MAX_EXTRA_PROMPT_CHARS} caracteres.`
    );
  }

  return { tema, sources, settings, extraPrompt: extraPrompt || null };
}

// ---------------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------------

/** Wrap an async handler so a rejection reaches the error middleware instead of hanging. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get("/", (_req, res) => res.json({ ok: true, service: "ad-spy-worker" }));

// --- Marketing › Clientes ---------------------------------------------------------------------

app.get(
  "/api/spy/briefs",
  wrap(async (req, res) => {
    await requireInternalUser(req);
    res.json({ briefs: await listBriefs() });
  })
);

app.get(
  "/api/spy/briefs/:cliente",
  wrap(async (req, res) => {
    await requireInternalUser(req);
    const brief = await getBrief(req.params.cliente);
    if (!brief) return res.status(404).json({ error: "Resumo não encontrado." });
    res.json({ brief });
  })
);

app.post(
  "/api/spy/briefs/:cliente/refresh",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    const cliente = String(req.params.cliente || "").trim();
    if (!cliente) throw new BadRequest("Cliente não informado.");
    if (!hasAnalysisCapacity()) {
      return res.status(503).json({ error: "Há outra análise em andamento. Tente em instantes." });
    }
    // Marca "running" ANTES de responder: a tela decide fazer polling pelo que leu, então
    // responder 202 com o estado antigo a deixa parada (mesmo bug do 'cd92c96').
    await upsertBrief({ cliente, status: "running", error: null, atualizado_por: userId });
    void refreshBrief({ cliente, userId, log }).catch(async (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      log(`[brief ${cliente}] FALHOU: ${msg}`);
      await upsertBrief({ cliente, status: "error", error: msg.slice(0, 500) }).catch(() => {});
    });
    res.status(202).json({ ok: true });
  })
);

// --- Marketing › Clientes: Documentos ----------------------------------------------------------

/**
 * Os documentos do ClickUp de um cliente.
 *
 * Serve da TABELA (`marketing_client_doc_pages`), não do ClickUp. A primeira versão consultava a
 * API a cada abertura da aba e precisava de um cache em memória; agora os documentos são INGERIDOS
 * (`docs-sync.js`, timer diário), e o ganho não é só velocidade: o que a aba lista é exatamente o
 * que o Composer pode receber como insumo. Uma aba que mostra um conjunto e um prompt que recebe
 * outro seria pior do que não ter a aba.
 *
 * **Lista PÁGINAS, não Docs.** O documento de um cliente neste workspace é uma página dentro de um
 * Doc coletivo, e cada item traz o Doc que o contém (`docNome`) e o caminho até ele.
 *
 * `?recarregar=1` sincroniza ESTE cliente antes de responder — é o botão da tela, para quem acabou
 * de criar um documento e não vai esperar as 04:00.
 *
 * Falha sai **200 com `fontes.clickup: false` e o motivo**, não 500: "não conseguimos ler" e "este
 * cliente não tem documento" são dois fatos diferentes sobre o cliente, e um 500 achataria os dois.
 */
app.get(
  "/api/spy/clientes/:cliente/documentos",
  wrap(async (req, res) => {
    await requireInternalUser(req);
    const padrao = String(req.params.cliente || "").trim();
    if (!padrao) throw new BadRequest("Cliente não informado.");

    const cliente = clientesAtivos(await readProjetosLista()).find((c) => c.padrao === padrao);
    if (!cliente) return res.status(404).json({ error: "Cliente não encontrado na carteira ativa." });

    let erroSync = null;
    if (req.query.recarregar === "1") {
      if (!clickupHabilitado()) {
        erroSync =
          "O worker está sem credencial do ClickUp, então não há como buscar documentos novos. " +
          "A lista abaixo é o que já havia sido ingerido.";
      } else {
        try {
          const r = await sincronizarDocs({ cliente: padrao, log });
          log(`[documentos ${padrao}] sync sob demanda: ${r.conteudosLidos} conteúdo(s) lido(s)`);
        } catch (err) {
          // O sync falhar não impede de servir o que já está na tabela: um ClickUp fora do ar não
          // deve apagar da tela documentos que foram ingeridos semana passada.
          erroSync = err instanceof Error ? err.message : String(err);
          log(`[documentos ${padrao}] sync sob demanda falhou: ${erroSync}`);
        }
      }
    }

    const rows = await listClientDocPages(padrao);
    // A leitura mais recente entre as linhas: é o que a tela mostra como "leitura de...". Serve de
    // resposta honesta a "criei um documento e não aparece" — o dado tem uma idade, e ela é visível.
    const lidoEm = rows
      .map((r) => r.conteudo_lido_em || r.atualizado_em_clickup)
      .filter(Boolean)
      .sort()
      .pop() ?? null;

    // Quantas subpáginas DESTE cliente cada página tem: escolher a página traz todas junto (ver
    // `conteudoDoDocumento`), e a tela diz isso no card.
    const subpaginasPor = contarSubpaginas(rows);

    res.json({
      documentos: rows.map((r) => {
        // A linha sintética do Doc que não pôde ser enumerado (ver docs-sync.js): não há página
        // para apontar, então o link é o do Doc.
        const sintetica = String(r.page_id).startsWith("doc:");
        return {
          id: r.page_id,
          nome: r.nome,
          // Os títulos das páginas acima desta, de fora para dentro. A tela reconhece por eles a
          // subpágina de um Estudo de Copy (`ehPaginaDeEstudo`).
          caminho: Array.isArray(r.caminho) ? r.caminho : [],
          subpaginas: subpaginasPor.get(String(r.page_id)) ?? 0,
          // O Doc que contém a página. A tela agrupa por ele: "Mapeamento do Cliente" com a página
          // deste cliente dentro é o que a pessoa reconhece do ClickUp.
          docNome: r.doc?.nome ?? null,
          // Link da PÁGINA. A API não devolve URL; o worker a monta, e `/v/dc/{doc}/{pagina}` é a
          // forma de link profundo do ClickUp. Num Doc coletivo de 66 páginas, abrir o Doc e
          // procurar a página à mão seria o mesmo que não ter link.
          url: r.doc?.url ? (sintetica ? r.doc.url : `${r.doc.url}/${r.page_id}`) : null,
          // O caminho inteiro, de fora para dentro: onde o Doc mora, o Doc, e as páginas acima
          // desta.
          local:
            [r.doc?.local, r.doc?.nome, ...(r.caminho ?? [])].filter(Boolean).join(" › ") || null,
          via: r.atribuido_via,
          tipo: r.tipo,
          // A tela não precisa do markdown para listar, mas precisa saber se ele EXISTE: é o que
          // separa "documento que serve de insumo" de "documento que é só um link".
          temConteudo: Boolean(r.conteudo_lido_em && r.conteudo_chars),
          criadoEm: r.doc?.criado_em_clickup ?? null,
          atualizadoEm: r.atualizado_em_clickup,
          arquivado: Boolean(r.doc?.arquivado),
          publico: Boolean(r.doc?.publico),
        };
      }),
      fontes: { clickup: !erroSync },
      erro: erroSync,
      lidoEm,
      truncado: false,
    });
  })
);

/**
 * Sincroniza a carteira INTEIRA. É o mesmo caminho do timer diário, exposto para quem quer forçar.
 *
 * Síncrono de propósito, ao contrário do resumo e do relatório: não há agente no meio, então não há
 * nada para acompanhar por polling — a resposta já é o resultado. Pode levar minutos na primeira
 * execução, que é quando a allowlist inteira é baixada.
 */
app.post(
  "/api/spy/documentos/sync",
  wrap(async (req, res) => {
    await requireInternalUser(req);
    if (!clickupHabilitado()) {
      return res.status(503).json({ error: "O worker está sem credencial do ClickUp." });
    }
    const r = await sincronizarDocs({ log });
    res.json(r);
  })
);

// --- Marketing › Clientes: Relatório -----------------------------------------------------------

/**
 * O CORPO de um documento do ClickUp.
 *
 * 200 SEMPRE, nunca 500 — mesma regra da listagem acima. A tela precisa distinguir três coisas, e
 * um 500 achataria as três em "deu erro":
 *   `conteudo_md` string            -> o conteúdo
 *   `conteudo_md: null` + clickup:true  -> lemos, e o documento não tem corpo
 *   `conteudo_md: null` + clickup:false -> NÃO conseguimos ler (`erro` diz por quê)
 *
 * E um quarto, que o contrato de três não previa: `motivo` — "não vamos ler este documento", para
 * o tipo fora da allowlist. Ele sai como o terceiro caso com a razão no lugar do erro, porque
 * responder "está vazio" sobre um documento que tem conteúdo seria mentir.
 *
 * **`:docId` é um `page_id`.** Desde que a unidade de atribuição passou a ser a página (ver
 * docs-sync.js), é a página que a aba lista e que o Composer guarda em `entradas`. O nome do
 * parâmetro ficou: mudá-lo quebraria a URL que a tela já chama, e "documento" é como a pessoa
 * chama a coisa de qualquer modo.
 */
app.get(
  "/api/spy/clientes/:cliente/documentos/:docId/conteudo",
  wrap(async (req, res) => {
    await requireInternalUser(req);
    const docId = String(req.params.docId || "").trim();
    if (!docId) throw new BadRequest("Documento não informado.");
    const padrao = String(req.params.cliente || "").trim();
    if (!padrao) throw new BadRequest("Cliente não informado.");

    if (!clickupHabilitado()) {
      return res.json({
        conteudo_md: null,
        fontes: { clickup: false },
        erro:
          "O worker não tem credencial do ClickUp. Defina CLICKUP_API_TOKEN em spy.env " +
          "(ver spy.env.example) e reinicie o serviço.",
        lidoEm: null,
      });
    }

    try {
      // O `:cliente` da URL não é decoração: `conteudoDoDocumento` recusa a página que não é
      // dele. Antes desta guarda a rota ignorava o parâmetro, e a garantia de não misturar
      // clientes vivia só na tela — que é a camada mais fácil de errar, com o resultado indo ao
      // prompt de um modelo.
      const out = await conteudoDoDocumento(docId, { cliente: padrao });
      if (!out) {
        return res.json({
          conteudo_md: null,
          fontes: { clickup: false },
          erro: "Não foi possível ler o conteúdo deste documento no ClickUp.",
          lidoEm: null,
        });
      }
      // `motivo` é o quarto caso, que o contrato de três não previa: documento cujo conteúdo NÃO
      // é lido por decisão (fora da allowlist — "Acessos" e parentes). Não é falha e não é
      // "documento vazio", então vai com `clickup: false` e a razão, para a tela não mentir.
      if (out.motivo) {
        return res.json({
          conteudo_md: null,
          fontes: { clickup: false },
          erro: out.motivo,
          lidoEm: null,
        });
      }
      return res.json({
        conteudo_md: out.conteudo_md ?? null,
        fontes: { clickup: true },
        erro: null,
        lidoEm: out.lidoEm ?? new Date().toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`[documento ${docId}] falha ao ler conteúdo: ${msg}`);
      return res.json({
        conteudo_md: null,
        fontes: { clickup: false },
        erro: msg.slice(0, 300),
        lidoEm: null,
      });
    }
  })
);

app.post(
  "/api/spy/relatorios",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    if (!dbEnabled()) {
      return res
        .status(503)
        .json({ error: "Worker sem SUPABASE_SERVICE_KEY — não é possível gerar o relatório." });
    }
    const cliente = String(req.body?.cliente ?? "").trim();
    if (!cliente) throw new BadRequest("Informe o cliente.");
    if (cliente.length > 200) throw new BadRequest("Nome de cliente longo demais.");
    const observacao = String(req.body?.observacao ?? "").trim();
    if (observacao.length > MAX_EXTRA_PROMPT_CHARS) {
      throw new BadRequest(`A observação deve ter até ${MAX_EXTRA_PROMPT_CHARS} caracteres.`);
    }
    // O nome é da PESSOA e não entra no prompt: serve para achar o relatório no histórico, não para
    // instruir o agente. Quem direciona a análise é `observacao`, e manter os dois separados evita
    // que um nome descritivo mude silenciosamente o diagnóstico.
    const titulo = String(req.body?.titulo ?? "").trim();
    if (titulo.length > MAX_TITULO_RELATORIO) {
      throw new BadRequest(`O nome do relatório deve ter até ${MAX_TITULO_RELATORIO} caracteres.`);
    }
    const snapshot = req.body?.snapshot;

    // Valida ANTES de gravar: uma linha `running` que nunca vira nada é pior que um 400. O
    // `SnapshotInvalido` carrega status 400, que o middleware de erro já devolve com a mensagem.
    const { snapshot: conferido, avisos } = validarSnapshot(snapshot);

    if (!hasAnalysisCapacity()) {
      // A mensagem nomeia o que bloqueia: este contador é compartilhado com a Mineração, e "há outra
      // análise em andamento" com a Mineração rodando parecia bug de relatório.
      return res.status(503).json({
        error:
          "O worker está com uma análise em andamento (Mineração, resumo ou outro relatório) e " +
          "roda uma por vez. Tente em alguns minutos.",
      });
    }

    const row = await insertReport({
      cliente,
      periodo_de: conferido.periodo.de,
      periodo_ate: conferido.periodo.ate,
      periodo_kind: conferido.periodo.kind ?? null,
      periodo_label: conferido.periodo.label ?? null,
      comparacao_de: conferido.comparacao?.de ?? null,
      comparacao_ate: conferido.comparacao?.ate ?? null,
      comparacao_regra: conferido.comparacao?.regra ?? null,
      comparacao_motivo: conferido.comparacao?.motivo ?? null,
      observacao: observacao || null,
      // Vazio vira NULO, não string vazia: a tela cai para o rótulo do período quando é nulo, e esse
      // fallback só funciona se o nulo chegar até ela.
      titulo: titulo || null,
      avisos,
      snapshot: conferido,
      snapshot_versao: conferido.versao,
      origem_numeros: conferido.origem === "frontend" ? "frontend" : String(conferido.origem ?? "frontend"),
      status: "running",
      criado_por: userId,
      agent_id: RELATORIO_AGENT_ID,
    });

    void runRelatorio({ id: row.id, cliente, snapshot, observacao, log }).catch(async (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      log(`[relatorio ${cliente}] FALHOU: ${msg}`);
      await patchReport(row.id, { status: "error", error: msg.slice(0, 500) }).catch(() => {});
    });

    log(`relatório ${row.id} (${cliente} / ${conferido.periodo.de}..${conferido.periodo.ate}) por ${userId}`);
    res.status(202).json({ id: row.id, status: row.status });
  })
);

app.get(
  "/api/spy/relatorios",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    const cliente = req.query.cliente ? String(req.query.cliente) : null;
    const rows = await listReports({ cliente });
    const admin = await isAdmin(userId).catch(() => false);
    res.json({
      // Como a Biblioteca: toda a equipe interna lê o histórico, apaga quem criou.
      relatorios: rows.map((r) => ({ ...r, canDelete: admin || r.criado_por === userId })),
    });
  })
);

app.get(
  "/api/spy/relatorios/:id",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    const relatorio = await getReport(req.params.id);
    if (!relatorio) return res.status(404).json({ error: "Relatório não encontrado." });
    const admin = await isAdmin(userId).catch(() => false);
    res.json({ relatorio: { ...relatorio, canDelete: admin || relatorio.criado_por === userId } });
  })
);

/**
 * Renomeia um relatório.
 *
 * Só o nome: `PATCH` aqui não é "edite o relatório". O texto e os números são o que o agente
 * escreveu sobre um período, e deixá-los editáveis destruiria a auditoria que o `snapshot` existe
 * para garantir. O nome é rótulo de prateleira, não conteúdo.
 *
 * Mesma permissão do DELETE — quem criou ou admin —, porque renomear o relatório de outra pessoa no
 * histórico compartilhado é a mesma classe de ação que apagá-lo.
 */
app.patch(
  "/api/spy/relatorios/:id",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    const relatorio = await getReport(req.params.id);
    if (!relatorio) return res.status(404).json({ error: "Relatório não encontrado." });
    if (relatorio.criado_por !== userId && !(await isAdmin(userId))) {
      return res
        .status(403)
        .json({ error: "Só quem criou o relatório ou um administrador pode renomeá-lo." });
    }

    const titulo = String(req.body?.titulo ?? "").trim();
    if (titulo.length > MAX_TITULO_RELATORIO) {
      throw new BadRequest(`O nome do relatório deve ter até ${MAX_TITULO_RELATORIO} caracteres.`);
    }
    // Limpar o campo é uma ação legítima: volta ao rótulo do período.
    await patchReport(relatorio.id, { titulo: titulo || null });
    res.json({ ok: true, titulo: titulo || null });
  })
);

app.delete(
  "/api/spy/relatorios/:id",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    const relatorio = await getReport(req.params.id);
    if (!relatorio) return res.status(404).json({ error: "Relatório não encontrado." });
    if (relatorio.criado_por !== userId && !(await isAdmin(userId))) {
      return res
        .status(403)
        .json({ error: "Só quem gerou o relatório ou um administrador pode apagá-lo." });
    }
    await deleteReport(relatorio.id);
    log(`relatório ${relatorio.id} apagado por ${userId}`);
    res.json({ ok: true });
  })
);

// --- Marketing › Ad Composer -------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Normaliza e limita o pedido de composição. É aqui que se decide o que uma composição pode pedir. */
const TIPOS_ENTRADA = new Set(["analise", "brief", "metricas", "relatorio", "documento", "criativo"]);
const MAX_ENTRADAS = 24;

function parseCompositionRequest(body) {
  const cliente = String(body?.cliente ?? "").trim();
  if (!cliente) throw new BadRequest("Informe o cliente.");
  if (cliente.length > 200) throw new BadRequest("Nome de cliente longo demais.");

  // Formato NÃO vem mais no pedido: quem escolhe é o agente, lendo o material (ou obedecendo ao
  // `extraPrompt`). Pedido antigo mandando `formato` é aceito e ignorado, para um frontend em
  // cache durante o deploy não começar a receber 400.

  const libraryEntryId = body?.libraryEntryId ? String(body.libraryEntryId).trim() : null;
  if (libraryEntryId && !UUID.test(libraryEntryId)) {
    throw new BadRequest("libraryEntryId inválido.");
  }

  const brutas = Array.isArray(body?.entradas) ? body.entradas : [];
  if (brutas.length > MAX_ENTRADAS) {
    throw new BadRequest(`Selecione no máximo ${MAX_ENTRADAS} insumos por composição.`);
  }
  const entradas = [];
  for (const e of brutas) {
    const tipo = String(e?.tipo ?? "").trim();
    if (!TIPOS_ENTRADA.has(tipo)) {
      throw new BadRequest(`Tipo de insumo inválido: "${tipo}".`);
    }
    // `brief` e `metricas` são o contexto do próprio cliente: não têm id, são um liga/desliga.
    const id = e?.id == null ? null : String(e.id).trim().slice(0, 200);
    if (tipo === "relatorio" && (!id || !UUID.test(id))) {
      throw new BadRequest("Id de relatório inválido.");
    }
    if (tipo === "documento" && !id) throw new BadRequest("Id de documento inválido.");
    if (tipo === "criativo" && (!id || !UUID.test(id))) {
      throw new BadRequest("Id de análise de criativo inválido.");
    }
    entradas.push({
      tipo,
      id: id || null,
      // O título é gravado junto porque relatório apagado ou documento renomeado no ClickUp não
      // podem apagar em silêncio a origem da ideia.
      titulo: String(e?.titulo ?? "").trim().slice(0, 300) || null,
      local: String(e?.local ?? "").trim().slice(0, 300) || null,
      // Criativo interno: os números dele, em texto, quando a pessoa pediu para incluí-los.
      ...(tipo === "criativo" && e?.numeros ? { numeros: String(e.numeros).trim().slice(0, 800) } : {}),
    });
  }

  // Desde 20/10/2026 a composição pedida pela TELA precisa do Estudo de Copy do cliente e de ao
  // menos uma análise de criativo: é deles que saem os Conceitos Estratégicos (avatar, nível e
  // ângulo do Estudo; o formato, da dissecação). A análise da Biblioteca, obrigatória de 17 a
  // 20/10, voltou a ser opcional. Conferido aqui também, e não só no botão, porque uma aba aberta
  // com o frontend antigo não tem o botão novo. Que um dos documentos É o Estudo, a rota confere
  // no banco (`exigirEstudoDeCopy`): o título vem do navegador. O orquestrador não passa por esta
  // rota.
  if (!entradas.some((e) => e.tipo === "documento")) {
    throw new BadRequest("Escolha o Estudo de Copy do cliente para compor.");
  }
  const nCriativos = entradas.filter((e) => e.tipo === "criativo").length;
  if (nCriativos === 0) throw new BadRequest("Escolha ao menos uma análise de criativo para compor.");
  // Uma por anúncio no máximo: cada uma é um formato possível, e mais formatos que anúncios só
  // acrescentam prompt.
  if (nCriativos > MAX_ANUNCIOS) {
    throw new BadRequest(`Escolha no máximo ${MAX_ANUNCIOS} análises de criativo por composição.`);
  }

  const extraPrompt = String(body?.extraPrompt ?? "").trim();
  if (extraPrompt.length > MAX_EXTRA_PROMPT_CHARS) {
    throw new BadRequest(`A instrução adicional deve ter até ${MAX_EXTRA_PROMPT_CHARS} caracteres.`);
  }

  return { cliente, libraryEntryId, entradas, extraPrompt: extraPrompt || null };
}

/**
 * Entre os documentos escolhidos estão o Estudo de Copy E o Resumo Estratégico DESTE cliente?
 * Conferido no banco, e não pelo título do pedido, que vem do navegador: o nome é o da página (ou
 * o do Doc, ou de uma página acima dela — as mesmas regras da tela, em `shared/`), e a lista é a
 * das páginas atribuídas ao cliente — então um id de página de outro cliente não passa.
 *
 * O Resumo Estratégico é obrigatório desde 26/10/2026: todo cliente tem um na Central de Copy.
 */
async function exigirEstudoDeCopy(cliente, entradas) {
  const ids = new Set(entradas.filter((e) => e.tipo === "documento").map((e) => String(e.id)));
  const escolhidas = (await listClientDocPages(cliente)).filter((p) => ids.has(String(p.page_id)));
  const temEstudo = escolhidas.some((p) =>
    ehPaginaDeEstudo({ nome: p.nome, docNome: p.doc?.nome, caminho: p.caminho })
  );
  if (!temEstudo) throw new BadRequest("Escolha o Estudo de Copy do cliente para compor.");
  const temResumo = escolhidas.some((p) => ehPaginaDeResumo({ nome: p.nome, caminho: p.caminho }));
  if (!temResumo) throw new BadRequest("Escolha o Resumo Estratégico do cliente para compor.");
}

app.post(
  "/api/spy/compositions",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    if (!dbEnabled()) {
      return res
        .status(503)
        .json({ error: "Worker sem SUPABASE_SERVICE_KEY — não é possível compor." });
    }
    const { cliente, libraryEntryId, entradas, extraPrompt } = parseCompositionRequest(req.body);
    await exigirEstudoDeCopy(cliente, entradas);
    if (!hasAnalysisCapacity()) {
      return res.status(503).json({ error: "Há outra análise em andamento. Tente em instantes." });
    }

    // Grava a linha ANTES de responder 202: a tela decide fazer polling pelo que leu, e uma
    // resposta sem linha nenhuma a deixaria parada até um F5 (mesmo bug do 'cd92c96').
    //
    // Desde 20/10/2026 a composição começa em `conceitos`: o agente sugere um Conceito Estratégico
    // por anúncio, quem pediu aprova ou rejeita, e só com todos aprovados ela é escrita (`/confirmar`).
    const row = await insertComposition({
      cliente,
      library_entry_id: libraryEntryId,
      // `formato` fica NULL: só se sabe qual é depois que o agente escolhe.
      entradas,
      extra_prompt: extraPrompt,
      status: "conceitos",
      conceitos: [],
      criado_por: userId,
      agent_id: COMPOSER_AGENT_ID,
    });
    iniciarConceitos(row, { log });

    log(`composição ${row.id} (${cliente}, ${entradas.length} insumo(s)) por ${userId}`);
    res.status(202).json({ id: row.id, status: row.status });
  })
);

app.get(
  "/api/spy/compositions",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    const cliente = req.query.cliente ? String(req.query.cliente) : null;
    // Sem cliente é a aba "Composições Salvas", que mostra a carteira inteira: o teto sobe, porque
    // 50 linhas que cabiam no histórico de UM cliente somem rápido somando todos.
    const rows = await listCompositions({ cliente, limit: cliente ? 50 : 200 });
    const admin = await isAdmin(userId).catch(() => false);
    res.json({
      // O Composer é da equipe, como a Biblioteca: todo mundo vê o histórico, apaga quem criou.
      compositions: rows.map((c) => ({ ...c, canDelete: admin || c.criado_por === userId })),
    });
  })
);

app.get(
  "/api/spy/compositions/:id",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    const composition = await getComposition(req.params.id);
    if (!composition) return res.status(404).json({ error: "Composição não encontrada." });
    const admin = await isAdmin(userId).catch(() => false);
    res.json({
      composition: { ...composition, canDelete: admin || composition.criado_por === userId },
    });
  })
);

// --- Conceitos Estratégicos (20/10/2026) ---------------------------------------------------------
//
// A composição nasce em `conceitos`. O agente sugere um conceito por anúncio (`runConceitos`), quem
// pediu aprova ou rejeita cada um (a rejeição pede outro: `gerarConceito`), pode "seguir assim
// mesmo" quando os insumos não bastam, e confirma quando todos estão aprovados — só aí a composição
// é escrita. A lógica mora em `composer-conceitos.js` e `conceitos.js`; aqui, a fiação.

/**
 * Carrega a composição para uma ação de conceito: existe, a pessoa pode mexer e ela está na etapa.
 * Responde o erro e devolve null quando alguma coisa falha.
 */
async function composicaoEmConceitos(id, res, userId) {
  const composition = await getComposition(id);
  if (!composition) {
    res.status(404).json({ error: "Composição não encontrada." });
    return null;
  }
  if (composition.criado_por !== userId && !(await isAdmin(userId))) {
    res.status(403).json({ error: "Só quem pediu a composição ou um administrador pode decidir os conceitos." });
    return null;
  }
  if (composition.status !== "conceitos") {
    res.status(409).json({ error: "Esta composição não está na etapa de conceitos." });
    return null;
  }
  return composition;
}

/**
 * Uma ação de quem compõe sobre os conceitos, sob a trava da composição: relê a linha, aplica a
 * ação (pura, de `composer-conceitos.js`), grava e agenda os conceitos a gerar.
 */
async function acaoDeConceito(req, res, acao) {
  const { userId } = await requireInternalUser(req);
  const conferida = await composicaoEmConceitos(req.params.id, res, userId);
  if (!conferida) return;
  let feita;
  try {
    feita = await naTrava(conferida.id, async () => {
      const linha = await getComposition(conferida.id);
      if (linha?.status !== "conceitos") throw new AcaoInvalida("Esta composição não está mais na etapa de conceitos.");
      const slots = (linha.conceitos || []).map((s) => ({ ...s }));
      const { gerar = [], ...patch } = acao({ linha, slots, userId });
      await patchComposition(linha.id, { conceitos: slots, ...patch });
      return { linha, gerar };
    });
  } catch (err) {
    if (err instanceof AcaoInvalida) return res.status(409).json({ error: err.message });
    throw err;
  }
  for (const n of feita.gerar) agendarConceito(feita.linha, n, { log });
  res.json({ ok: true });
}

const indiceDoConceito = (req) => {
  const n = Number(req.params.n);
  if (!Number.isInteger(n) || n < 0 || n >= MAX_ANUNCIOS) throw new BadRequest("Anúncio inválido.");
  return n;
};

app.post(
  "/api/spy/compositions/:id/conceitos/:n/aprovar",
  wrap(async (req, res) => {
    const n = indiceDoConceito(req);
    await acaoDeConceito(req, res, ({ slots }) => aprovarConceito(slots, n));
  })
);

app.post(
  "/api/spy/compositions/:id/conceitos/:n/rejeitar",
  wrap(async (req, res) => {
    const n = indiceDoConceito(req);
    const motivo = String(req.body?.motivo ?? "").trim();
    if (motivo.length > 500) throw new BadRequest("O motivo deve ter até 500 caracteres.");
    await acaoDeConceito(req, res, ({ slots, linha, userId }) =>
      rejeitarConceito(slots, n, { motivo, por: userId, insuficiente: linha.insumos_insuficientes })
    );
  })
);

app.post(
  "/api/spy/compositions/:id/conceitos/seguir",
  wrap(async (req, res) => {
    await acaoDeConceito(req, res, ({ slots, linha }) => seguirAssimMesmo(slots, linha.insumos_insuficientes));
  })
);

/** Todos aprovados: a composição sai da etapa de conceitos e é escrita. */
app.post(
  "/api/spy/compositions/:id/conceitos/confirmar",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    const conferida = await composicaoEmConceitos(req.params.id, res, userId);
    if (!conferida) return;
    if (!hasAnalysisCapacity()) {
      return res.status(503).json({ error: "Há outra análise em andamento. Tente em instantes." });
    }
    let linha;
    try {
      linha = await naTrava(conferida.id, async () => {
        const atual = await getComposition(conferida.id);
        if (atual?.status !== "conceitos") throw new AcaoInvalida("Esta composição não está mais na etapa de conceitos.");
        if (!todosAprovados(atual.conceitos)) {
          throw new AcaoInvalida("Aprove o conceito de todos os anúncios antes de compor.");
        }
        await patchComposition(atual.id, { status: "running", error: null });
        return atual;
      });
    } catch (err) {
      if (err instanceof AcaoInvalida) return res.status(409).json({ error: err.message });
      throw err;
    }
    // Se a composição veio de uma orquestração parada nos conceitos, ela segue daqui: a etapa de
    // conceitos fecha, a composição roda, e no fim a orquestração espera a revisão, como sempre.
    const orq = await orquestracaoEmConceitos(linha.id);
    if (orq) await patchOrquestracao(orq.id, orquestracaoAoConfirmar(orq));
    escreverComposicao(
      linha,
      { conceitos: linha.conceitos, catalogo: linha.catalogo_copy },
      orq
        ? {
            aoTerminar: async (r) => {
              const atual = await getOrquestracaoDaComposicao(linha.id);
              if (atual) await patchOrquestracao(atual.id, orquestracaoAoTerminar(atual, { anuncios: r.anuncios }));
            },
            aoFalhar: async (msg) => {
              const atual = await getOrquestracaoDaComposicao(linha.id);
              if (atual) await patchOrquestracao(atual.id, orquestracaoAoFalhar(atual, msg, "composicao"));
            },
          }
        : {}
    );
    log(`composição ${linha.id}: conceitos confirmados por ${userId}`);
    res.status(202).json({ ok: true });
  })
);

/**
 * Escreve a composição em segundo plano (`runComposition`), com o cancelamento registrado. Falha
 * fecha a linha como erro; cancelada no meio, os anúncios prontos ficam (composer.js).
 */
function escreverComposicao(row, extra = {}, { aoTerminar = async () => {}, aoFalhar = async () => {} } = {}) {
  const controller = new AbortController();
  registrarCancelavel(row.id, controller);
  void runComposition({
    id: row.id,
    cliente: row.cliente,
    libraryEntryId: row.library_entry_id,
    entradas: row.entradas,
    extraPrompt: row.extra_prompt || "",
    ...extra,
    signal: controller.signal,
    log,
  })
    .then((r) => aoTerminar(r))
    .catch(async (err) => {
      if (controller.signal.aborted) {
        // Cancelada depois do primeiro anúncio, a composição já se fechou com os prontos dentro
        // (composer.js). Só a cancelada ANTES dele — durante a primeira chamada — fecha aqui.
        log(`[compose ${row.cliente}] cancelada`);
        const atual = await getComposition(row.id).catch(() => null);
        if (atual?.status === "running") {
          await patchComposition(row.id, { status: "error", error: MOTIVO_CANCELADA }).catch(() => {});
        }
        await aoFalhar(MOTIVO_CANCELADA).catch(() => {});
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      log(`[compose ${row.cliente}] FALHOU: ${msg}`);
      await patchComposition(row.id, { status: "error", error: msg.slice(0, 500) }).catch(() => {});
      await aoFalhar(msg).catch(() => {});
    })
    .finally(() => soltarCancelavel(row.id));
}

/**
 * A orquestração que parou nos conceitos desta composição, se houver — é ela que segue (ou fecha)
 * junto com o que acontece aqui.
 */
async function orquestracaoEmConceitos(compositionId) {
  const orq = await getOrquestracaoDaComposicao(compositionId).catch(() => null);
  return orq?.status === "conceitos" ? orq : null;
}

/**
 * Cancela a composição em andamento. Os anúncios que já ficaram prontos não são desfeitos.
 *
 * A composição de uma orquestração está registrada com o controller da orquestração: cancelá-la
 * aqui para a orquestração inteira, que não teria o que fazer depois dela.
 *
 * Linha `running` que este processo não está rodando (sobrou de um reinício) é fechada na hora.
 */
app.post(
  "/api/spy/compositions/:id/cancel",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    const composition = await getComposition(req.params.id);
    if (!composition) return res.status(404).json({ error: "Composição não encontrada." });
    if (composition.criado_por !== userId && !(await isAdmin(userId))) {
      return res
        .status(403)
        .json({ error: "Só quem pediu a composição ou um administrador pode cancelá-la." });
    }
    if (composition.status === "conceitos") {
      // Na etapa de conceitos não há anúncio pronto a guardar: para a sugestão em curso e fecha.
      cancelavel(composition.id)?.abort();
      soltarCancelavel(composition.id);
      await patchComposition(composition.id, { status: "error", error: MOTIVO_CANCELADA });
      const orq = await orquestracaoEmConceitos(composition.id);
      if (orq) await patchOrquestracao(orq.id, orquestracaoAoFalhar(orq, MOTIVO_CANCELADA, "conceitos"));
      log(`composição ${composition.id} cancelada na etapa de conceitos por ${userId}`);
      return res.json({ ok: true });
    }
    if (composition.status !== "running") {
      return res.status(409).json({ error: "Esta composição já terminou." });
    }
    const controller = cancelavel(composition.id);
    if (!controller) {
      await patchComposition(composition.id, fecharComposicao(composition.anuncios, MOTIVO_CANCELADA));
      log(`composição ${composition.id} destravada por ${userId} (não estava rodando)`);
      return res.json({ ok: true });
    }
    controller.abort();
    log(`composição ${composition.id} cancelada por ${userId}`);
    // 202: a linha fecha quando a chamada de agente em curso morrer; a tela vê pelo polling.
    res.status(202).json({ ok: true });
  })
);

// --- Revisão da composição (19/10/2026) ----------------------------------------------------------
//
// A composição termina EM REVISÃO, não salva. Quem a pediu (ou admin) pode editar cada anúncio à
// mão, pedir ao agente que revise UM anúncio com um texto, desfazer a última mudança de um anúncio
// e, por fim, salvar. Toda edição e toda revisão guardam a versão anterior em `versoes`.

/** Revisões rodando neste processo, por `composição:índice`. A linha diz o mesmo (`running`). */
const revisoesEmCurso = new Set();

/**
 * Carrega a composição para uma ação de revisão: existe, a pessoa pode mexer, está em revisão e o
 * índice é de um anúncio que existe. Responde o erro e devolve null quando alguma coisa falha.
 */
async function composicaoEmRevisao(req, res, userId, { comIndice = true } = {}) {
  const composition = await getComposition(req.params.id);
  if (!composition) {
    res.status(404).json({ error: "Composição não encontrada." });
    return null;
  }
  if (composition.criado_por !== userId && !(await isAdmin(userId))) {
    res.status(403).json({ error: "Só quem pediu a composição ou um administrador pode revisá-la." });
    return null;
  }
  if (composition.status !== "revisao") {
    res.status(409).json({
      error:
        composition.status === "running"
          ? "A composição ainda está sendo escrita."
          : "Esta composição não está em revisão.",
    });
    return null;
  }
  if (!comIndice) return { composition, indice: null, anuncio: null };
  const indice = Number(req.params.indice);
  const anuncios = Array.isArray(composition.anuncios) ? composition.anuncios : [];
  const anuncio = Number.isInteger(indice) ? anuncios[indice] : undefined;
  if (!anuncio) {
    res.status(404).json({ error: "Anúncio não encontrado nesta composição." });
    return null;
  }
  if (anuncio.status === "running" || revisoesEmCurso.has(`${composition.id}:${indice}`)) {
    res.status(409).json({ error: "O agente está revisando este anúncio. Espere ele terminar." });
    return null;
  }
  return { composition, indice, anuncio };
}

/** Grava um anúncio trocado, com as colunas derivadas e as versões. */
async function gravarAnuncio(composition, indice, anuncio, versoes) {
  const lista = [...composition.anuncios];
  lista[indice] = anuncio;
  await patchComposition(composition.id, {
    anuncios: lista,
    plano: resumoDoPlano(lista),
    avisos: avisosDoConjunto(lista),
    versoes,
  });
}

app.patch(
  "/api/spy/compositions/:id/anuncios/:indice",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    const alvo = await composicaoEmRevisao(req, res, userId);
    if (!alvo) return;
    const { composition, indice, anuncio } = alvo;
    if (anuncio.status !== "ok") {
      throw new BadRequest("Só dá para editar um anúncio que ficou pronto.");
    }
    const lido = normalizarCampos(anuncio.formato, req.body?.campos);
    if (!lido) throw new BadRequest("Este anúncio não tem um formato que a tela saiba editar.");
    // Anúncio feito de Conceito Estratégico: a edição recalcula também os avisos do conceito
    // (duração, preço, RQE, assinatura) — senão uma edição apagaria o aviso que ela não resolveu.
    if (anuncio.conceito && composition.catalogo_copy) {
      lido.avisos = [
        ...lido.avisos,
        ...avisosDoConceito({
          formatoSaida: anuncio.formato,
          composicao: lido.composicao,
          conceito: anuncio.conceito,
          catalogo: composition.catalogo_copy,
        }),
      ];
    }
    const versoes = comVersaoAnterior(composition.versoes, {
      indice,
      anuncio,
      motivo: "edicao",
      por: userId,
    });
    await gravarAnuncio(
      composition,
      indice,
      { ...anuncio, composicao: lido.composicao, avisos: lido.avisos, error: null, editado: true },
      versoes
    );
    log(`composição ${composition.id}: anúncio ${indice + 1} editado por ${userId}`);
    res.json({ ok: true, avisos: lido.avisos });
  })
);

app.post(
  "/api/spy/compositions/:id/anuncios/:indice/revisao",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    const textoRevisao = String(req.body?.pedido ?? "").trim();
    if (!textoRevisao) throw new BadRequest("Escreva o que o agente deve mudar neste anúncio.");
    if (textoRevisao.length > MAX_EXTRA_PROMPT_CHARS) {
      throw new BadRequest(`O pedido de revisão deve ter até ${MAX_EXTRA_PROMPT_CHARS} caracteres.`);
    }
    const alvo = await composicaoEmRevisao(req, res, userId);
    if (!alvo) return;
    const { composition, indice, anuncio } = alvo;
    if (anuncio.status !== "ok" || !anuncio.composicao) {
      throw new BadRequest("Só dá para revisar um anúncio que ficou pronto.");
    }

    // Marca `running` ANTES de responder, como em toda tarefa longa daqui: a tela decide fazer
    // polling pelo que leu. O conteúdo fica intacto enquanto a revisão roda.
    const chave = `${composition.id}:${indice}`;
    revisoesEmCurso.add(chave);
    const lista = [...composition.anuncios];
    lista[indice] = { ...anuncio, status: "running", error: null };
    await patchComposition(composition.id, { anuncios: lista, plano: resumoDoPlano(lista) });

    void revisarAnuncio({ composicao: composition, indice, pedido: textoRevisao, userId, log })
      .catch(async (err) => {
        // `revisarAnuncio` já trata a falha do agente; isto é o que escapar dela (banco fora).
        const msg = err instanceof Error ? err.message : String(err);
        log(`[revisão ${composition.id} #${indice + 1}] FALHOU: ${msg}`);
        const atual = await getComposition(composition.id).catch(() => null);
        if (atual?.anuncios?.[indice]?.status === "running") {
          const l = [...atual.anuncios];
          l[indice] = { ...l[indice], status: "ok", error: `A revisão falhou (${msg.slice(0, 200)}).` };
          await patchComposition(atual.id, { anuncios: l, plano: resumoDoPlano(l) }).catch(() => {});
        }
      })
      .finally(() => revisoesEmCurso.delete(chave));

    log(`composição ${composition.id}: revisão do anúncio ${indice + 1} pedida por ${userId}`);
    res.status(202).json({ ok: true });
  })
);

app.post(
  "/api/spy/compositions/:id/anuncios/:indice/desfazer",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    const alvo = await composicaoEmRevisao(req, res, userId);
    if (!alvo) return;
    const { composition, indice, anuncio } = alvo;
    const { versao, resto } = tirarUltimaVersao(composition.versoes, indice);
    if (!versao) return res.status(409).json({ error: "Não há versão anterior deste anúncio." });
    await gravarAnuncio(
      composition,
      indice,
      {
        ...anuncio,
        composicao: versao.composicao,
        composicao_md: versao.composicao_md,
        avisos: versao.avisos ?? [],
        error: null,
      },
      resto
    );
    log(`composição ${composition.id}: anúncio ${indice + 1} desfeito por ${userId}`);
    res.json({ ok: true });
  })
);

app.post(
  "/api/spy/compositions/:id/salvar",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    const alvo = await composicaoEmRevisao(req, res, userId, { comIndice: false });
    if (!alvo) return;
    const { composition } = alvo;
    if ((composition.anuncios || []).some((a) => a.status === "running")) {
      return res
        .status(409)
        .json({ error: "Há um anúncio sendo revisado pelo agente. Espere ele terminar." });
    }
    await patchComposition(composition.id, { status: "ok" });

    // A orquestração que gerou esta composição estava esperando exatamente isto.
    const orq = await getOrquestracaoDaComposicao(composition.id).catch(() => null);
    if (orq?.status === "revisao") {
      const agora = new Date().toISOString();
      await patchOrquestracao(orq.id, {
        status: "ok",
        error: null,
        etapas: (orq.etapas || []).map((e) =>
          e.key === "revisao" ? { ...e, status: "done", note: "revisada e salva", ended_at: agora } : e
        ),
      });
    }
    log(`composição ${composition.id} salva por ${userId}`);
    res.json({ ok: true });
  })
);

app.delete(
  "/api/spy/compositions/:id",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    const composition = await getComposition(req.params.id);
    if (!composition) return res.status(404).json({ error: "Composição não encontrada." });
    if (composition.criado_por !== userId && !(await isAdmin(userId))) {
      return res
        .status(403)
        .json({ error: "Só quem criou a composição ou um administrador pode apagá-la." });
    }
    if (composition.status === "conceitos") {
      // Descartada nos conceitos ("escolher mais insumos"): a sugestão em curso para, e a
      // orquestração que esperava esta composição fecha dizendo por quê.
      cancelavel(composition.id)?.abort();
      soltarCancelavel(composition.id);
      const orq = await orquestracaoEmConceitos(composition.id);
      if (orq) {
        await patchOrquestracao(orq.id, orquestracaoAoFalhar(orq, "Conceitos descartados por quem disparou.", "conceitos"));
      }
    }
    await deleteComposition(composition.id);
    // O desenho de avaliação é polimórfico e não tem FK (ver a migração): sem esta linha, os votos
    // e a tag desta composição ficariam órfãos e um id reaproveitado herdaria avaliação alheia.
    await deleteAvaliacoes("composicao", composition.id);
    log(`composição ${composition.id} apagada por ${userId}`);
    res.json({ ok: true });
  })
);

// --- Marketing › Composer › Orquestrador ---------------------------------------------------------

/**
 * Orquestrações rodando NESTE processo, cada uma com o AbortController que a cancela. Cada uma pode
 * ocupar a fila de análise e a do Composer.
 */
const orquestracoesEmCurso = new Map();

app.post(
  "/api/spy/orquestracoes",
  wrap(async (req, res) => {
    const { userId, name } = await requireInternalUser(req);
    if (!dbEnabled()) {
      return res
        .status(503)
        .json({ error: "Worker sem SUPABASE_SERVICE_KEY — não é possível orquestrar." });
    }
    const cliente = String(req.body?.cliente ?? "").trim();
    if (!cliente) throw new BadRequest("Informe o cliente.");
    if (cliente.length > 200) throw new BadRequest("Nome de cliente longo demais.");
    const pedido = String(req.body?.pedido ?? "").trim();
    // A chave "Pular revisão da composição". Hoje a tela a mostra travada em `false`; o worker já
    // a respeita, para o dia em que ela for liberada.
    const pularRevisao = req.body?.pularRevisao === true;
    if (pedido.length > MAX_EXTRA_PROMPT_CHARS) {
      throw new BadRequest(`O pedido deve ter até ${MAX_EXTRA_PROMPT_CHARS} caracteres.`);
    }
    // Conferido AQUI, antes do 202: cliente fora da carteira é erro de quem pediu, e descobri-lo
    // minutos depois, dentro do pipeline, seria responder "ok" a um pedido que não tem como andar.
    if (!clientesAtivos(await readProjetosLista()).some((c) => c.padrao === cliente)) {
      return res.status(404).json({ error: "Cliente não encontrado na carteira ativa." });
    }
    if (orquestracoesEmCurso.size >= MAX_ORQUESTRACOES_INFLIGHT) {
      return res
        .status(503)
        .json({ error: "Já há uma orquestração em andamento. Tente quando ela terminar." });
    }

    // Grava `running` com as etapas ANTES de responder: a tela decide fazer polling pelo que leu.
    const row = await insertOrquestracao({
      cliente,
      pedido: pedido || null,
      status: "running",
      etapas: semearEtapas(),
      criado_por: userId,
      agent_id: ORQUESTRADOR_AGENT_ID,
    });

    const controller = new AbortController();
    orquestracoesEmCurso.set(row.id, controller);
    void runOrquestracao({
      id: row.id,
      cliente,
      pedido,
      userId,
      userName: name,
      // Os mesmos filtros que a tela de Mineração monta, com o que uma busca sem ninguém olhando
      // precisa: longevidade mínima e teto por anunciante, para um só não tomar o grid.
      settingsDaBusca: parseSettings({
        targetAds: ORQ_TARGET_ADS,
        minDaysRunning: ORQ_MIN_DIAS,
        maxPerAdvertiser: 3,
      }),
      metaProvider: META_PROVIDER,
      signal: controller.signal,
      // A composição da orquestração cancela pelo id dela, com o controller da orquestração.
      onComposicao: (compositionId) => registrarCancelavel(compositionId, controller),
      pularRevisao,
      log,
    })
      .catch(async (err) => {
        // O `signal.aborted` é a fonte da verdade, não o tipo do erro: um cancelamento no meio de
        // uma chamada de agente chega aqui como erro comum do subprocesso.
        const cancelada = controller.signal.aborted || err instanceof OrquestracaoCancelada;
        const msg = cancelada
          ? new OrquestracaoCancelada().message
          : err instanceof Error
            ? err.message
            : String(err);
        log(`[orquestração ${cliente}] ${cancelada ? "cancelada" : `FALHOU: ${msg}`}`);
        // A etapa que estava rodando fecha como erro: sem isso a tela mostraria um spinner numa
        // orquestração que já acabou.
        const atual = await getOrquestracao(row.id).catch(() => null);
        const etapas = fecharEtapas(atual?.etapas, cancelada ? "cancelada" : msg.slice(0, 300));
        await patchOrquestracao(row.id, {
          status: "error",
          error: msg.slice(0, 500),
          ...(etapas.length ? { etapas } : {}),
        }).catch(() => {});
      })
      .finally(async () => {
        orquestracoesEmCurso.delete(row.id);
        const atual = await getOrquestracao(row.id).catch(() => null);
        if (atual?.composition_id) soltarCancelavel(atual.composition_id);
      });

    log(`orquestração ${row.id} (${cliente}) por ${userId}`);
    res.status(202).json({ id: row.id, status: row.status });
  })
);

app.get(
  "/api/spy/orquestracoes",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    const cliente = req.query.cliente ? String(req.query.cliente) : null;
    const rows = await listOrquestracoes({ cliente });
    const admin = await isAdmin(userId).catch(() => false);
    res.json({
      orquestracoes: rows.map((o) => ({ ...o, canDelete: admin || o.criado_por === userId })),
    });
  })
);

app.get(
  "/api/spy/orquestracoes/:id",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    const orquestracao = await getOrquestracao(req.params.id);
    if (!orquestracao) return res.status(404).json({ error: "Orquestração não encontrada." });
    const admin = await isAdmin(userId).catch(() => false);
    res.json({
      orquestracao: { ...orquestracao, canDelete: admin || orquestracao.criado_por === userId },
    });
  })
);

/**
 * Cancela a orquestração em andamento.
 *
 * Três coisas podem estar rodando, e cada uma para de um jeito: a chamada de agente morre pelo
 * `AbortController`; a análise de anúncios (download, Whisper, spyagent) é da run de mineração e
 * para pelo mesmo caminho do botão "cancelar" da Mineração; e a composição para entre um anúncio e
 * outro. O que já ficou pronto — a análise salva, os anúncios escritos — não é desfeito.
 *
 * Serve também de DESTRAVA: uma linha `running` que este processo não está rodando (sobrou de uma
 * vida anterior e a faxina do boot não pegou) é fechada aqui na hora.
 */
app.post(
  "/api/spy/orquestracoes/:id/cancel",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    const orquestracao = await getOrquestracao(req.params.id);
    if (!orquestracao) return res.status(404).json({ error: "Orquestração não encontrada." });
    if (orquestracao.criado_por !== userId && !(await isAdmin(userId))) {
      return res
        .status(403)
        .json({ error: "Só quem disparou a orquestração ou um administrador pode cancelá-la." });
    }
    if (orquestracao.status === "conceitos") {
      // Parada esperando a aprovação dos conceitos: nada roda no processo dela. Cancela a composição
      // (e a sugestão de conceito que estiver em curso) e fecha a orquestração.
      if (orquestracao.composition_id) {
        cancelavel(orquestracao.composition_id)?.abort();
        soltarCancelavel(orquestracao.composition_id);
        const comp = await getComposition(orquestracao.composition_id).catch(() => null);
        if (comp?.status === "conceitos") {
          await patchComposition(comp.id, { status: "error", error: MOTIVO_CANCELADA });
        }
      }
      await patchOrquestracao(
        orquestracao.id,
        orquestracaoAoFalhar(orquestracao, new OrquestracaoCancelada().message, "conceitos")
      );
      log(`orquestração ${orquestracao.id} cancelada nos conceitos por ${userId}`);
      return res.json({ ok: true });
    }
    if (orquestracao.status !== "running") {
      return res.status(409).json({ error: "Esta orquestração já terminou." });
    }

    const controller = orquestracoesEmCurso.get(orquestracao.id);
    if (!controller) {
      await patchOrquestracao(orquestracao.id, {
        status: "error",
        error: new OrquestracaoCancelada().message,
        etapas: fecharEtapas(orquestracao.etapas, "cancelada"),
      });
      log(`orquestração ${orquestracao.id} destravada por ${userId} (não estava rodando)`);
      return res.json({ ok: true });
    }

    controller.abort();
    // A análise em curso não ouve o AbortController da orquestração: ela é da run, e tem o dela.
    if (orquestracao.run_id) {
      await requestCancel(orquestracao.run_id).catch(() => {});
      cancelAnalysis(orquestracao.run_id);
    }
    log(`orquestração ${orquestracao.id} cancelada por ${userId}`);
    // 202: o pedido foi aceito, e a linha fecha quando o que está em curso parar. A tela continua
    // no polling e vê o fim.
    res.status(202).json({ ok: true });
  })
);

app.delete(
  "/api/spy/orquestracoes/:id",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    const orquestracao = await getOrquestracao(req.params.id);
    if (!orquestracao) return res.status(404).json({ error: "Orquestração não encontrada." });
    if (orquestracao.criado_por !== userId && !(await isAdmin(userId))) {
      return res
        .status(403)
        .json({ error: "Só quem disparou a orquestração ou um administrador pode apagá-la." });
    }
    if (orquestracoesEmCurso.has(orquestracao.id)) {
      return res.status(409).json({ error: "Esta orquestração ainda está rodando." });
    }
    // Só o registro do percurso: a composição e a análise que nasceram dele continuam nas telas
    // delas, onde são apagadas por quem as usa.
    await deleteOrquestracao(orquestracao.id);
    log(`orquestração ${orquestracao.id} apagada por ${userId}`);
    res.json({ ok: true });
  })
);

// --- Controle de qualidade: voto e tag ---------------------------------------------------------

/**
 * Voto e tag de todos os itens de um tipo, para a tela cruzar com a lista que ela já tem.
 *
 * Endpoint SEPARADO em vez de enriquecer `/library` e `/compositions`: aquelas duas rotas são de
 * outra frente e mudam com frequência, e um sistema que se diz "igual para os dois" não deveria
 * precisar de duas alterações simétricas em código alheio para existir. A tela faz um `merge` por
 * id, e o custo é uma requisição a mais — paga, porque a resposta é pequena e cacheável.
 */
app.get(
  "/api/spy/avaliacoes/:tipo",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    const tipo = String(req.params.tipo || "");
    if (!alvoValido(tipo)) throw new BadRequest("Tipo inválido. Use `analise`, `composicao` ou `criativo`.");
    res.json({ itens: await readAvaliacoes(tipo, userId) });
  })
);

/**
 * O voto DESTA pessoa. `voto: null` tira o voto — é o toggle de clicar no mesmo botão de novo.
 *
 * Qualquer pessoa interna vota, e o voto é dela: não há permissão a conferir além de ser interna. O
 * que existe é identidade, porque o agregado só vale se cada um contar uma vez (a PK garante).
 */
app.put(
  "/api/spy/avaliacoes/:tipo/:id/voto",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    const tipo = String(req.params.tipo || "");
    if (!alvoValido(tipo)) throw new BadRequest("Tipo inválido. Use `analise`, `composicao` ou `criativo`.");
    const alvoId = String(req.params.id || "").trim();
    if (!alvoId) throw new BadRequest("Item não informado.");

    // `normalizarVoto` devolve null para qualquer coisa que não seja 1 ou -1 — inclusive 0 e lixo.
    // Então "voto inválido" e "tirar o voto" chegam ao mesmo lugar, o que é o comportamento certo:
    // o pior caso de um payload estranho é o voto sumir, nunca um valor sem sentido no banco.
    await setVoto(tipo, alvoId, userId, normalizarVoto(req.body?.voto));
    res.json({ ok: true });
  })
);

/**
 * A tag do item — UMA, compartilhada. `tag: null` limpa.
 *
 * **Qualquer pessoa interna pode trocar** (decisão do usuário em 15/10/2026), então aqui não há a
 * regra de "só quem criou ou admin" que o apagar usa. `definida_por` fica gravado mesmo assim: não
 * como permissão, mas como rastro — saber a quem perguntar quando a tag parecer errada.
 */
app.put(
  "/api/spy/avaliacoes/:tipo/:id/tag",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    const tipo = String(req.params.tipo || "");
    if (!alvoValido(tipo)) throw new BadRequest("Tipo inválido. Use `analise`, `composicao` ou `criativo`.");
    const alvoId = String(req.params.id || "").trim();
    if (!alvoId) throw new BadRequest("Item não informado.");

    const bruta = req.body?.tag;
    // Limpar é `null`/vazio. Tag desconhecida é RECUSADA em vez de virar tag nova: o vocabulário é
    // compartilhado com a tela (`shared/avaliacao-tags.js`), e aceitar qualquer string faria a
    // primeira versão errada de um cliente criar uma tag que ninguém consegue filtrar nem explicar.
    const tag = bruta === null || bruta === undefined || bruta === "" ? null : String(bruta);
    if (tag !== null && !tagValida(tag)) {
      throw new BadRequest(`Tag desconhecida: ${tag}.`);
    }

    await setTag(tipo, alvoId, tag, userId);
    res.json({ ok: true, tag });
  })
);

app.get(
  "/api/spy/health",
  wrap(async (_req, res) => {
    const stt = await probe();
    res.json({
      ok: true,
      db: dbEnabled(),
      inFlight: runsInFlight(),
      limits: {
        analysis: MAX_RUNS_INFLIGHT,
        search: MAX_SEARCHES_INFLIGHT,
        blockSize: BLOCK_SIZE,
        maxPagesPerBlock: MAX_PAGES_PER_BLOCK,
        maxSelected: MAX_SELECTED,
      },
      agentId: SPY_AGENT_ID,
      metaProvider: META_PROVIDER,
      providers: providerStatus(),
      whisper: stt,
      gateway: {
        url: GATEWAY_URL,
        auth: GATEWAY_HAS_TOKEN ? "token" : GATEWAY_HAS_PASSWORD ? "password" : "none",
        transport: AGENT_TRANSPORT,
      },
      // A aba Documentos: diz se o worker achou credencial e **sob qual nome**. O nome é o que
      // resolve o diagnóstico ("o token está no servidor, mas numa var que o worker não lê");
      // o valor nunca sai daqui.
      clickup: { ok: clickupHabilitado(), env: CLICKUP_TOKEN_ENV },
    });
  })
);

/** Carrega a run e garante que é do usuário. Mesmo 404 para "não existe" e "não é sua". */
async function ownRun(req, res, userId) {
  const run = await getRun(req.params.id);
  if (!run || run.user_id !== userId) {
    res.status(404).json({ error: "Mineração não encontrada." });
    return null;
  }
  return run;
}

const BUSY = ["queued", "searching", "running"];

/** Só o que a UI precisa do search_state — sem cursor nem a lista de ids vistos. */
function searchSummary(run) {
  const laneIds = lanesFor(run).lanes.map((l) => l.id);
  const st = loadState(run.search_state, laneIds);
  const target = targetAds(run.settings || {});
  return {
    exhausted: isExhausted(st, laneIds),
    buffered: st.buffer.length,
    creditsUsed: st.creditsUsed,
    pagesUsed: st.pagesUsed,
    // Balanço da run inteira, para o resumo do fim da busca.
    found: st.totalFound || 0,
    rejected: st.totalRejected || 0,
    target,
    creditBudget: creditBudget(target),
    note: st.lastNote,
  };
}

/**
 * Sugestão de palavras-chave pelo agente de pesquisa.
 *
 * Não gasta crédito da Scrape Creators: é uma chamada de agente. O que ele devolve são HIPÓTESES —
 * quem mede é a sonda, logo abaixo. Por isso a resposta carrega `fontes.web` e a confiança de cada
 * termo: a pessoa precisa saber se aquilo foi visto num anúncio ou chutado.
 */
app.post(
  "/api/spy/pesquisa",
  wrap(async (req, res) => {
    await requireInternalUser(req);
    const nicho = String(req.body?.nicho ?? "").trim();
    if (!nicho) throw new BadRequest("Informe o nicho ou tema a pesquisar.");
    if (nicho.length > MAX_TEMA_CHARS) {
      throw new BadRequest(`O nicho deve ter até ${MAX_TEMA_CHARS} caracteres.`);
    }
    const contexto = String(req.body?.contexto ?? "").trim().slice(0, MAX_EXTRA_PROMPT_CHARS);

    log(`pesquisa de termos: "${nicho}" via ${PESQUISA_AGENT_ID}`);
    const { finalText } = await runAgentCli({
      agentId: PESQUISA_AGENT_ID,
      content: buildPesquisaPrompt({ nicho, contexto }),
      // Sessão por nicho: duas pesquisas do mesmo nicho continuam a conversa; nichos diferentes
      // não se contaminam.
      sessionId: `pesquisa-${nicho.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`,
      timeoutMs: PESQUISA_RUN_TIMEOUT_MS,
      log,
    });

    const parsed = parsePesquisaReply(finalText);
    log(
      `pesquisa "${nicho}": ${parsed.termos.length} termo(s), web=${parsed.fontes.web}` +
        (parsed.semBlocoJson ? " (sem bloco JSON)" : "")
    );
    res.json(parsed);
  })
);

/**
 * Sonda de palavras-chave: 1 página por termo, 1 crédito por termo.
 *
 * Existe para a escolha do termo deixar de ser palpite. Não cria run nem grava anúncio — devolve
 * o placar e vai embora. O teto de termos é o teto de gasto.
 */
app.post(
  "/api/spy/probe",
  wrap(async (req, res) => {
    await requireInternalUser(req);
    if (!dbEnabled()) {
      return res.status(503).json({ error: "Worker sem acesso ao banco (SUPABASE_SERVICE_KEY)." });
    }
    const termos = parseProbeTerms(req.body?.termos, MAX_TEMA_CHARS);
    if (!termos.length) throw new BadRequest("Informe ao menos uma palavra-chave para testar.");
    // Mesma fila da busca: a sonda também bate na API da fonte.
    if (!hasSearchCapacity()) {
      return res.status(503).json({ error: "Muitas buscas em andamento. Tente em instantes." });
    }
    const settings = parseSettings(req.body?.settings);
    // Fontes da sonda. Sem o campo (frontend antigo), Meta — o comportamento de antes.
    const brutas = Array.isArray(req.body?.fontes) ? req.body.fontes : ["meta"];
    const fontes = [...new Set(brutas.map((f) => String(f).toLowerCase()))];
    const invalida = fontes.find((f) => !PROBE_SOURCE_IDS.includes(f));
    if (invalida) throw new BadRequest(`A sonda não testa a fonte "${invalida}" — ela não busca por palavra-chave.`);
    if (!fontes.length) throw new BadRequest("Escolha ao menos uma fonte para testar.");
    if (termos.length * fontes.length > MAX_PROBE_CALLS) {
      throw new BadRequest(
        `${termos.length} palavra(s) × ${fontes.length} fonte(s) = ${termos.length * fontes.length} ` +
          `créditos; o máximo por teste é ${MAX_PROBE_CALLS}. Tire palavras ou fontes.`
      );
    }
    const { resultados, creditsUsed } = await probeTerms({ termos, settings, fontes, log });
    res.json({ resultados, creditsUsed, maxTermos: MAX_PROBE_TERMS, maxChamadas: MAX_PROBE_CALLS });
  })
);

app.post(
  "/api/spy/runs",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    if (!dbEnabled()) {
      return res.status(503).json({ error: "Worker sem SUPABASE_SERVICE_KEY — não é possível registrar a busca." });
    }
    if (!hasSearchCapacity()) {
      return res.status(503).json({ error: "Muitas buscas em andamento. Tente em instantes." });
    }
    const { tema, sources, settings, extraPrompt } = parseRunRequest(req.body);
    const run = await insertRun({ userId, tema, sources, settings, extraPrompt, metaProvider: META_PROVIDER });
    void searchBlock({ runId: run.id, userId, first: true, log });
    log(`busca ${run.id} por ${userId}: "${tema}"`);
    res.status(202).json({ runId: run.id, status: run.status });
  })
);

app.get(
  "/api/spy/runs/:id",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    const run = await ownRun(req, res, userId);
    if (!run) return;
    const ads = await listAds(run.id);
    // search_state vai resumido: o cursor da API e a lista de vistos não são da conta do browser.
    const { search_state: _omit, ...rest } = run;
    res.json({ run: { ...rest, search: searchSummary(run) }, ads });
  })
);

app.post(
  "/api/spy/runs/:id/more",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    const run = await ownRun(req, res, userId);
    if (!run) return;
    if (BUSY.includes(run.status)) {
      return res.status(409).json({ error: "Aguarde a operação em andamento terminar." });
    }
    const summary = searchSummary(run);
    if (summary.exhausted) {
      return res.status(409).json({ error: "Não há mais anúncios que atendam aos filtros." });
    }
    if (!hasSearchCapacity()) {
      return res.status(503).json({ error: "Muitas buscas em andamento. Tente em instantes." });
    }
    // Marca o estado ANTES de responder. O trabalho segue solto (`void`), e se a run só virasse
    // "searching" lá dentro, a UI faria seu refetch no 202 e ainda leria o estado antigo — como ela
    // decide fazer polling a partir do que leu, ficaria parada, sem pipeline, até um F5.
    await patchRun(run.id, { status: "searching" });
    void searchBlock({ runId: run.id, userId, first: false, log });
    res.status(202).json({ ok: true });
  })
);

app.post(
  "/api/spy/runs/:id/analyze",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    const run = await ownRun(req, res, userId);
    if (!run) return;
    if (BUSY.includes(run.status)) {
      return res.status(409).json({ error: "Aguarde a operação em andamento terminar." });
    }
    const adIds = Array.isArray(req.body?.adIds) ? req.body.adIds : [];
    const unique = [...new Set(adIds.map(Number).filter(Number.isFinite))];
    if (!unique.length) throw new BadRequest("Selecione pelo menos um anúncio.");
    if (unique.length > MAX_SELECTED) {
      throw new BadRequest(`Selecione no máximo ${MAX_SELECTED} anúncios por análise.`);
    }
    if (!hasAnalysisCapacity()) {
      return res.status(503).json({ error: "Há outra análise em andamento. Tente em alguns minutos." });
    }
    const matched = await setSelection(run.id, unique);
    if (!matched) throw new BadRequest("Nenhum dos anúncios selecionados pertence a esta busca.");
    // Marca o estado ANTES de responder. O trabalho segue solto (`void`), e se a run só virasse
    // "running" lá dentro, a UI faria seu refetch no 202 e ainda leria o estado antigo — como ela
    // decide fazer polling a partir do que leu, ficaria parada, sem pipeline, até um F5.
    await patchRun(run.id, { status: "running", error: null, cancel_requested: false });
    void analyzeSelected({ runId: run.id, userId, log });
    log(`análise de ${run.id}: ${matched} anúncio(s)`);
    res.status(202).json({ ok: true, selected: matched });
  })
);

app.post(
  "/api/spy/runs/:id/reanalyze",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    const run = await ownRun(req, res, userId);
    if (!run) return;
    if (BUSY.includes(run.status)) {
      return res.status(409).json({ error: "Aguarde a operação em andamento terminar." });
    }
    if (!hasAnalysisCapacity()) {
      return res.status(503).json({ error: "Há outra análise em andamento. Tente em instantes." });
    }
    let extraPrompt;
    if (typeof req.body?.extraPrompt === "string") {
      extraPrompt = req.body.extraPrompt.trim().slice(0, MAX_EXTRA_PROMPT_CHARS);
    }
    // Marca o estado ANTES de responder. O trabalho segue solto (`void`), e se a run só virasse
    // "running" lá dentro, a UI faria seu refetch no 202 e ainda leria o estado antigo — como ela
    // decide fazer polling a partir do que leu, ficaria parada, sem pipeline, até um F5.
    await patchRun(run.id, { status: "running", error: null, cancel_requested: false });
    void reanalyzeRun({ runId: run.id, userId, extraPrompt, log });
    res.status(202).json({ ok: true });
  })
);

app.post(
  "/api/spy/runs/:id/cancel",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    const run = await ownRun(req, res, userId);
    if (!run) return;
    if (run.status !== "running") {
      return res.status(409).json({ error: "Não há análise em andamento para cancelar." });
    }
    // A flag no banco cobre os checkpoints das etapas de busca/download; o abort em memória
    // interrompe na hora a etapa "enviando ao agente" (mata o subprocesso openclaw).
    await requestCancel(run.id);
    cancelAnalysis(run.id);
    res.json({ ok: true });
  })
);

app.post(
  "/api/spy/runs/:id/save",
  wrap(async (req, res) => {
    const { userId, name } = await requireInternalUser(req);
    const run = await ownRun(req, res, userId);
    if (!run) return;
    if (run.status !== "done" || !run.analysis_md) {
      return res.status(409).json({ error: "Só dá para salvar uma análise concluída." });
    }
    // UM segmento, o principal: a análise é classificada e encontrada por ele. Aceita também a
    // forma antiga (array) para não quebrar chamada em voo durante o deploy, mas guarda só o
    // primeiro. A coluna segue `text[]`: análises salvas antes têm mais de um, e o filtro por
    // sobreposição continua achando as duas formas sem migração nenhuma.
    const pedidos = Array.isArray(req.body?.especialidades)
      ? req.body.especialidades
      : [req.body?.especialidade];
    const principal = pedidos.map((e) => String(e ?? "").trim()).filter(Boolean)[0];
    if (!principal) throw new BadRequest("Escolha o segmento da análise.");
    const titulo = String(req.body?.titulo ?? "").trim().slice(0, 200) || null;

    const entry = await salvarRunNaBiblioteca({
      run,
      especialidade: principal,
      titulo,
      userId,
      name,
    });
    log(`análise de ${run.id} salva na biblioteca (${entry.id}) por ${userId}`);
    res.status(201).json({ id: entry.id });
  })
);

// --- Perguntar ao grid ------------------------------------------------------------------------

/** Runs com pergunta rodando NESTE processo. A linha no banco diz o mesmo, mas sobrevive a restart. */
const perguntasEmCurso = new Set();

/** A pergunta está de fato rodando: marcada como tal e recente o bastante para não ser um resto. */
const perguntaRodando = (q) =>
  q?.status === "running" && Date.now() - Date.parse(q.pedido_em || 0) < PERGUNTA_STALE_MS;

/**
 * Pergunta ao grid: cada peça da busca ganha um veredito e o trecho que o justifica.
 *
 * Não gasta crédito da Scrape Creators e não mexe no `status` da run — a pergunta roda ao lado da
 * busca e da seleção, com estado próprio em `question`. Responde 202 e a tela acompanha pelo
 * polling da run, como a análise: são várias chamadas de agente, e uma requisição longa atrás do
 * nginx cairia no meio sem ninguém saber.
 */
app.post(
  "/api/spy/runs/:id/ask",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    const run = await ownRun(req, res, userId);
    if (!run) return;
    const pergunta = String(req.body?.pergunta ?? "").replace(/\s+/g, " ").trim();
    if (pergunta.length < 5) throw new BadRequest("Escreva a pergunta.");
    if (pergunta.length > MAX_PERGUNTA_CHARS) {
      throw new BadRequest(`A pergunta deve ter até ${MAX_PERGUNTA_CHARS} caracteres.`);
    }
    if (run.status === "searching") {
      return res.status(409).json({ error: "Aguarde a busca terminar: o grid ainda está mudando." });
    }
    if (perguntasEmCurso.has(run.id) || perguntaRodando(run.question)) {
      return res.status(409).json({ error: "Já há uma pergunta sendo respondida nesta busca." });
    }
    if (perguntasEmCurso.size >= MAX_PERGUNTAS_INFLIGHT) {
      return res.status(503).json({ error: "Muitas perguntas em andamento. Tente em instantes." });
    }

    const todas = await listAds(run.id);
    if (!todas.length) throw new BadRequest("Esta busca não tem peças para ler.");
    const ads = todas.slice(0, MAX_PERGUNTA_ADS);

    // Pergunta já feita nesta busca (a da tela ou uma das guardadas) só lê o que falta: peças
    // novas, ou que ganharam transcrição. A que estava na tela vai para as guardadas.
    const { base: anteriores, outras } = trocarPergunta(run.question, pergunta);
    const id = `${Date.now().toString(36)}`;
    const pedidoEm = new Date().toISOString();

    // Grava "running" ANTES de responder: a tela decide fazer polling pelo que leu.
    await patchRun(run.id, {
      question: {
        id, texto: pergunta, status: "running", error: null, pedido_em: pedidoEm, concluido_em: null,
        total: ads.length, feito: 0, respostas: anteriores, outras,
      },
    });

    perguntasEmCurso.add(run.id);
    const say = (m) => log(`[pergunta ${run.id}] ${m}`);
    void runPergunta({
      id,
      pergunta,
      ads,
      anteriores,
      outras,
      pedidoEm,
      log: say,
      perguntar: async (content, lote) => {
        const { finalText } = await runAgentCli({
          agentId: PERGUNTA_AGENT_ID,
          content,
          // Sessão nova por lote: uma pergunta não pode herdar o contexto de outra, nem um lote o
          // das peças do anterior.
          sessionId: `pergunta-${run.id.slice(0, 8)}-${id}-${lote}`,
          timeoutMs: PERGUNTA_RUN_TIMEOUT_MS,
          log: say,
        });
        return finalText;
      },
      gravar: (question) => patchRun(run.id, { question }),
    })
      .then((q) => say(`"${pergunta}": ${q.status}, ${Object.keys(q.respostas).length} resposta(s)`))
      .catch(async (err) => {
        const msg = String(err?.message || err).slice(0, 300);
        say(`FALHOU: ${msg}`);
        await patchRun(run.id, {
          question: {
            id, texto: pergunta, status: "error", error: msg, pedido_em: pedidoEm,
            concluido_em: new Date().toISOString(), total: ads.length, feito: 0, respostas: anteriores,
            outras,
          },
        }).catch(() => {});
      })
      .finally(() => perguntasEmCurso.delete(run.id));

    res.status(202).json({ ok: true, total: ads.length });
  })
);

app.delete(
  "/api/spy/runs/:id/ask",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    const run = await ownRun(req, res, userId);
    if (!run) return;
    if (perguntasEmCurso.has(run.id)) {
      return res.status(409).json({ error: "Aguarde a pergunta em andamento terminar." });
    }
    // "Limpar" tira a pergunta da tela (o grid volta à ordem da busca), mas não joga fora o que já
    // foi lido: ela fica entre as guardadas, a um clique de voltar. `?todas=1` apaga tudo.
    const { outras } = trocarPergunta(run.question, null);
    const question =
      req.query.todas === "1" || !outras.length
        ? null
        : {
            id: null, texto: "", status: "idle", error: null, pedido_em: null, concluido_em: null,
            total: 0, feito: 0, respostas: {}, outras,
          };
    await patchRun(run.id, { question });
    res.json({ ok: true });
  })
);

app.delete(
  "/api/spy/runs/:id",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    const run = await ownRun(req, res, userId);
    if (!run) return;
    if (BUSY.includes(run.status)) {
      return res.status(409).json({ error: "Aguarde a operação em andamento terminar." });
    }
    const result = await deleteRun(run.id);
    if (!result.storage.ok) log(`run ${run.id} apagada, mas o storage falhou: ${result.storage.error}`);
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------------------------------------
// Biblioteca — compartilhada com toda a equipe interna
// ---------------------------------------------------------------------------------------------

app.get(
  "/api/spy/library",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    const raw = req.query.especialidade;
    const especialidades = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(String);
    const rows = await listLibrary({ especialidades });
    const admin = await isAdmin(userId).catch(() => false);
    // A Biblioteca é da equipe, o favorito é de cada um: a estrela vem dos favoritos DESTE usuário.
    // Se a tabela ainda não existe (migração não rodada), a lista continua servindo sem estrela.
    const favoritos = await listFavoritos(userId).catch(() => new Set());
    res.json({
      entries: rows.map(({ ads, ...e }) => ({
        ...e,
        adCount: Array.isArray(ads) ? ads.length : 0,
        // Até 4 anúncios com thumbnail, para a capa do card.
        coverAdIds: (Array.isArray(ads) ? ads : []).filter((a) => a.thumb_path).slice(0, 4).map((a) => a.id),
        canDelete: admin || e.saved_by === userId,
        favorito: favoritos.has(e.id),
      })),
    });
  })
);

app.put(
  "/api/spy/library/:id/favorito",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    // Não confere dono: favoritar é ato de quem lê, e toda a equipe interna lê tudo. O que a
    // rota garante é que o favorito é gravado para QUEM CHAMOU, nunca para outra pessoa.
    const entry = await getLibraryEntry(req.params.id);
    if (!entry) return res.status(404).json({ error: "Análise não encontrada." });
    const favorito = req.body?.favorito !== false;
    await setFavorito(entry.id, userId, favorito);
    res.json({ ok: true, favorito });
  })
);

app.get(
  "/api/spy/library/:id",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    const entry = await getLibraryEntry(req.params.id);
    if (!entry) return res.status(404).json({ error: "Análise não encontrada." });
    const admin = await isAdmin(userId).catch(() => false);
    res.json({ entry: { ...entry, canDelete: admin || entry.saved_by === userId } });
  })
);

app.delete(
  "/api/spy/library/:id",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    const entry = await getLibraryEntry(req.params.id);
    if (!entry) return res.status(404).json({ error: "Análise não encontrada." });
    if (entry.saved_by !== userId && !(await isAdmin(userId))) {
      return res.status(403).json({ error: "Só quem salvou a análise ou um administrador pode apagá-la." });
    }
    await deleteLibraryEntry(entry.id);
    // Mesma razão da composição: sem FK, a limpeza é responsabilidade de quem apaga o artefato.
    await deleteAvaliacoes("analise", entry.id);
    log(`biblioteca ${entry.id} apagada por ${userId}`);
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------------------------------------
// Análises de Criativos — a dissecação de UM anúncio (ver criativo.js)
// ---------------------------------------------------------------------------------------------

/** Análises de criativo rodando NESTE processo. Cada uma pode passar pelo Whisper: o teto é de CPU. */
const criativosEmCurso = new Set();
const MAX_CRIATIVOS_INFLIGHT = 2;

/**
 * O anúncio a analisar, de uma busca DESTA pessoa ou de uma Mineração Salva (que é da equipe).
 * `null` = não existe ou não pertence à origem informada — o mesmo 404 para os dois casos.
 */
async function anuncioParaAnalisar({ runId, libraryEntryId, adId, userId }) {
  if (runId) {
    const run = await getRun(runId);
    if (!run || run.user_id !== userId) return null;
    const ad = await getAd(adId);
    return ad && ad.run_id === run.id ? { ad, origem: { run_id: run.id } } : null;
  }
  if (libraryEntryId) {
    const entry = await getLibraryEntry(libraryEntryId);
    const ad = (Array.isArray(entry?.ads) ? entry.ads : []).find((a) => Number(a.id) === adId);
    if (!ad) return null;
    // O snapshot da Biblioteca não guarda o link da CDN; a linha viva da busca, se ainda existir,
    // pode ter um (ou a transcrição feita depois do salvamento).
    const vivo = await getAd(adId).catch(() => null);
    return { ad: { ...ad, ...(vivo || {}) }, origem: { library_entry_id: entry.id, run_id: entry.run_id || null } };
  }
  return null;
}

app.post(
  "/api/spy/criativos",
  wrap(async (req, res) => {
    const { userId, name } = await requireInternalUser(req);
    if (!dbEnabled()) {
      return res.status(503).json({ error: "Worker sem SUPABASE_SERVICE_KEY — não é possível analisar." });
    }
    const adId = Number(req.body?.adId);
    if (!Number.isInteger(adId) || adId <= 0) throw new BadRequest("Anúncio não informado.");
    const runId = req.body?.runId ? String(req.body.runId) : null;
    const libraryEntryId = req.body?.libraryEntryId ? String(req.body.libraryEntryId) : null;
    if (!runId && !libraryEntryId) throw new BadRequest("Informe a busca ou a mineração salva do anúncio.");
    if ((runId && !UUID.test(runId)) || (libraryEntryId && !UUID.test(libraryEntryId))) {
      throw new BadRequest("Origem do anúncio inválida.");
    }
    const especialidade = String(req.body?.especialidade ?? "").trim().slice(0, 200);
    if (!especialidade) throw new BadRequest("Escolha a especialidade da análise.");
    const titulo = String(req.body?.titulo ?? "").trim().slice(0, 200) || null;

    if (criativosEmCurso.size >= MAX_CRIATIVOS_INFLIGHT) {
      return res.status(503).json({ error: "Há análises de criativo em andamento. Tente em instantes." });
    }
    const achado = await anuncioParaAnalisar({ runId, libraryEntryId, adId, userId });
    if (!achado) return res.status(404).json({ error: "Anúncio não encontrado." });
    const { ad, origem } = achado;

    // Grava `running` ANTES de responder: a tela abre o item e faz polling pelo que leu.
    const row = await insertCriativo({
      ...origem,
      ad_id: adId,
      titulo,
      especialidades: [especialidade],
      ad: snapshotDoAnuncio(ad),
      status: "running",
      etapa: "começando",
      saved_by: userId,
      saved_by_name: name,
    });

    criativosEmCurso.add(row.id);
    const say = (m) => log(m);
    const provider = providerForAd(ad.source);
    void runCriativo({
      id: row.id,
      ad,
      log: say,
      deps: {
        downloadable: provider?.downloadable !== false,
        // Peça sem texto (reel de perfil, anúncio do TikTok, Google) ou short sem legenda: o detalhe
        // da fonte completa, a 1 crédito, como na análise da mineração — e uma vez só.
        completar: async (peca) => {
          if (!provider?.needsHydration?.(peca) || typeof provider.fetchAdById !== "function") return peca;
          const fresh = await provider.fetchAdById(peca.external_id, { log: say, ad: peca }).catch((err) => {
            say(`[criativo ${row.id}] completar: ${err.message}`);
            return null;
          });
          if (!fresh) return peca;
          const patch = {
            metrics: { ...(peca.metrics || {}), ...(fresh.metrics || {}), hydrated: true },
            ...(fresh.adCopy ? { ad_copy: fresh.adCopy } : {}),
            ...(fresh.title && !peca.title ? { title: fresh.title } : {}),
            ...(fresh.mediaUrl ? { media_url: fresh.mediaUrl } : {}),
            ...(fresh.transcript && !peca.transcript
              ? { transcript: fresh.transcript, transcript_lang: fresh.transcriptLang || null, transcript_model: `legendas-${peca.source}` }
              : {}),
          };
          await patchAd(peca.id, patch).catch(() => {});
          return { ...peca, ...patch };
        },
        baixar: async (peca) => {
          if (peca.media_path) {
            const bytes = await storageDownload(peca.media_path).catch(() => null);
            if (bytes) return bytes;
          }
          return downloadVideo(peca, provider, { log: say });
        },
        transcrever: transcreverComWhisper({ transcribeBatch, log: say }),
        gravarAnuncio: (id, patch) => patchAd(id, patch).catch(() => {}),
        perguntar: perguntarAoSpyagent({ id: row.id, log: say }),
        gravar: (patch) => patchCriativo(row.id, patch),
      },
    })
      .then(() => log(`criativo ${row.id} analisado`))
      .catch((err) => falhaDoCriativo(row.id, err))
      .finally(() => criativosEmCurso.delete(row.id));

    log(`criativo ${row.id} (anúncio ${adId}) por ${userId}`);
    res.status(202).json({ id: row.id, status: row.status });
  })
);

/**
 * O fim de uma análise de criativo que não deu certo. "Não é possível" (sem vídeo, vídeo fechado,
 * sem fala) vai com o motivo, para a pessoa saber que não é o sistema que quebrou.
 */
async function falhaDoCriativo(id, err) {
  const impossivel = err instanceof DissecacaoImpossivel;
  const msg = impossivel ? mensagemImpossivel(err.message) : String(err?.message || err).slice(0, 500);
  log(`criativo ${id} ${impossivel ? "impossível" : "FALHOU"}: ${msg}`);
  await patchCriativo(id, { status: "error", etapa: null, error: msg }).catch(() => {});
}

/**
 * Dissecação de um criativo DO CLIENTE (Composer › Análises de Criativos › Criativos Internos).
 *
 * O anúncio é lido da tabela da conta de anúncios pelo `Ad_ID`, e não do que a tela mandou: o que
 * vai à API e ao agente sai do banco. O vídeo vem do link do post, pela Scrape Creators.
 *
 * Uma por anúncio: pedir de novo um criativo que já tem análise (rodando ou pronta) devolve a que
 * existe. A especialidade fica para depois (PATCH), porque a tela a pergunta com a dissecação pronta.
 */
app.post(
  "/api/spy/criativos/interno",
  wrap(async (req, res) => {
    const { userId, name } = await requireInternalUser(req);
    if (!dbEnabled()) {
      return res.status(503).json({ error: "Worker sem SUPABASE_SERVICE_KEY — não é possível analisar." });
    }
    const cliente = String(req.body?.cliente ?? "").trim().slice(0, 200);
    if (!cliente) throw new BadRequest("Informe o cliente.");
    const metaAdId = String(req.body?.metaAdId ?? "").trim();
    if (!/^\d{5,25}$/.test(metaAdId)) throw new BadRequest("Id do anúncio inválido.");

    const existente = await getCriativoInterno(metaAdId);
    if (existente) return res.json({ id: existente.id, status: existente.status, existente: true });

    if (criativosEmCurso.size >= MAX_CRIATIVOS_INFLIGHT) {
      return res.status(503).json({ error: "Há análises de criativo em andamento. Tente em instantes." });
    }
    const linha = await readCriativoMetaAd(metaAdId);
    if (!linha) return res.status(404).json({ error: "Anúncio não encontrado na conta do cliente." });
    const peca = pecaDoCriativoInterno(linha);

    const row = await insertCriativo({
      origem: "cliente",
      cliente,
      meta_ad_id: metaAdId,
      titulo: String(req.body?.titulo ?? "").trim().slice(0, 200) || linha.Nome_Anuncio || null,
      especialidades: [],
      ad: peca,
      status: "running",
      etapa: "começando",
      saved_by: userId,
      saved_by_name: name,
    });

    criativosEmCurso.add(row.id);
    const say = (m) => log(m);
    void runCriativo({
      id: row.id,
      ad: peca,
      log: say,
      deps: {
        interno: true,
        downloadable: true,
        etapaCompletar: "buscando o vídeo no Facebook",
        completar: (p) => completarInterno(p, { scGet }),
        baixar: (p) => fetchMedia(p.media_url),
        transcrever: transcreverComWhisper({ transcribeBatch, log: say }),
        perguntar: perguntarAoSpyagent({ id: row.id, log: say }),
        gravar: (patch) => patchCriativo(row.id, patch),
      },
    })
      .then(() => log(`criativo interno ${row.id} analisado`))
      .catch((err) => falhaDoCriativo(row.id, err))
      .finally(() => criativosEmCurso.delete(row.id));

    log(`criativo interno ${row.id} (anúncio ${metaAdId}, ${cliente}) por ${userId}`);
    res.status(202).json({ id: row.id, status: row.status });
  })
);

/** Onde a análise fica salva: a especialidade (uma) e o nome. Quem pediu, ou admin. */
app.patch(
  "/api/spy/criativos/:id",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    const criativo = await getCriativo(req.params.id);
    if (!criativo) return res.status(404).json({ error: "Análise de criativo não encontrada." });
    if (criativo.saved_by !== userId && !(await isAdmin(userId))) {
      return res.status(403).json({ error: "Só quem pediu a análise ou um administrador pode alterá-la." });
    }
    const patch = {};
    if (req.body?.especialidade !== undefined) {
      const esp = String(req.body.especialidade ?? "").trim().slice(0, 200);
      if (!esp) throw new BadRequest("Escolha a especialidade.");
      patch.especialidades = [esp];
    }
    if (req.body?.titulo !== undefined) patch.titulo = String(req.body.titulo ?? "").trim().slice(0, 200) || null;
    if (!Object.keys(patch).length) throw new BadRequest("Nada para alterar.");
    await patchCriativo(criativo.id, patch);
    res.json({ ok: true });
  })
);

app.get(
  "/api/spy/criativos",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    const raw = req.query.especialidade;
    const especialidades = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(String);
    const origem = req.query.origem === "cliente" || req.query.origem === "mineracao" ? String(req.query.origem) : null;
    const cliente = req.query.cliente ? String(req.query.cliente).slice(0, 200) : null;
    const rows = await listCriativos({ especialidades, origem, cliente });
    const admin = await isAdmin(userId).catch(() => false);
    const favoritos = await listFavoritosCriativos(userId).catch(() => new Set());
    res.json({
      criativos: rows.map(({ ad, ...c }) => ({
        ...c,
        dissecacao: resumoDaDissecacao(c.dissecacao),
        // A lista não precisa do texto inteiro nem da transcrição: só o que desenha o card.
        ad: ad
          ? {
              id: ad.id,
              source: ad.source,
              found_via: ad.found_via ?? null,
              page_name: ad.page_name ?? null,
              media_type: ad.media_type ?? null,
              thumb_path: ad.thumb_path ?? null,
              // Criativo interno: a miniatura é a do bucket público da conta de anúncios.
              thumb_public_url: ad.thumb_public_url ?? null,
              ad_copy: String(ad.ad_copy || ad.title || "").slice(0, 280),
            }
          : null,
        canDelete: admin || c.saved_by === userId,
        favorito: favoritos.has(c.id),
      })),
    });
  })
);

app.get(
  "/api/spy/criativos/:id",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    const criativo = await getCriativo(req.params.id);
    if (!criativo) return res.status(404).json({ error: "Análise de criativo não encontrada." });
    const admin = await isAdmin(userId).catch(() => false);
    const favoritos = await listFavoritosCriativos(userId).catch(() => new Set());
    res.json({
      criativo: { ...criativo, canDelete: admin || criativo.saved_by === userId, favorito: favoritos.has(criativo.id) },
    });
  })
);

app.put(
  "/api/spy/criativos/:id/favorito",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    const criativo = await getCriativo(req.params.id);
    if (!criativo) return res.status(404).json({ error: "Análise de criativo não encontrada." });
    const favorito = req.body?.favorito !== false;
    await setFavoritoCriativo(criativo.id, userId, favorito);
    res.json({ ok: true, favorito });
  })
);

app.delete(
  "/api/spy/criativos/:id",
  wrap(async (req, res) => {
    const { userId } = await requireInternalUser(req);
    const criativo = await getCriativo(req.params.id);
    if (!criativo) return res.status(404).json({ error: "Análise de criativo não encontrada." });
    if (criativo.saved_by !== userId && !(await isAdmin(userId))) {
      return res.status(403).json({ error: "Só quem pediu a análise ou um administrador pode apagá-la." });
    }
    if (criativosEmCurso.has(criativo.id)) {
      return res.status(409).json({ error: "Aguarde a análise terminar para apagá-la." });
    }
    await deleteCriativo(criativo.id);
    await deleteAvaliacoes("criativo", criativo.id);
    log(`criativo ${criativo.id} apagado por ${userId}`);
    res.json({ ok: true });
  })
);

/** No boot: o que ficou "rodando" da vida anterior do processo não tem mais quem feche. */
async function fecharCriativosOrfaos() {
  const rodando = await listCriativosRodando().catch(() => []);
  for (const c of rodando) {
    await patchCriativo(c.id, {
      status: "error",
      etapa: null,
      error: "O worker reiniciou no meio da análise. Peça de novo.",
    }).catch(() => {});
  }
  if (rodando.length) log(`${rodando.length} análise(s) de criativo órfã(s) fechada(s)`);
}

// ---------------------------------------------------------------------------------------------
// Mídia
// ---------------------------------------------------------------------------------------------

/** Nome amigável e seguro para o arquivo baixado: anunciante + id da biblioteca. */
function videoFileName(ad) {
  const anunciante = (ad.page_name || "anuncio")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Só ASCII simples: `Content-Disposition` com acento ou aspas vira nome quebrado no download.
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "anuncio";
  const id = String(ad.external_id || ad.id).replace(/[^0-9a-zA-Z]/g, "");
  return `${anunciante}-${id}.mp4`;
}

/**
 * O arquivo de vídeo do anúncio, para baixar.
 *
 * Duas origens, nesta ordem:
 *   1. o bucket, quando o vídeo foi guardado (só acontece com SPY_KEEP_VIDEO=1, e só para anúncio
 *      que chegou a ser transcrito) — é durável;
 *   2. a CDN da Meta, pelo link assinado que veio da busca — é o caso comum, e EXPIRA em horas.
 *
 * Passa pelo worker em vez de o navegador ir direto na CDN porque o atributo `download` de um <a>
 * é ignorado em outra origem: o clique abriria o vídeo numa aba em vez de baixar. Aqui também dá
 * para traduzir o link expirado em uma frase, em vez de um erro de rede.
 *
 * NÃO renova link expirado: renovar custa 1 crédito da Scrape Creators por anúncio, e gastar
 * crédito tem de ser decisão de quem clica, não efeito colateral de um botão de baixar.
 */
app.get(
  "/api/spy/media/:adId/video.mp4",
  wrap(async (req, res) => {
    await requireInternalUser(req);
    const ad = await getAd(req.params.adId);
    if (!ad) return res.status(404).json({ error: "Anúncio não encontrado." });

    const nomeArquivo = videoFileName(ad);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename="${nomeArquivo}"`);

    if (ad.media_path) {
      const bytes = await storageDownload(ad.media_path);
      if (bytes) return res.end(bytes);
    }

    if (!ad.media_url) {
      res.removeHeader("Content-Disposition");
      return res.status(404).json({ error: "Este anúncio não tem vídeo guardado." });
    }

    // SSRF guard: media_url vem de origem externa (scraper). Bloqueia esquema estranho e
    // qualquer host que resolva p/ rede interna/metadata (169.254.169.254, 127.x, 10.x, etc.).
    try {
      const mu = new URL(ad.media_url);
      if (mu.protocol !== "https:" && mu.protocol !== "http:") throw new Error("scheme");
      const { isIP, isIPv4 } = await import("node:net");
      const dns = await import("node:dns");
      const isPrivate = (ip) => {
        if (isIPv4(ip)) {
          const p = ip.split(".").map(Number);
          return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 169 && p[1] === 254) ||
                 (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) ||
                 (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
        }
        const l = ip.toLowerCase();
        return l === "::1" || l.startsWith("fe80") || l.startsWith("fc") || l.startsWith("fd");
      };
      if (isIP(mu.hostname) && isPrivate(mu.hostname)) throw new Error("ip");
      const addrs = await dns.promises.lookup(mu.hostname, { all: true }).catch(() => []);
      if (addrs.some((a) => isPrivate(a.address))) throw new Error("resolves-internal");
    } catch {
      res.removeHeader("Content-Disposition");
      return res.status(400).json({ error: "URL de mídia não permitida." });
    }
    // Com User-Agent: as CDNs do Instagram e do TikTok recusam requisição sem um.
    const upstream = await fetch(ad.media_url, { headers: { "User-Agent": MEDIA_UA } }).catch(() => null);
    if (!upstream?.ok || !upstream.body) {
      res.removeHeader("Content-Disposition");
      const onde =
        { instagram: "do Instagram", tiktok: "do TikTok", tiktok_organic: "do TikTok", youtube: "do YouTube", google: "do Google" }[
          ad.source
        ] || "da Meta";
      return res.status(410).json({
        error:
          `O link do vídeo na CDN ${onde} expirou (eles valem poucas horas). ` +
          "Abra a peça na origem para assistir, ou minere o tema de novo.",
      });
    }
    const tamanho = upstream.headers.get("content-length");
    if (tamanho) res.setHeader("Content-Length", tamanho);
    // Stream: um vídeo de dezenas de MB não precisa passar inteiro pela memória do worker.
    await pipeline(Readable.fromWeb(upstream.body), res);
  })
);

app.get(
  "/api/spy/media/:adId/:kind",
  wrap(async (req, res) => {
    // Qualquer usuário interno, não só o dono da busca: são anúncios PÚBLICOS de concorrentes, e a
    // Biblioteca é compartilhada — exigir dono deixaria as análises salvas sem imagem para os outros.
    await requireInternalUser(req);
    const kind = String(req.params.kind);
    if (kind !== "thumb.jpg" && kind !== "avatar.jpg") {
      return res.status(404).json({ error: "Mídia desconhecida." });
    }
    const ad = await getAd(req.params.adId);
    const objectPath = kind === "thumb.jpg" ? ad?.thumb_path : ad?.avatar_path;
    if (!objectPath) return res.status(404).json({ error: "Imagem não encontrada." });
    const bytes = await storageDownload(objectPath);
    if (!bytes) return res.status(404).json({ error: "Imagem não encontrada." });
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.end(bytes);
  })
);

// --- Central de Clientes › Brand kit (27/10/2026) — as rotas moram em brand-kit-rotas.js ---------
registrarRotasDoBrandKit(app, { wrap, log });
// --- Composer › Estático: artes (27/10/2026) — as rotas moram em artes-rotas.js -----------------
registrarRotasDasArtes(app, { wrap, log });

// Rota desconhecida sob /api/spy: responde JSON em vez da página HTML padrão do Express. O corpo
// HTML é justamente o que fazia o cliente confundir "worker velho" com "nginx sem o bloco".
app.use("/api/spy", (req, res) => {
  res.status(404).json({
    error:
      `Rota desconhecida: ${req.method} /api/spy${req.path}. ` +
      "Se ela existe no código, o worker está desatualizado — reinicie o serviço.",
  });
});

app.use((err, _req, res, _next) => {
  if (err instanceof AuthError || err instanceof ForbiddenError || err instanceof BadRequest) {
    return res.status(err.status).json({ error: err.message });
  }
  const status = Number(err?.status) || 500;
  log(`ERRO ${status}: ${err?.message || err}`);
  if (err?.detail) log(`  detalhe: ${err.detail}`);
  res.status(status).json({ error: status === 500 ? "Erro interno." : String(err.message) });
});

app.listen(PORT, HOST, async () => {
  log(`ouvindo em http://${HOST}:${PORT}`);
  // Antes de qualquer pedido novo: o que ficou `running` da vida anterior não tem mais quem feche.
  if (dbEnabled()) void fecharOrfas({ log });
  if (dbEnabled()) void fecharCriativosOrfaos();
  log(
    `  agente=${SPY_AGENT_ID} fonteMeta=${META_PROVIDER} bloco=${BLOCK_SIZE} ` +
      `páginas/bloco=${MAX_PAGES_PER_BLOCK} análises=${MAX_RUNS_INFLIGHT} buscas=${MAX_SEARCHES_INFLIGHT}`
  );
  if (!dbEnabled()) {
    log("  AVISO: SUPABASE_SERVICE_KEY ausente — POST /api/spy/runs vai responder 503.");
  }
  if (!GATEWAY_HAS_TOKEN && !GATEWAY_HAS_PASSWORD) {
    log(
      AGENT_TRANSPORT === "gateway"
        ? '  AVISO: sem OPENCLAW_GATEWAY_TOKEN/PASSWORD e transporte forçado em "gateway" — ' +
            'a Análise vai falhar com "device identity required".'
        : "  Gateway sem credencial; a Análise usa a CLI do openclaw (transporte " +
            `${AGENT_TRANSPORT}).`
    );
  }
  const stt = await probe().catch(() => null);
  if (stt) {
    log(
      `  faster-whisper=${stt.fasterWhisper ? "ok" : "AUSENTE"} ` +
        `device=${stt.device} modelo=${stt.model}` +
        (stt.cudaUnusable ? `  (GPU presente mas inutilizável: ${stt.cudaUnusable})` : "")
    );
  }
});
