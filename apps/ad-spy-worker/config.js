/**
 * Central config for the ad-spy worker.
 *
 * Mirrors the openclaw-bridge convention: every knob is an env var with a sane default, so the
 * service still starts (degraded, and saying so) when something is missing.
 */

// PRIMEIRO, antes de qualquer leitura de `process.env` abaixo: as credenciais do Supabase do
// arquivo central do servidor (ver shared/credenciais-supabase.js). Uma troca de chave feita lá
// passa a valer aqui no próximo reinício, sem mexer no `spy.env`.
import "../../shared/credenciais-supabase.js";

export const PORT = Number(process.env.PORT || 18901);
export const HOST = process.env.HOST || "127.0.0.1";

// Same Supabase project the bridge and the frontend use (companium-db / companium).
export const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://your-project-ref.supabase.co";
export const JWT_ISSUER = `${SUPABASE_URL}/auth/v1`;
export const JWT_AUDIENCE = "authenticated";
export const JWKS_URL = `${JWT_ISSUER}/.well-known/jwks.json`;

// service_role — bypasses RLS. Without it the worker cannot write a single row, so it refuses
// to accept runs rather than failing halfway through one.
export const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

export const MEDIA_BUCKET = process.env.SPY_MEDIA_BUCKET || "ad-spy-media";

// UMA run por vez, por padrão — número medido, não chutado: uma run de 4 anúncios com o modelo
// `medium` teve pico de 3.9 GB (Playwright + modelo na RAM), e o MemoryMax do systemd é 6 GB.
// Duas em paralelo pediriam ~7.8 GB e o systemd mataria o serviço no meio. Só aumente junto com
// o MemoryMax, e medindo de novo com o modelo que estiver em uso.
export const MAX_RUNS_INFLIGHT = Number(process.env.MAX_RUNS_INFLIGHT || 1);
// Buscas de bloco têm contador próprio: são leves com a Scrape Creators, e não podem ficar presas
// atrás de uma análise longa. Com o Playwright cada busca sobe um Chrome (~300-500 MB), daí o teto.
export const MAX_SEARCHES_INFLIGHT = Number(process.env.MAX_SEARCHES_INFLIGHT || 3);

// --- Sources ---------------------------------------------------------------------------------
// 'playwright' (default) or 'scrapecreators'. This single var is the whole fallback plan if Meta
// blocks the scraper from the server's datacenter IP.
export const META_PROVIDER = process.env.SPY_META_PROVIDER || "playwright";
export const SCRAPECREATORS_API_KEY = process.env.SCRAPECREATORS_API_KEY || "";
// Optional residential proxy for the Playwright provider, e.g. http://user:pass@host:port
export const SPY_PROXY = process.env.SPY_PROXY || "";
// Persistent browser profile: a returning visitor with cookies and history looks far less like a
// bot than a fresh incognito context on every run.
export const BROWSER_PROFILE = process.env.SPY_BROWSER_PROFILE || "";
export const CHROME_BIN =
  process.env.CHROME_BIN || process.env.GOOGLE_CHROME_BIN || "";

// --- Transcription ---------------------------------------------------------------------------
// No ffmpeg binary: faster-whisper 1.x decodes and resamples the mp4 with PyAV, which ships with
// it. Path to a python that has faster-whisper installed (a venv, typically).
export const PYTHON_BIN = process.env.SPY_PYTHON_BIN || "python3";
// Empty => auto-detect at startup (cuda if torch/ctranslate2 sees a GPU, else cpu).
export const WHISPER_DEVICE = process.env.SPY_WHISPER_DEVICE || "";
export const WHISPER_MODEL = process.env.SPY_WHISPER_MODEL || "";
export const WHISPER_LANG = process.env.SPY_WHISPER_LANG || "pt";
// Per-segment confidence cut. Empty => the sidecar's own default (-0.6), which was measured
// against real ads: genuine speech scores around -0.2, hallucinated music around -0.85. Loosen
// this only if legitimate transcripts start disappearing.
export const WHISPER_LOG_PROB_MIN = process.env.SPY_WHISPER_LOG_PROB_MIN || "";
// Per-file ceiling so one pathological video cannot stall a whole run.
export const TRANSCRIBE_TIMEOUT_MS = Number(
  process.env.SPY_TRANSCRIBE_TIMEOUT_MS || 180000
);

// Keep the downloaded mp4 after transcription? Off by default: once the transcript exists the
// bytes have no reader, and `permalink` always leads back to the real ad.
export const KEEP_VIDEO = process.env.SPY_KEEP_VIDEO === "1";

