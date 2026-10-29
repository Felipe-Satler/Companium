// Client for the ad-spy worker (served same-origin at /api/spy, see apps/ad-spy-worker).
// Every call carries the Supabase JWT, and the worker refuses any user who has a
// `user_client_scope` row — Mineração is internal-only.
//
// Shaped after src/chatbot/react/libraryApi.ts so both backend clients read the same way.

const BASE = (import.meta.env.VITE_SPY_ENDPOINT as string | undefined) ?? "/api/spy";

export type SpyStageKey = "discover" | "collect" | "download" | "transcribe" | "analyze";
export type SpyStageStatus = "pending" | "running" | "done" | "error" | "skipped";

export type SpyStage = {
  key: SpyStageKey;
  label: string;
  status: SpyStageStatus;
  done: number;
  total: number | null;
  started_at: string | null;
  ended_at: string | null;
  note: string | null;
};

/**
 * searching           = buscando um bloco de anúncios (UI faz polling)
 * awaiting_selection  = grid na tela, esperando a pessoa marcar (sem polling)
 * running             = transcrevendo e analisando os marcados (UI faz polling)
 */
export type SpyRunStatus =
  | "queued"
  | "searching"
  | "awaiting_selection"
  | "running"
  | "done"
  | "error"
  | "canceled";

export type SpySettings = {
  country: string;
  language: string | null;
  status: "ACTIVE" | "INACTIVE" | "ALL";
  mediaType: "all" | "video" | "image";
  sortBy: "impressions" | "relevancy";
  startDate: string | null;
  endDate: string | null;
  /** Quantos anúncios a busca persegue. Múltiplo de 4 — o orçamento de créditos é por grupo de 4. */
  targetAds: number;
  minDaysRunning: number;
  /** Mínimo de anúncios usando o mesmo criativo+texto. 0 = sem filtro. */
  minCollationCount: number;
  maxPerAdvertiser: number;
  minCopyChars: number;
  transcribe: boolean;
  // Opcionais: runs gravadas antes das fontes do Instagram não têm estas chaves.
  /** Instagram: mínimo de visualizações. É a prova do orgânico, como a longevidade é a do anúncio. */
  minViews?: number;
  /** Instagram: hashtag da trilha "hashtag". Vazio = derivada do tema no worker. */
  instagramHashtag?: string | null;
  /** Instagram: "@perfil" ou "post:SHORTCODE" (o worker normaliza links colados). */
  instagramProfiles?: string[];
  /** Orgânico: mínimo de (curtidas + comentários) / visualizações, em %. */
  minEngagementPct?: number;
  /** Instagram: mínimo de visualizações ÷ seguidores do autor (1 = alcançou a própria base). */
  minViewsPerFollower?: number;
  /** TikTok: piso da faixa de alcance estimado (0, 1 mil, 10 mil, 100 mil, 1 mi, 10 mi). */
  minTikTokAudience?: number;
  /** YouTube Shorts: hashtag da trilha "hashtag". Vazio = derivada do tema no worker. */
  youtubeHashtag?: string | null;
  /** YouTube Shorts: "@canal", "channel:UC…" ou "short:<id>" (o worker normaliza links colados). */
  youtubeChannels?: string[];
  /** Google Ads: "id:AR…" ou "site:dominio.com" (o worker normaliza links colados). */
  googleAdvertisers?: string[];
  /** TikTok orgânico: hashtag da trilha "hashtag". Vazio = derivada do tema no worker. */
  tiktokHashtag?: string | null;
  /** TikTok orgânico: "@perfil", "video:<perfil>/<id>" ou "curto:…" (o worker normaliza links colados). */
  tiktokProfiles?: string[];
  /** Só nas buscas "minerar este anunciante": de quem são os anúncios e de qual busca a pessoa veio. */
  advertiser?: SpyAdvertiser | null;
};

export type SpyAdvertiser = { pageId: string; pageName: string | null; fromRunId: string | null };

/**
 * O que se pode pedir em `sources`: uma plataforma (meta, tiktok) ou um modo do Instagram. Cada um
 * vira uma trilha de busca no worker (apps/ad-spy-worker/sources/index.js › lanesFor).
 */
export type SpySourceId =
  | "meta"
  | "tiktok"
  | "tiktok_videos"
  | "tiktok_hashtag"
  | "tiktok_profile"
  | "instagram_ads"
  | "instagram_reels"
  | "instagram_hashtag"
  | "instagram_profile"
  | "youtube_shorts"
  | "youtube_hashtag"
  | "youtube_channel"
  /** Não é opção do formulário: nasce do botão "minerar este anunciante" de um card. */
  | "meta_advertiser"
  /** Google Ads pelo tema: anunciantes cujo NOME tem o tema (o Google não busca por palavra-chave). */
  | "google"
  | "google_advertiser";

/** A plataforma de uma peça já minerada (`ad_spy_ads.source`). */
export type SpyPlatform = "meta" | "google" | "instagram" | "tiktok" | "tiktok_organic" | "youtube";