// --- OpenClaw Gateway -------------------------------------------------------------------------
// Lidas aqui só para o /health poder DIZER se estão configuradas. Quem de fato as consome é o
// runAgentStream do bridge, direto do process.env. Sem elas o Gateway recusa o connect com
// "device identity required" — e isso só aparecia depois de minutos minerando e transcrevendo.
export const GATEWAY_URL =
  process.env.OPENCLAW_GATEWAY_URL ||
  `ws://127.0.0.1:${process.env.OPENCLAW_GATEWAY_PORT || 18789}`;
export const GATEWAY_HAS_TOKEN = Boolean(
  process.env.OPENCLAW_GATEWAY_TOKEN || process.env.OPENCLAW_GATEWAY_AUTH_TOKEN
);
export const GATEWAY_HAS_PASSWORD = Boolean(
  (process.env.OPENCLAW_GATEWAY_PASSWORD || "").trim()
);

// Binário da CLI do OpenClaw, usada como transporte alternativo ao Gateway.
export const OPENCLAW_BIN = process.env.OPENCLAW_BIN || "openclaw";
// "auto" (default) tenta o Gateway e cai para a CLI se o handshake for recusado;
// "cli" vai direto na CLI; "gateway" força o WebSocket e falha se ele recusar.
export const AGENT_TRANSPORT = process.env.SPY_AGENT_TRANSPORT || "auto";

// --- Analysis agent --------------------------------------------------------------------------
// A dedicated OpenClaw agent whose static context (persona, Companium background, how to read an
// ad-spy corpus, the output contract) lives in ITS OWN definition — see agent/spyagent.md.
// Deliberately addressed by env var and NOT present in `chatbot_bots`, so it never shows up in
// the chat bot picker and never depends on the user having a bot assigned.
export const SPY_AGENT_ID = process.env.SPY_AGENT_ID || "spyagent";
// A 30-ad corpus is a far bigger prompt than a chat turn, so the bridge's 300s chat default is
// too low here.
export const SPY_RUN_TIMEOUT_MS = Number(process.env.SPY_RUN_TIMEOUT_MS || 600000);
// Ceiling on the corpus we hand the agent. Transcripts are trimmed longest-first when over.
export const MAX_CORPUS_CHARS = Number(process.env.MAX_CORPUS_CHARS || 120000);

// --- Agente de resumo de clientes (Marketing › Clientes) --------------------------------------
// Mesmo desenho do SPY_AGENT_ID: agente dedicado, endereçado por env var, fora de `chatbot_bots`.
// A diferença é que ESTE tem ferramentas (ClickUp) configuradas do lado do servidor — ver
// agent/briefagent.md.
export const BRIEF_AGENT_ID = process.env.BRIEF_AGENT_ID || "briefagent";
// O prompt é pequeno (só a ficha), mas o agente consulta o ClickUp no meio — daí não ser o
// default de chat (300s) nem os 600s da análise de corpus.
export const BRIEF_RUN_TIMEOUT_MS = Number(process.env.BRIEF_RUN_TIMEOUT_MS || 300000);

// --- Agente do Ad Composer (Marketing › Composer) ----------------------------------------------
// Mesmo desenho dos outros dois: agente dedicado, endereçado por env var e fora de `chatbot_bots`,
// para não aparecer no seletor do /assistente. É texto-entra/texto-sai como o `spyagent`: tudo que
// ele precisa saber vai no prompt — ver agent/composeragent.md.
export const COMPOSER_AGENT_ID = process.env.COMPOSER_AGENT_ID || "composeragent";
// O prompt é grande (análise + anúncios + resumo), mas é uma chamada só, sem ferramenta no meio.
export const COMPOSER_RUN_TIMEOUT_MS = Number(process.env.COMPOSER_RUN_TIMEOUT_MS || 300000);
// Teto do prompt de composição. Menor que o da análise (120k) porque aqui a análise JÁ é um resumo
// do corpus: mandar o corpus inteiro de novo pagaria caro pela mesma informação.
export const MAX_COMPOSER_CHARS = Number(process.env.MAX_COMPOSER_CHARS || 80000);