export const PLATFORM_LABEL: Record<string, string> = {
  meta: "Meta Ads",
  google: "Google Ads",
  instagram: "Instagram",
  tiktok: "TikTok Ads",
  // Plataforma à parte de `tiktok` (a Biblioteca de Anúncios): os filtros decidem pelo `source`.
  tiktok_organic: "TikTok",
  youtube: "YouTube Shorts",
};

/**
 * Números que só algumas fontes têm — o significado muda de fonte para fonte, por isso fora das
 * colunas. Todo campo pode faltar.
 */
export type SpyAdMetrics = {
  // Instagram (orgânico)
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  followers?: number | null;
  paidPartnership?: boolean | null;
  /** (curtidas + comentários) / visualizações (ou / seguidores, ver `engagementBasis`). Fração. */
  engagementRate?: number | null;
  engagementBasis?: "views" | "followers" | null;
  /** Visualizações ÷ seguidores do autor. */
  viewsPerFollower?: number | null;
  // Meta Ads
  /** Curtidas da página do anunciante — tamanho do anunciante, não desempenho da peça. */
  pageLikes?: number | null;
  // TikTok Ads
  lastShownOn?: string | null;
  estimatedAudience?: string | null;
  impressions?: number | null;
  spent?: string | null;
  shares?: number | null;
  /** TikTok orgânico: quantas pessoas salvaram o vídeo. */
  saves?: number | null;
  ctr?: number | null;
  creativeCenterUrl?: string | null;
  // Google Ads
  /** "text" (anúncio de busca, mostrado como imagem), "image" ou "video". */
  googleFormat?: string | null;
  /** Faixa de impressões que o Google publica — só vem no detalhe. */
  impressionsRange?: { min: number | null; max: number | null } | null;
  regions?: string[] | null;
  youtubeId?: string | null;
  /** Já completado pelo detalhe da fonte. */
  hydrated?: boolean;
};

/**
 * Post orgânico, e não anúncio pago. Muda a leitura dos números: num anúncio, "dias" é tempo no
 * ar (alguém pagando); num post, é só a idade — quem prova é o engajamento.
 */
export const isOrganicAd = (ad: Pick<SpyAd, "source">) =>
  ad.source === "instagram" || ad.source === "youtube" || ad.source === "tiktok_organic";

/** The structured block the agent emits; every section may be absent or empty. */
/** Uma linha da dissecação: o anúncio lido por inteiro, antes de qualquer generalização. */
export type SpyDissecacao = {
  ad_id: number;
  formato?: string;
  estrutura?: string;
  anatomia_semantica?: string;
  anatomia_psicologica?: string;
  nivel_consciencia?: string;
};

/**
 * Um recorte de público que o nicho já ataca.
 *
 * `imediata` = a pessoa já quer resolver e está comparando fornecedor — é onde se segmenta
 * primeiro. `latente` = tem o problema, mas ainda não decidiu resolver.
 */
export type SpyPublico = {
  fatia: string;
  demanda?: "imediata" | "latente";
  evidencia?: string;
  por_que_segmentar?: string;
  exemplos?: number[];
};

export type SpyAnalysis = {
  dissecacoes?: SpyDissecacao[];
  publicos?: SpyPublico[];
  temas?: { nome: string; frequencia?: number; exemplos?: number[]; porque_funciona?: string }[];
  palavras?: { termo: string; ocorrencias?: number; contexto?: string }[];
  hooks?: { texto: string; ad_id?: number; tipo?: string }[];
  formatos?: { padrao: string; evidencia?: string }[];
  o_que_funciona?: string[];
  sugestoes?: { titulo: string; detalhe?: string; baseado_em?: number[] }[];
};

/** Resumo do estado da busca em blocos (o cursor da API não sai do worker). */
export type SpySearchSummary = {
  /** Não há mais anúncios que passem nos filtros. */
  exhausted: boolean;
  /** Anúncios que já passaram nos filtros e sairão no próximo bloco sem gastar crédito. */
  buffered: number;
  creditsUsed: number;
  pagesUsed: number;
  /** Anúncios que passaram nos filtros neste bloco. */
  found: number;
  /** Anúncios descartados pelos filtros neste bloco. */
  rejected: number;
  /** Meta de anúncios do bloco. */
  target: number;
  /** Teto de créditos do bloco. */
  creditBudget: number;
  /** Explica bloco incompleto ou fim da busca. */
  note: string | null;
};

export type SpyRun = {
  id: string;
  user_id: string;
  tema: string;
  sources: string[];
  settings: SpySettings;
  extra_prompt: string | null;
  status: SpyRunStatus;
  stages: SpyStage[];
  cancel_requested: boolean;
  analysis_md: string | null;
  analysis: SpyAnalysis | null;
  meta_provider: string | null;
  error: string | null;
  search: SpySearchSummary;
  /** "Perguntar ao grid": a última pergunta e o veredito por peça. Ausente em runs antigas. */
  question?: SpyQuestion | null;
  criado_em: string;
  updated_at: string;
};

export type SpyVeredito = "atende" | "parcial" | "nao";

export type SpyResposta = {
  /** `null` = a peça não tinha texto nenhum para ler (não é o mesmo que "não atende"). */
  veredito: SpyVeredito | null;
  /** Trecho literal da peça que justifica o veredito. O worker descarta o que não for literal. */
  trecho: string | null;
  /** O que foi lido: só título/texto, ou também a fala transcrita do vídeo. */
  base: "copy" | "transcricao" | "vazio";
};

/** Uma pergunta já respondida nesta busca, guardada para alternar sem reler o grid. */
export type SpyQuestionGuardada = {
  texto: string;
  concluido_em: string | null;
  respostas: Record<string, SpyResposta>;
};

/** A resposta de uma pergunta do grid, como ela vai dentro de um anúncio salvo na Biblioteca. */
export type SpyPerguntaDaPeca = SpyResposta & { texto: string };

export type SpyQuestion = {
  id: string | null;
  texto: string;
  /** "idle" = a pergunta da tela foi limpa, mas há outras guardadas. */
  status: "running" | "done" | "error" | "idle";
  error: string | null;
  pedido_em: string | null;
  concluido_em: string | null;
  total: number;
  feito: number;
  /** Por id de anúncio (como string — é chave de objeto JSON). */
  respostas: Record<string, SpyResposta>;
  /** As outras perguntas desta busca (até 4), da mais recente à mais antiga. */
  outras?: SpyQuestionGuardada[];
};

export type SpyAd = {
  id: number;
  run_id: string;
  source: string;
  external_id: string | null;
  page_name: string | null;
  page_id: string | null;
  /** Perfil do anunciante como a fonte informa (Facebook ou Instagram). Pode não existir. */
  page_profile_uri: string | null;
  permalink: string | null;
  ad_copy: string | null;
  title: string | null;
  cta_text: string | null;
  link_url: string | null;
  display_format: string | null;
  publisher_platform: string[] | null;
  started_running_on: string | null;
  days_running: number | null;
  media_type: string | null;
  thumb_path: string | null;
  avatar_path: string | null;
  media_path: string | null;
  /** Link assinado da CDN da Meta. EXPIRA em horas — só serve para tocar logo após a mineração. */
  media_url: string | null;
  duration_sec: number | null;
  transcript: string | null;
  transcript_lang: string | null;
  transcript_model: string | null;
  collation_count: number | null;
  is_active: boolean | null;
  selected: boolean;
  /** Qual trilha achou a peça (reels, hashtag:x, perfil:@x, link, busca). Vazio na Meta. */
  found_via?: string | null;
  /** Ausente em linhas de antes da migração de 08/10/2026. */
  metrics?: SpyAdMetrics | null;
  /** Só em anúncio salvo na Biblioteca: as perguntas feitas ao grid que leram esta peça. */
  perguntas?: SpyPerguntaDaPeca[];
  criado_em: string;
};

export type StartRunInput = {
  tema: string;
  sources: string[];
  settings: Partial<SpySettings>;
  extraPrompt?: string;
};

export type LibraryEntrySummary = {
  id: string;
  run_id: string | null;
  tema: string;
  titulo: string | null;
  especialidades: string[];
  saved_by: string;
  saved_by_name: string | null;
  criado_em: string;
  adCount: number;
  coverAdIds: number[];
  canDelete: boolean;
  /** Estrela DESTE usuário. A Biblioteca é da equipe; o favorito é de cada um. */
  favorito: boolean;
};

export type LibraryEntry = {
  id: string;
  run_id: string | null;
  tema: string;
  titulo: string | null;
  especialidades: string[];
  settings: SpySettings;
  extra_prompt: string | null;
  analysis_md: string;
  analysis: SpyAnalysis | null;
  /** Na ordem em que o agente leu — é por ela que a análise cita #1, #2… */
  ads: SpyAd[];
  saved_by: string;
  saved_by_name: string | null;
  criado_em: string;
  canDelete: boolean;
};

/**
 * Uma requisição ao worker. Exportada porque os resumos de Marketing › Clientes vivem no MESMO
 * serviço (`/api/spy/briefs`) e devem herdar o tratamento de erro daqui — em especial as mensagens
 * de 405/404 do nginx, que são o que transforma "deu erro" em "falta o bloco do nginx" ou "o
 * worker está rodando código velho".
 */