// --- Artes estáticas (27/10/2026) -------------------------------------------------------------
// O agente que destrincha um anúncio pronto nos textos de cada página da arte. Mesmo desenho dos
// outros: dedicado, fora de `chatbot_bots`, texto-entra/texto-sai — ver agent/artagent.md.
export const ARTE_AGENT_ID = process.env.ARTE_AGENT_ID || "artagent";
export const ARTE_RUN_TIMEOUT_MS = Number(process.env.ARTE_RUN_TIMEOUT_MS || 240000);
// A página de render (render.html, do build do site) que o Chrome sem tela abre. É a URL pública
// porque o nginx só responde pelo server_name; em desenvolvimento, aponte para o Vite
// (http://localhost:8080/render.html).
export const POST_RENDER_URL = process.env.POST_RENDER_URL || "https://companium.example.com/render.html";
// Sem render pedido por este tempo, o Chrome fecha: ele ocupa ~300 MB, e o MemoryMax do serviço
// (6 GB) é dividido com o Whisper.
export const POST_RENDER_OCIOSO_MS = Number(process.env.POST_RENDER_OCIOSO_MS || 90000);

// --- Agente de Pesquisa (sugestão de palavras-chave) --------------------------------------------
// Mesmo desenho dos outros: agente dedicado, endereçado por env var e fora de `chatbot_bots`.
// COM FERRAMENTA, como o `briefagent`: ele pesquisa na web. Ver agent/pesquisaagent.md.
export const PESQUISA_AGENT_ID = process.env.PESQUISA_AGENT_ID || "pesquisaagent";
// Mais longo que as outras chamadas porque há navegação no meio — cada busca é uma ida à rede.
export const PESQUISA_RUN_TIMEOUT_MS = Number(process.env.PESQUISA_RUN_TIMEOUT_MS || 420000);

// --- Agente da pergunta ao grid (Mineração) -----------------------------------------------------
// SEM ferramenta, como o `spyagent`: ele só lê as peças que recebe. Ver agent/perguntaagent.md.
export const PERGUNTA_AGENT_ID = process.env.PERGUNTA_AGENT_ID || "perguntaagent";
// Por LOTE de peças, não pela pergunta inteira: cada lote é uma chamada curta.
export const PERGUNTA_RUN_TIMEOUT_MS = Number(process.env.PERGUNTA_RUN_TIMEOUT_MS || 180000);
// Perguntas rodando ao mesmo tempo no worker. Cada uma é um subprocesso do OpenClaw por vez.
export const MAX_PERGUNTAS_INFLIGHT = Number(process.env.SPY_MAX_PERGUNTAS_INFLIGHT || 2);

// --- Agente do Relatório (Marketing › Clientes) -------------------------------------------------
// Mesmo desenho dos outros três: agente dedicado, endereçado por env var e fora de `chatbot_bots`.
// É texto-entra/texto-sai como o `spyagent` e o `composeragent`: os números chegam prontos no prompt,
// vindos da TELA — ver agent/relatoriomarketingagent.md e src/utils/relatorioSnapshot.ts. O agente é
// dedicado a MARKETING (Hook/Hold + criativo); o `relatorioagent` RevOps foi aposentado.
export const RELATORIO_AGENT_ID = process.env.RELATORIO_AGENT_ID || "relatoriomarketingagent";
// Uma chamada só, sem ferramenta no meio, mas o raciocínio é mais longo que o de uma composição.
export const RELATORIO_RUN_TIMEOUT_MS = Number(process.env.RELATORIO_RUN_TIMEOUT_MS || 300000);
// Teto do prompt. Bem menor que o da Mineração porque aqui não há corpus: são ~14 métricas e dois
// períodos. Se passar disso, alguém está mandando linha crua no snapshot.
export const MAX_RELATORIO_CHARS = Number(process.env.MAX_RELATORIO_CHARS || 60000);
// Teto do snapshot que a tela manda. O `express.json` do serviço é 256 KB e vale para TODAS as rotas;
// este limite é o da rota, conferido no validador para a recusa sair em português em vez do 413 cru
// do body-parser. Um snapshot de um cliente tem poucos KB.
export const MAX_SNAPSHOT_BYTES = Number(process.env.MAX_SNAPSHOT_BYTES || 128 * 1024);
// O nome que a pessoa dá ao relatório. Curto de propósito: é rótulo de prateleira para achar o
// relatório no histórico, numa coluna estreita onde texto longo é truncado e não ajuda ninguém.
export const MAX_TITULO_RELATORIO = Number(process.env.MAX_TITULO_RELATORIO || 120);
// Quantos dias um relatório pode analisar. Acima disso as metas mensais pró-rateadas atravessam
// tantos meses que o alvo perde sentido, e o prompt incha sem ganhar leitura.
export const MAX_RELATORIO_DIAS = Number(process.env.MAX_RELATORIO_DIAS || 400);