export async function spyRequest<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    // Dois problemas de infraestrutura diferentes chegam aqui como corpo não-JSON, e o STATUS os
    // separa com precisão:
    //
    //   405 -> o nginx não tem `location ^~ /api/spy/`, a requisição caiu no location de arquivo
    //          estático e o nginx recusa POST em arquivo estático.
    //   404 -> o nginx encaminhou (senão não haveria 404), mas o worker não conhece essa rota:
    //          está rodando código velho. O auto-deploy atualiza o frontend e NÃO reinicia o
    //          worker, então o botão novo chega antes da rota.
    const notJson = !(res.headers.get("content-type") || "").includes("json");
    if (notJson && res.status === 405) {
      throw new Error(
        "A requisição não chegou ao worker da Mineração: o nginx respondeu 405 em vez de " +
          "encaminhar. Falta o bloco `location ^~ /api/spy/` apontando para 127.0.0.1:18901."
      );
    }
    if (notJson && res.status === 404) {
      throw new Error(
        "O worker da Mineração não conhece esta rota — provavelmente está rodando uma versão " +
          "antiga. No servidor: `git pull && sudo systemctl restart ad-spy-worker` (o auto-deploy " +
          "atualiza o frontend, mas não reinicia o worker)."
      );
    }
    // The worker answers errors as { error }, written for the operator.
    let message = `Falha na requisição (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // non-JSON body; keep the generic message
    }
    throw new Error(message);
  }
  if (res.status === 204) return null as T;

  // A 200 that is HTML means nginx has no `location ^~ /api/spy/` yet, so the request fell through
  // to the SPA catch-all and we got index.html back.
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("json")) {
    throw new Error(
      "O worker da Mineração não respondeu (recebi HTML em vez de JSON). " +
        "Provavelmente o serviço ad-spy-worker não está no ar ou o nginx ainda não tem o bloco " +
        "/api/spy/."
    );
  }
  return (await res.json()) as T;
}

/** Uma palavra-chave sugerida pelo agente de pesquisa — hipótese, não veredito. */
export type TermoSugerido = {
  termo: string;
  porque: string;
  /** visto = achado em anúncio/conteúdo real · inferido = jargão do nicho · palpite = sem pesquisa. */
  confianca: "visto" | "inferido" | "palpite";
  onde: string;
};

export type PesquisaResult = {
  resumoMd: string;
  termos: TermoSugerido[];
  concorrentes: { nome: string; onde: string }[];
  vocabulario: string[];
  /** `web: false` significa que o agente NÃO conseguiu pesquisar — os termos são palpite. */
  fontes: { web: boolean };
  semBlocoJson: boolean;
};

/**
 * Pede palavras-chave ao agente de pesquisa. Não gasta crédito da Scrape Creators — quem gasta é a
 * sonda, depois, e só nos termos que a pessoa escolher testar.
 */
export const pesquisarTermos = (token: string, nicho: string, contexto?: string) =>
  spyRequest<PesquisaResult>("/pesquisa", token, {
    method: "POST",
    body: JSON.stringify({ nicho, contexto }),
  });

/** Placar de um termo numa fonte: o que 1 crédito comprou de informação. */
export type ProbeResult = {
  termo: string;
  /** Fonte testada. Ausente em respostas do worker antigo, que só testava Meta. */
  fonte?: SpySourceId | null;
  /** O que foi de fato consultado, quando difere do termo (ex.: "#harmonizacaofacial"). */
  consulta?: string | null;
  /** Peças que a página devolveu, antes dos filtros. */
  retornados: number;
  /** Quantos passariam nos filtros da busca de verdade — é o número que decide. */
  passaram: number;
  /** Anunciantes (ou perfis) distintos entre os aprovados. */
  anunciantes: number;
  /** Mediana de dias no ar dos anúncios pagos aprovados. */
  medianaDias: number | null;
  /** Mediana de visualizações dos posts orgânicos aprovados. */
  medianaViews?: number | null;
  /** Motivo -> quantos caíram por ele. Diz qual filtro relaxar. */
  motivos: Record<string, number>;
  temMais: boolean;
  erro: string | null;
};

/** Fontes que a sonda sabe testar: as que buscam por palavra-chave. */
export const PROBE_SOURCES: { id: SpySourceId; label: string; organico: boolean }[] = [
  { id: "meta", label: "Meta Ads", organico: false },
  { id: "instagram_ads", label: "Instagram Ads", organico: false },
  { id: "instagram_reels", label: "Instagram reels", organico: true },
  { id: "instagram_hashtag", label: "Instagram hashtag", organico: true },
  { id: "tiktok", label: "TikTok Ads", organico: false },
  { id: "tiktok_videos", label: "TikTok vídeos", organico: true },
  { id: "tiktok_hashtag", label: "TikTok hashtag", organico: true },
  { id: "youtube_shorts", label: "YouTube Shorts", organico: true },
  { id: "youtube_hashtag", label: "YouTube hashtag", organico: true },
];

/** Espelha MAX_PROBE_CALLS do worker: palavras × fontes por teste. */
export const MAX_PROBE_CALLS = 15;

/**
 * Testa palavras-chave antes de gastar o orçamento: 1 página por termo em cada fonte, 1 crédito
 * cada.
 *
 * Não cria busca nem guarda nada — devolve o placar e vai embora.
 */
export const probeTerms = (
  token: string,
  termos: string[],
  settings: Partial<SpySettings>,
  fontes: SpySourceId[] = ["meta"],
) =>
  spyRequest<{ resultados: ProbeResult[]; creditsUsed: number; maxTermos: number }>("/probe", token, {
    method: "POST",
    body: JSON.stringify({ termos, settings, fontes }),
  });

// ---- busca e seleção -----------------------------------------------------------------------

export const startRun = (token: string, input: StartRunInput) =>
  spyRequest<{ runId: string; status: SpyRunStatus }>("/runs", token, {
    method: "POST",
    body: JSON.stringify(input),
  });

export const MAX_PERGUNTA_CHARS = 300;

/** Pergunta ao grid. Responde 202; o resultado chega em `run.question`, pelo polling da run. */
export const askGrid = (token: string, runId: string, pergunta: string) =>
  spyRequest<{ ok: true; total: number }>(`/runs/${encodeURIComponent(runId)}/ask`, token, {
    method: "POST",
    body: JSON.stringify({ pergunta }),
  });

export const clearQuestion = (token: string, runId: string) =>
  spyRequest<{ ok: true }>(`/runs/${encodeURIComponent(runId)}/ask`, token, { method: "DELETE" });

const EMPTY_SEARCH: SpySearchSummary = {
  exhausted: false,
  buffered: 0,
  creditsUsed: 0,
  pagesUsed: 0,
  found: 0,
  rejected: 0,
  target: 8,
  creditBudget: 20,
  note: null,
};

export const getRun = async (token: string, runId: string) => {
  const data = await spyRequest<{ run: SpyRun; ads: SpyAd[] }>(`/runs/${runId}`, token);
  // O auto-deploy publica este frontend ANTES de alguém reiniciar o worker, e o worker velho não
  // manda `search`. Sem o default o grid quebra lendo `run.search.exhausted` nessa janela.
  return { ...data, run: { ...data.run, search: data.run.search ?? EMPTY_SEARCH } };
};

/** Próximo bloco de anúncios que passam nos filtros. */
export const loadMore = (token: string, runId: string) =>
  spyRequest<{ ok: true }>(`/runs/${runId}/more`, token, { method: "POST" });

/** Transcreve e analisa SÓ os anúncios marcados. */
export const analyzeSelected = (token: string, runId: string, adIds: number[]) =>
  spyRequest<{ ok: true; selected: number }>(`/runs/${runId}/analyze`, token, {
    method: "POST",
    body: JSON.stringify({ adIds }),
  });

/**
 * Refaz SÓ a análise, sobre a seleção já transcrita — sem reminerar nem retranscrever.
 * Opcionalmente com outra instrução extra.
 */
export const reanalyzeRun = (token: string, runId: string, extraPrompt?: string) =>
  spyRequest<{ ok: true }>(`/runs/${runId}/reanalyze`, token, {
    method: "POST",
    body: JSON.stringify(extraPrompt === undefined ? {} : { extraPrompt }),
  });

export const cancelRun = (token: string, runId: string) =>
  spyRequest<{ ok: true }>(`/runs/${runId}/cancel`, token, { method: "POST" });

// ---- Biblioteca ---------------------------------------------------------------------------

export const saveToLibrary = (
  token: string,
  runId: string,
  // Um segmento só: é o principal, e é por ele que a Biblioteca classifica a análise.
  input: { especialidade: string; titulo?: string },
) =>
  spyRequest<{ id: string }>(`/runs/${runId}/save`, token, {
    method: "POST",
    body: JSON.stringify(input),
  });

export const listLibrary = (token: string, especialidades: string[] = []) => {
  const q = new URLSearchParams();
  for (const e of especialidades) q.append("especialidade", e);
  const qs = q.toString();
  return spyRequest<{ entries: LibraryEntrySummary[] }>(`/library${qs ? `?${qs}` : ""}`, token);
};

export const getLibraryEntry = (token: string, id: string) =>
  spyRequest<{ entry: LibraryEntry }>(`/library/${id}`, token);

export const deleteLibraryEntry = (token: string, id: string) =>
  spyRequest<{ ok: true }>(`/library/${id}`, token, { method: "DELETE" });

export const setLibraryFavorite = (token: string, id: string, favorito: boolean) =>
  spyRequest<{ ok: true; favorito: boolean }>(`/library/${id}/favorito`, token, {
    method: "PUT",
    body: JSON.stringify({ favorito }),
  });

// ---- análises de criativos -----------------------------------------------------------------

export type SpyNivelConsciencia =
  | "inconsciente"
  | "consciente_problema"
  | "consciente_solucao"
  | "consciente_produto"
  | "";

export const NIVEL_CONSCIENCIA_LABEL: Record<string, string> = {
  inconsciente: "Inconsciente do problema",
  consciente_problema: "Consciente do problema",
  consciente_solucao: "Consciente da solução",
  consciente_produto: "Consciente do produto",
};

/** Uma frase do anúncio e o que ela faz com quem assiste (dissecação versão 2). */
export type SpyFraseDissecada = {
  /** "fala" = transcrição do vídeo; "texto" = legenda/copy do anúncio. */
  origem: "fala" | "texto";
  /** Em português (traduzida, quando a peça veio em outro idioma). */
  texto: string;
  /** A frase no idioma original; "" quando não houve tradução. */
  original: string;
  funcoes: string[];
  explicacao: string;
  /** O `n` do movimento; null nas frases de texto ou quando as ligações não se sustentaram. */
  movimento: number | null;
};

export type SpyMovimentoDissecado = {
  n: number;
  nome: string;
  /** Instrução genérica, para agentes de IA, de como cumprir o movimento num anúncio novo. */
  como_funciona: string;
  bloco: number | null;
};

/**
 * A dissecação de UM anúncio, como o spyagent a devolve no modo dissecação de criativo.
 *
 * A versão 2 (desde 20/10/2026) acrescenta o frase a frase, os movimentos e os blocos; `estrutura`
 * passa a ser escrita pelo worker a partir dos blocos. Na LISTA vêm só os campos curtos: `frases` e
 * `movimentos` ficam para a análise aberta.
 */
export type SpyDissecacaoCriativo = {
  formato: string;
  estrutura: string;
  anatomia_semantica: string;
  anatomia_psicologica: string;
  nivel_consciencia: SpyNivelConsciencia;
  versao?: 2;
  frases?: SpyFraseDissecada[];
  movimentos?: SpyMovimentoDissecado[];
  blocos?: { n: number; nome: string }[];
  /** false = as ligações frase → movimento → bloco não se sustentaram; as listas vêm soltas. */
  ligacoes?: boolean;
  /** O frase a frase cobre pouco da transcrição: o agente pode ter pulado trechos. */
  cobertura_baixa?: boolean;
};

type CriativoBase = {
  id: string;
  run_id: string | null;
  library_entry_id: string | null;
  ad_id: number | null;
  titulo: string | null;
  especialidades: string[];
  status: "running" | "done" | "error";
  /** O que está acontecendo agora ("transcrevendo o vídeo", "analisando o criativo"). */
  etapa: string | null;
  error: string | null;
  dissecacao: SpyDissecacaoCriativo | null;
  saved_by: string;
  saved_by_name: string | null;
  criado_em: string;
  atualizado_em: string;
  canDelete: boolean;
  favorito: boolean;
  /** 'mineracao' = anúncio de concorrente; 'cliente' = anúncio do próprio cliente (Meta Ads dele). */
  origem?: "mineracao" | "cliente";
  /** O `padrao` do cliente, na origem 'cliente'. */
  cliente?: string | null;
  /** O `Ad_ID` da conta de anúncios, na origem 'cliente'. */
  meta_ad_id?: string | null;
};

/** Na lista, só o que desenha o card. */
export type SpyCriativoResumo = CriativoBase & {
  ad:
    | (Pick<SpyAd, "id" | "source" | "found_via" | "page_name" | "media_type" | "thumb_path" | "ad_copy"> & {
        /** Criativo interno: a miniatura pública da conta de anúncios. */
        thumb_public_url?: string | null;
      })
    | null;
};

export type SpyCriativo = CriativoBase & { ad: SpyAd; dissecacao_md: string | null };

/** De onde o anúncio veio: uma busca da pessoa ou uma Mineração Salva. */
export type OrigemCriativo = { runId: string } | { libraryEntryId: string };

export const startCriativo = (
  token: string,
  input: OrigemCriativo & { adId: number; especialidade: string; titulo?: string },
) =>
  spyRequest<{ id: string; status: string }>("/criativos", token, {
    method: "POST",
    body: JSON.stringify(input),
  });

export type FiltroCriativos = { origem?: "mineracao" | "cliente"; cliente?: string };

export const listCriativos = (token: string, especialidades: string[] = [], filtro: FiltroCriativos = {}) => {
  const q = new URLSearchParams();
  for (const e of especialidades) q.append("especialidade", e);
  if (filtro.origem) q.set("origem", filtro.origem);
  if (filtro.cliente) q.set("cliente", filtro.cliente);
  const qs = q.toString();
  return spyRequest<{ criativos: SpyCriativoResumo[] }>(`/criativos${qs ? `?${qs}` : ""}`, token);
};

/** Dissecação de um criativo DO CLIENTE. Já dissecado (ou rodando): devolve a análise que existe. */
export const startCriativoInterno = (token: string, input: { cliente: string; metaAdId: string; titulo?: string }) =>
  spyRequest<{ id: string; status: string; existente?: boolean }>("/criativos/interno", token, {
    method: "POST",
    body: JSON.stringify(input),
  });

export const atualizarCriativo = (token: string, id: string, patch: { especialidade?: string; titulo?: string }) =>
  spyRequest<{ ok: true }>(`/criativos/${encodeURIComponent(id)}`, token, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

export const getCriativo = (token: string, id: string) =>
  spyRequest<{ criativo: SpyCriativo }>(`/criativos/${encodeURIComponent(id)}`, token);

export const deleteCriativo = (token: string, id: string) =>
  spyRequest<{ ok: true }>(`/criativos/${encodeURIComponent(id)}`, token, { method: "DELETE" });

export const setCriativoFavorite = (token: string, id: string, favorito: boolean) =>
  spyRequest<{ ok: true; favorito: boolean }>(`/criativos/${encodeURIComponent(id)}/favorito`, token, {
    method: "PUT",
    body: JSON.stringify({ favorito }),
  });

// ---- mídia ---------------------------------------------------------------------------------

export type SpyMediaKind = "thumb" | "avatar";

/**
 * URL de uma imagem rehospedada. O bucket é privado e o worker exige o token — que `<img src>` não
 * consegue mandar —, então quem usa busca os bytes por `useSpyMedia` (blob URL).
 */
export const mediaUrl = (adId: number, kind: SpyMediaKind) => `${BASE}/media/${adId}/${kind}.jpg`;

/**
 * Baixa o arquivo de vídeo do anúncio, pelo worker.
 *
 * Não dá para apontar um `<a download>` direto para a CDN da Meta: o atributo `download` é
 * ignorado em outra origem, então o clique abriria o vídeo numa aba em vez de baixar. E o bucket é
 * privado, que `<a href>` não sabe autenticar. Então busca os bytes com o token e devolve o blob —
 * mesma ideia do `useSpyMedia` para as imagens.
 */
export async function fetchAdVideo(
  token: string,
  adId: number,
): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(`${BASE}/media/${adId}/video.mp4`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    let message = `Não foi possível baixar o vídeo (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // corpo não-JSON: fica a mensagem genérica
    }
    throw new Error(message);
  }
  // O nome vem do worker (anunciante + id). Sem cabeçalho, um nome qualquer serve.
  const disposition = res.headers.get("content-disposition") || "";
  const filename = /filename="([^"]+)"/i.exec(disposition)?.[1] || `anuncio-${adId}.mp4`;
  return { blob: await res.blob(), filename };
}

/**
 * Link do anúncio na Biblioteca da Meta, montado a partir do id — nunca do `permalink` guardado.
 *
 * O `permalink` das linhas já mineradas veio do campo `url` da fonte, que é uma URL de BUSCA da
 * Biblioteca, não um link para o anúncio. Montar aqui, ignorando o banco, faz os anúncios antigos
 * abrirem sem migração nenhuma.
 *
 * O formato é o mínimo, igual ao do botão "copiar link" da Meta: `?id=<ad_archive_id>`. Sem id
 * numérico não há link nenhum — um id perdido ("undefined") só levaria à página de erro.
 */
export function adLibraryUrl(externalId: string | null | undefined): string | null {
  const id = (externalId ?? "").trim();
  if (!/^\d{6,}$/.test(id)) return null;
  return `https://www.facebook.com/ads/library/?id=${id}`;
}

export type AdOpenLink = { key: string; label: string; href: string };

/** Só http(s): `link_url` e `page_profile_uri` vêm de dados de terceiros. */
function urlSegura(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!/^https?:\/\//i.test(v)) return null;
  try {
    return new URL(v).toString();
  } catch {
    return null;
  }
}

/** Domínio sem "www.", para mostrar o destino do anúncio sem a URL inteira. */
function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * O anunciante que dá para minerar a partir desta peça, ou `null`.
 *
 * Só anúncio da Meta: a rota busca pelo id numérico da página na Biblioteca, que perfil do
 * Instagram, anunciante do TikTok e canal do YouTube não têm.
 */