// --- ClickUp (aba Documentos de Marketing › Central de Clientes) --------------------------------
// Leitura DIRETA do ClickUp pelo worker, e de propósito fora do agente: lista de documento é DADO,
// não diagnóstico. Passar isso por um LLM custaria uma chamada de minutos para devolver o que uma
// requisição resolve, e abriria a porta para um nome de arquivo inventado — numa tela cuja única
// função é levar a pessoa ao documento certo. O `briefagent` continua com a ferramenta dele (que
// não tem docs, só tarefa) para o Contexto Operacional; este token não é o dele.
//
// **O token já existe no servidor** desde antes desta aba: é o mesmo segredo que o
// `bin/clickup-readonly-tool` do `briefagent` usa. O worker roda como `User=deploy`, o MESMO usuário
// do OpenClaw, então ele pode ler o arquivo onde o segredo já está — e duplicar um segredo em dois
// arquivos é criar dois lugares para rotacionar e um para esquecer.
//
// Por isso o nome da env var é procurado numa LISTA: assim o worker aproveita o nome que o servidor
// já usa, em vez de exigir que alguém renomeie a variável de um agente que está funcionando. A
// ordem é a preferência; a primeira preenchida ganha.
const CLICKUP_ENV_CANDIDATAS = [
  "CLICKUP_API_TOKEN",
  "CLICKUP_TOKEN",
  "CLICKUP_API_KEY",
  "CLICKUP_PERSONAL_TOKEN",
  "CLICKUP_PK",
];
/**
 * QUAL nome foi encontrado. Vai ao `/api/spy/health` e ao log: é o diagnóstico que importa quando a
 * aba diz que está sem credencial, e é o nome, nunca o valor — health é rota de usuário interno, e
 * segredo não se imprime nem para quem tem direito de ver o resto.
 */
export const CLICKUP_TOKEN_ENV =
  CLICKUP_ENV_CANDIDATAS.find((n) => (process.env[n] || "").trim()) || null;
export const CLICKUP_ENV_ACEITAS = CLICKUP_ENV_CANDIDATAS;
// Token pessoal (`pk_...`) ou OAuth; vai no header `Authorization` cru, sem "Bearer".
export const CLICKUP_API_TOKEN = CLICKUP_TOKEN_ENV
  ? String(process.env[CLICKUP_TOKEN_ENV]).trim()
  : "";
// O workspace. Sem ele o worker descobre sozinho SE houver exatamente um — com dois, adivinhar daria
// a aba de documentos do workspace errado, então ele exige a env var.
export const CLICKUP_TEAM_ID = (process.env.CLICKUP_TEAM_ID || "").trim();
// O índice é do workspace inteiro (busca de docs + hierarquia), compartilhado por todos os clientes:
// vale muito mais em cache do que por requisição. Documento novo aparece no próximo ciclo.
export const CLICKUP_CACHE_TTL_MS = Number(process.env.CLICKUP_CACHE_TTL_MS || 10 * 60 * 1000);
// Teto de páginas da busca de docs (100 por página). Guarda contra paginação que não termina; ao
// bater no teto a resposta sai marcada como truncada, nunca silenciosamente curta.
export const CLICKUP_MAX_DOC_PAGES = Number(process.env.CLICKUP_MAX_DOC_PAGES || 40);

// --- Busca em blocos ---------------------------------------------------------------------------
// Quantos anúncios QUE PASSAM NOS FILTROS aparecem a cada "carregar mais".
export const BLOCK_SIZE = Number(process.env.SPY_BLOCK_SIZE || 8);
// Teto de páginas da API por bloco. Com a Scrape Creators cada página é um crédito, e filtros
// rígidos podem exigir muitas páginas para achar 8 anúncios bons — este teto impede que um filtro
// apertado drene o saldo em silêncio: o bloco volta incompleto e a UI explica o porquê.
export const MAX_PAGES_PER_BLOCK = Number(process.env.SPY_MAX_PAGES_PER_BLOCK || 3);

/**
 * Orçamento de créditos por busca, por grupo de 4 anúncios pedidos: pedir 12 libera 30 créditos.
 *
 * Amarra o gasto ao tamanho do pedido em vez de a um teto fixo de páginas. Com filtro apertado uma
 * página pode não trazer nada que preste, e sem teto a busca drenaria o saldo em silêncio atrás de
 * anúncios que talvez não existam.
 */
export const CREDITS_PER_4_ADS = Number(process.env.SPY_CREDITS_PER_4_ADS || 10);

/** Quantos anúncios uma busca pode pedir, sempre múltiplo de 4. */
export const TARGET_MIN = 4;
export const TARGET_MAX = Number(process.env.SPY_TARGET_MAX || 40);
// Máximo de anúncios que podem ser marcados para análise de uma vez (corpus e tempo de CPU).
export const MAX_SELECTED = Number(process.env.SPY_MAX_SELECTED || 30);