export function advertiserOf(ad: SpyAd): { pageId: string; pageName: string | null } | null {
  const pageId = (ad.page_id ?? "").trim();
  if (ad.source !== "meta" || !/^\d{5,25}$/.test(pageId)) return null;
  return { pageId, pageName: ad.page_name?.trim() || null };
}

/** Quantos anúncios a busca por anunciante persegue por bloco: cabe em uma página da rota (~30). */
export const ADVERTISER_TARGET = 28;

/**
 * O pedido de uma busca "minerar este anunciante".
 *
 * Sem filtro de qualidade nenhum, de propósito: quem clica quer ver o que o anunciante tem no ar,
 * e longevidade ou replicação mínimas esconderiam justamente os criativos novos dele. Só o país
 * vem da busca de origem. `status: "ALL"` pede também os inativos — que a Biblioteca quase nunca
 * devolve para anúncio comercial, e a tela diz isso.
 */
export function advertiserRunInput(ad: SpyAd, from: SpyRun | null): StartRunInput | null {
  const anunciante = advertiserOf(ad);
  if (!anunciante) return null;
  return {
    tema: anunciante.pageName || `Página ${anunciante.pageId}`,
    sources: ["meta_advertiser"],
    settings: {
      country: from?.settings?.country ?? "BR",
      status: "ALL",
      targetAds: ADVERTISER_TARGET,
      transcribe: from?.settings?.transcribe ?? true,
      // Voltar de uma busca por anunciante leva à busca por palavra-chave de origem, não a outra
      // busca por anunciante: minerar A e depois B (a partir de A) ainda volta para onde tudo começou.
      advertiser: { ...anunciante, fromRunId: from?.settings?.advertiser?.fromRunId ?? from?.id ?? null },
    },
  };
}

/**
 * Os lugares para onde dá para ir a partir de um anúncio.
 *
 * Devolve só o que existe: anúncio sem `link_url` não ganha item de site, anunciante sem `page_id`
 * não ganha o de "outros anúncios". Assim o menu nunca oferece um caminho que leva a lugar nenhum.
 *
 * O perfil sai de `page_profile_uri`, que é o link que a própria fonte dá — pode ser Facebook ou
 * Instagram, e o rótulo segue o que a URL é de fato. Sem ele (anúncios minerados antes da coluna),
 * monta `facebook.com/<page_id>`, que resolve id numérico.
 */
export function adOpenLinks(ad: SpyAd): AdOpenLink[] {
  if (ad.source === "instagram") return instagramLinks(ad);
  if (ad.source === "tiktok") return tiktokLinks(ad);
  if (ad.source === "tiktok_organic") return tiktokOrganicLinks(ad);
  if (ad.source === "google") return googleLinks(ad);
  if (ad.source === "youtube") return youtubeLinks(ad);
  const out: AdOpenLink[] = [];

  const biblioteca = adLibraryUrl(ad.external_id);
  if (biblioteca) {
    out.push({ key: "biblioteca", label: "Anúncio na Biblioteca", href: biblioteca });
  }

  const pageId = (ad.page_id ?? "").trim();
  if (/^\d{6,}$/.test(pageId)) {
    out.push({
      key: "anunciante",
      label: "Todos os anúncios do anunciante",
      href: `https://www.facebook.com/ads/library/?view_all_page_id=${pageId}`,
    });
  }

  const perfil = urlSegura(ad.page_profile_uri) ?? (/^\d{6,}$/.test(pageId) ? `https://www.facebook.com/${pageId}` : null);
  if (perfil) {
    const rede = /instagram\.com/i.test(perfil) ? "Instagram" : "Facebook";
    out.push({ key: "perfil", label: `Perfil do anunciante no ${rede}`, href: perfil });
  }

  const site = urlSegura(ad.link_url);
  if (site) out.push({ key: "site", label: `Site do anúncio (${host(site)})`, href: site });

  return out;
}