// --- Limits on what the caller may ask for ---------------------------------------------------
export const MAX_TEMA_CHARS = Number(process.env.SPY_MAX_TEMA_CHARS || 200);
export const MAX_EXTRA_PROMPT_CHARS = Number(
  process.env.SPY_MAX_EXTRA_PROMPT_CHARS || 4000
);
// Guard against a hostile/huge creative. 60 MB covers any real ad video.
export const MAX_MEDIA_BYTES = Number(
  process.env.SPY_MAX_MEDIA_BYTES || 60 * 1024 * 1024
);

// --- Orquestrador (Marketing › Composer › Orquestrador) -----------------------------------------
// O agente que conduz uma composição do começo ao fim: lê os números, decide se a Biblioteca já tem
// uma análise que serve (ou pede uma mineração nova), escolhe relatórios e documentos e escreve o
// pedido ao Composer. Mesmo desenho dos outros: dedicado, endereçado por env var, fora de
// `chatbot_bots`, texto-entra/texto-sai. Ver agent/orquestradoragent.md.
export const ORQUESTRADOR_AGENT_ID = process.env.ORQUESTRADOR_AGENT_ID || "orquestradoragent";
export const ORQUESTRADOR_RUN_TIMEOUT_MS = Number(process.env.ORQUESTRADOR_RUN_TIMEOUT_MS || 300000);
export const MAX_ORQUESTRADOR_CHARS = Number(process.env.MAX_ORQUESTRADOR_CHARS || 60000);
// Uma por vez: cada orquestração pode ocupar a fila de análise (Whisper) e a do Composer por
// dezenas de minutos, e duas em paralelo disputariam as duas.
export const MAX_ORQUESTRACOES_INFLIGHT = Number(process.env.SPY_MAX_ORQUESTRACOES_INFLIGHT || 1);
// O que uma mineração AUTÔNOMA pode gastar. Ninguém aprova o gasto na hora, então o teto é este:
// `ORQ_TARGET_ADS` anúncios por busca (cada grupo de 4 libera CREDITS_PER_4_ADS créditos) vezes
// `ORQ_MAX_BUSCAS` palavras-chave tentadas. Com os defaults: 12 anúncios × 2 buscas = até 60
// créditos por orquestração, e só quando a Biblioteca não tem análise que sirva.
export const ORQ_TARGET_ADS = Number(process.env.ORQ_TARGET_ADS || 12);
export const ORQ_MAX_BUSCAS = Number(process.env.ORQ_MAX_BUSCAS || 2);
// Longevidade mínima das peças: é a única prova de desempenho que a Biblioteca da Meta dá, e sem
// uma pessoa para olhar o grid é o filtro que sobra.
export const ORQ_MIN_DIAS = Number(process.env.ORQ_MIN_DIAS || 30);
// Quantas peças vão para a análise. Cada vídeo é download + Whisper: é o custo de CPU da rodada.
export const ORQ_MAX_SELECIONADOS = Number(process.env.ORQ_MAX_SELECIONADOS || 10);
// Quanto esperar a fila de análise liberar antes de desistir da mineração e compor sem ela.
export const ORQ_ESPERA_ANALISE_MS = Number(process.env.ORQ_ESPERA_ANALISE_MS || 600000);

// --- Jev (TypeSafe, via OpenRouter) --------------------------------------------------------------
// Modelo de decisões fechadas (sim/não, escolha, nota) com probabilidade. Não escreve texto e não
// substitui agente nenhum. Desligado por padrão: com `JEV_ENABLED` diferente de "1", nenhuma
// chamada sai e tudo funciona como antes. Ver jev.js e docs/jev-api.md.
export const JEV_ENABLED = process.env.JEV_ENABLED === "1";
export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
export const JEV_ENDPOINT = process.env.JEV_ENDPOINT || "https://openrouter.ai/api/alpha/decisions";
// Versão FIXA, não o alias `~typesafe/jev-latest`: os limiares são calibrados para uma versão, e um
// alias que troca de versão sozinho invalida a calibração sem avisar.
export const JEV_MODELO = process.env.JEV_MODELO || "typesafe/jev-1.13";
// Medido em 15/10: ~385 ms por chamada com a conexão aberta, 645 ms na primeira.
export const JEV_TIMEOUT_MS = Number(process.env.JEV_TIMEOUT_MS || 3000);
// Chamadas simultâneas. O limite de requisições do OpenRouter não é publicado; isto é proteção.
export const JEV_CONCORRENCIA = Number(process.env.JEV_CONCORRENCIA || 20);