/** Instagram: o post e o perfil. O permalink vem montado pelo worker a partir do shortcode. */
function instagramLinks(ad: SpyAd): AdOpenLink[] {
  const out: AdOpenLink[] = [];
  const post = urlSegura(ad.permalink);
  if (post) {
    const reel = /\/reels?\//.test(post) || ad.display_format === "REEL";
    out.push({ key: "post", label: reel ? "Reel no Instagram" : "Post no Instagram", href: post });
  }
  const perfil = urlSegura(ad.page_profile_uri);
  if (perfil) {
    out.push({ key: "perfil", label: `Perfil ${ad.page_id ? `@${ad.page_id}` : "no Instagram"}`, href: perfil });
  }
  return out;
}

/** Google Ads: o anúncio e o anunciante no Centro de Transparência, e o site quando o detalhe o traz. */
function googleLinks(ad: SpyAd): AdOpenLink[] {
  const out: AdOpenLink[] = [];
  const anuncio = urlSegura(ad.permalink);
  if (anuncio) out.push({ key: "biblioteca", label: "Anúncio no Centro de Transparência", href: anuncio });
  const anunciante = urlSegura(ad.page_profile_uri);
  if (anunciante) out.push({ key: "anunciante", label: "Todos os anúncios do anunciante", href: anunciante });
  const yt = ad.metrics?.youtubeId;
  if (yt && /^[A-Za-z0-9_-]{11}$/.test(yt)) {
    out.push({ key: "video", label: "Vídeo no YouTube", href: `https://www.youtube.com/watch?v=${yt}` });
  }
  const site = urlSegura(ad.link_url);
  if (site) out.push({ key: "site", label: `Site do anúncio (${host(site)})`, href: site });
  return out;
}

/** TikTok orgânico: o vídeo e o perfil. */
function tiktokOrganicLinks(ad: SpyAd): AdOpenLink[] {
  const out: AdOpenLink[] = [];
  const video = urlSegura(ad.permalink);
  if (video) {
    out.push({ key: "post", label: /\/photo\//.test(video) ? "Carrossel no TikTok" : "Vídeo no TikTok", href: video });
  }
  const perfil = urlSegura(ad.page_profile_uri);
  if (perfil) {
    out.push({ key: "perfil", label: `Perfil ${ad.page_id ? `@${ad.page_id}` : "no TikTok"}`, href: perfil });
  }
  return out;
}

/** YouTube: o short e o canal. */
function youtubeLinks(ad: SpyAd): AdOpenLink[] {
  const out: AdOpenLink[] = [];
  const short = urlSegura(ad.permalink);
  if (short) out.push({ key: "short", label: "Short no YouTube", href: short });
  const canal = urlSegura(ad.page_profile_uri);
  if (canal) out.push({ key: "canal", label: `Canal ${ad.page_name ?? "no YouTube"}`, href: canal });
  return out;
}

/** TikTok: o anúncio na biblioteca, o Creative Center quando houver, e o destino. */
function tiktokLinks(ad: SpyAd): AdOpenLink[] {
  const out: AdOpenLink[] = [];
  const biblioteca = urlSegura(ad.permalink);
  if (biblioteca) out.push({ key: "biblioteca", label: "Anúncio na TikTok Ad Library", href: biblioteca });
  const cc = urlSegura(ad.metrics?.creativeCenterUrl);
  if (cc && cc !== biblioteca) out.push({ key: "creative", label: "Anúncio no Creative Center", href: cc });
  const site = urlSegura(ad.link_url);
  if (site) out.push({ key: "site", label: `Site do anúncio (${host(site)})`, href: site });
  return out;
}

/** "12,3 mil", "1,2 mi" — número de engajamento que cabe num card. */
export function compactNumber(n: number | null | undefined): string | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/** Enquanto a UI precisa fazer polling: operações que avançam sozinhas no worker. */
export const isRunActive = (status: SpyRunStatus | undefined) =>
  status === "queued" || status === "searching" || status === "running";
