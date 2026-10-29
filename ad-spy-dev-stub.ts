// DEV ONLY. Simula a superfície do ad-spy-worker v2 (/api/spy/*) para desenvolver e revisar a
// Mineração e a Biblioteca sem worker, sem Playwright, sem modelo e sem gastar crédito.
//
// Reproduz o fluxo novo: busca em blocos de 8 (com fim da busca no 3º bloco), seleção, análise dos
// marcados passando pelas etapas num timer, e a Biblioteca com filtro por especialidade.
import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
// A MESMA spec que a tela e o worker leem: um stub com formatos próprios inventaria uma tela que
// não existe, que é exatamente o bug que um stub deveria pegar.
import { AD_FORMATS, MAX_ANUNCIOS, validarLimites } from "./shared/ad-formats.js";
// Brand kit e artes estáticas: o MESMO código do worker (normalização, regras, montagem do post).
import { kitVazio, normalizarBrandKit, temIdentificacao } from "./shared/brand-kit.js";
import { getTemplate } from "./shared/post-templates.js";
import { normalizarFundo } from "./shared/fundos.js";
import { exigenciaDeIdentificacao, ondeIdentificar } from "./shared/regras-identificacao.js";
import {
  aplicarRegrasDoPost,
  anunciosDaLinha,
  legendaDoAnuncio,
  montarPost,
  normalizarOpcoes,
  parseArteReply,
  totalDeSlides,
} from "./apps/ad-spy-worker/arte-prompt.js";

type Stage = {
  key: string;
  label: string;
  status: "pending" | "running" | "done" | "error" | "skipped";
  done: number;
  total: number | null;
  started_at: string | null;
  ended_at: string | null;
  note: string | null;
};

const STAGE_TEMPLATE = [
  { key: "discover", label: "Busca" },
  { key: "download", label: "Download" },
  { key: "transcribe", label: "Transcrição" },
  { key: "analyze", label: "Análise" },
];

const seedStages = (): Stage[] =>
  STAGE_TEMPLATE.map((s) => ({ ...s, status: "pending", done: 0, total: null, started_at: null, ended_at: null, note: null }));

const ADVERTISERS = ["Felipe Bueno", "Clínica Sorriso Pleno", "Dra. Marina Arantes", "Instituto Face Ideal", "Grupo Capilar Nacional", "Tavernari Capilar"];
const COPIES = [
  "Evolução transplante capilar goleiro Lucas Prado. #transplantecapilar #implantecapilar #altadensidade #resultadonatural",
  "Cansada de esconder o sorriso nas fotos? Nossas lentes de contato dental são ultrafinas e naturais. Avaliação sem compromisso.",
  "ATENÇÃO: últimas vagas para avaliação gratuita. Mais de 3.000 pacientes já mudaram de vida com a gente.",
  "Harmonização facial com resultado natural — sem exagero, sem cara de plástico. Veja o depoimento da Carla.",
];
const TRANSCRIPTS = [
  "Oi gente, hoje eu quero te contar uma coisa que quase ninguém fala sobre harmonização facial.",
  "Eu escondia meu sorriso em todas as fotos. Todas. Até que em duas sessões mudou tudo.",
];
const BLOCK = 8;
const BLOCKS_UNTIL_END = 3;

const ANALYSIS_MD = `## Leitura geral

Esse conjunto mostra um mercado que já abandonou o anúncio institucional e vende por **prova
social e quebra de objeção**. Dos 6 anúncios minerados, 4 abrem com uma objeção explícita do
paciente ("tenho medo de ficar artificial", "dói?", "é caro?") em vez de falar da clínica. Os dois
anúncios de maior longevidade — #1 (142 dias) e #3 (98 dias) — são justamente os que fazem isso de
forma mais direta, o que sugere que o ângulo está validado e não é moda passageira.

## Ângulos e temas recorrentes

**1. Antecipar o medo do resultado artificial** (mais forte). Aparece em #1 e #4, os dois com mais
de 90 dias no ar, e em ambos o argumento é o mesmo: o problema não é o procedimento, é a dose. É o
padrão com melhor evidência de longevidade do corpus.

**2. Depoimento em primeira pessoa, sem produção.** #2 e #5 usam paciente real, câmera na mão,
sem locução. Nenhum dos dois menciona preço.

**3. Educação com tom de alerta.** #3 e #6 abrem com "o que ninguém te conta" / "presta atenção" e
entregam um critério técnico de compra. Transforma o anúncio em conteúdo.

## Palavras e expressões fortes

"avaliação gratuita" e "sem compromisso" aparecem em 4 dos 6 anúncios — virou tabela no nicho, e
usar exatamente isso não diferencia. Já "resultado natural" e "sem cara de plástico" aparecem só
nos de harmonização, e sempre nos de maior longevidade.

## Ganchos

O gancho mais replicável é o de #1: *"hoje eu quero te contar uma coisa que quase ninguém fala
sobre..."* — cria lacuna de informação sem prometer resultado, o que também resolve o problema de
compliance. #3 usa a variação mais agressiva: *"presta atenção nesses três segundos porque isso vai
te economizar dinheiro"*.

## Formatos e estrutura

Domina o vertical de 30 a 45 segundos, profissional falando direto para a câmera, sem trilha, com
legenda queimada. Nenhum dos anúncios de maior longevidade usa antes/depois — provavelmente por
restrição do CFO/CFM, o que vale observar: o mercado achou como vender sem isso.

## O que parece funcionar

- Abrir pela **objeção**, não pela clínica.
- Profissional aparecendo de rosto, sem produção de estúdio.
- CTA de baixo compromisso ("avaliação"), nunca de compra direta.
- Evitar antes/depois e promessa de resultado — e ainda assim ser concreto, via critério técnico.

## Sugestões

1. **Testar o ângulo "dose, não produto"** com o profissional do cliente falando à câmera. É o
   padrão com mais longevidade no corpus (#1, #4) e ninguém no recorte está usando para implante.
2. **Gancho de lacuna nos 3 primeiros segundos**, na estrutura de #3, aplicado a uma objeção de
   preço.
3. **Depoimento sem produção**, no formato de #2 — mas nomeando o tempo de tratamento, que nenhum
   concorrente faz.
4. **Fugir de "avaliação gratuita"** no texto de abertura: está em 4 de 6 anúncios e virou ruído.
`;

const ANALYSIS_JSON = {
  dissecacoes: [
    {
      ad_id: 1,
      formato: "Vertical 38s, profissional falando à câmera, legenda queimada",
      estrutura: "objeção nos 3s → critério técnico → paciente real → convite para avaliação",
      anatomia_semantica:
        "evita 'cirurgia' e 'procedimento invasivo'; usa 'técnica' e 'naturalidade'. Preço nunca é nomeado",
      anatomia_psicologica:
        "ataca o medo de ficar com cara artificial; autoridade do especialista + prova visual",
      nivel_consciencia: "consciente do problema",
    },
    {
      ad_id: 2,
      formato: "Depoimento de paciente, câmera na mão, sem trilha",
      estrutura: "identificação ('eu escondia o sorriso') → virada → resultado",
      anatomia_semantica: "primeira pessoa, coloquial, zero jargão técnico",
      anatomia_psicologica: "identificação e pertencimento; a prova é a pessoa, não o dado",
      nivel_consciencia: "inconsciente do problema",
    },
    {
      ad_id: 3,
      formato: "Locução sobre b-roll da clínica",
      estrutura: "alerta → critério de compra → CTA",
      anatomia_semantica: "tom de alerta, 'o que ninguém te conta'",
      anatomia_psicologica: "lacuna de informação + medo de escolher errado",
      nivel_consciencia: "consciente da solução",
    },
  ],
  publicos: [
    {
      fatia: "Quem já fez um procedimento e ficou com resultado artificial",
      demanda: "imediata",
      evidencia: "4 dos 6 anúncios atacam essa objeção; os dois de maior longevidade são desse grupo",
      por_que_segmentar:
        "demanda provada e já disputada, mas ninguém fala do critério de dose — é a lacuna",
      exemplos: [1, 4],
    },
    {
      fatia: "Quem esconde o sorriso em foto e nunca procurou clínica",
      demanda: "latente",
      evidencia: "só aparece em anúncio de depoimento, nenhum com mais de 40 dias",
      por_que_segmentar: "exige conscientização antes da oferta; resultado mais devagar",
      exemplos: [2, 5],
    },
  ],
  temas: [
    {
      nome: "Antecipar o medo do resultado artificial",
      frequencia: 2,
      exemplos: [1, 4],
      porque_funciona: "Resolve a objeção principal antes de vender; os dois anúncios com mais de 90 dias no ar usam esse ângulo",
    },
    {
      nome: "Depoimento em primeira pessoa, sem produção",
      frequencia: 2,
      exemplos: [2, 5],
      porque_funciona: "Credibilidade sem parecer anúncio; nenhum dos dois fala de preço",
    },
    {
      nome: "Educação com tom de alerta",
      frequencia: 2,
      exemplos: [3, 6],
      porque_funciona: "Entrega um critério de compra e transforma o anúncio em conteúdo",
    },
  ],
  palavras: [
    { termo: "avaliação gratuita", ocorrencias: 4, contexto: "CTA de baixo compromisso — virou tabela no nicho" },
    { termo: "resultado natural", ocorrencias: 3, contexto: "sempre nos anúncios de harmonização de maior longevidade" },
    { termo: "sem compromisso", ocorrencias: 3, contexto: "acompanha a oferta de avaliação" },
    { termo: "sem cara de plástico", ocorrencias: 2, contexto: "linguagem do paciente, não da clínica" },
  ],
  hooks: [
    { texto: "hoje eu quero te contar uma coisa que quase ninguém fala sobre...", ad_id: 1, tipo: "lacuna de informação" },
    { texto: "presta atenção nesses três segundos porque isso vai te economizar dinheiro", ad_id: 3, tipo: "alerta / economia" },
    { texto: "eu escondia meu sorriso em todas as fotos. Todas.", ad_id: 2, tipo: "identificação" },
  ],
  formatos: [
    { padrao: "Vertical 30–45s, profissional falando direto à câmera", evidencia: "4 dos 6 anúncios, incluindo os dois mais antigos" },
    { padrao: "Legenda queimada, sem trilha sonora", evidencia: "presente em todos os vídeos transcritos" },
    { padrao: "Ausência total de antes/depois", evidencia: "nenhum anúncio usa, provavelmente por restrição do conselho" },
  ],
  o_que_funciona: [
    "Abrir pela objeção do paciente, não pela clínica",
    "Profissional de rosto, sem produção de estúdio",
    "CTA de baixo compromisso (avaliação), nunca compra direta",
    "Ser concreto via critério técnico em vez de promessa de resultado",
  ],
  sugestoes: [
    { titulo: 'Testar o ângulo "dose, não produto"', detalhe: "Profissional do cliente à câmera; ninguém no recorte aplica isso a implante", baseado_em: [1, 4] },
    { titulo: "Gancho de lacuna nos 3 primeiros segundos", detalhe: "Estrutura de #3 aplicada a uma objeção de preço", baseado_em: [3] },
    { titulo: "Depoimento sem produção nomeando o tempo de tratamento", detalhe: "Formato de #2, com o dado que nenhum concorrente dá", baseado_em: [2, 5] },
    { titulo: 'Evitar "avaliação gratuita" na abertura', detalhe: "Está em 4 de 6 anúncios; virou ruído e não diferencia", baseado_em: [1, 2, 3, 5] },
  ],
};

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}") as T);
      } catch {
        resolve({} as T);
      }
    });
  });
}

function placeholderSvg(label: string, round = false) {
  const t = label.slice(0, 18).replace(/[<&>]/g, "");
  return round
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="32" fill="#9fb3cd"/><text x="32" y="38" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#fff">${t.slice(0, 2)}</text></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="400"><rect width="320" height="400" fill="#2b3a55"/><circle cx="160" cy="170" r="60" fill="#4a6fa5"/><text x="160" y="330" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#dbe3ef">${t}</text></svg>`;
}

type StubAd = Record<string, unknown> & { id: number; selected: boolean; transcript: string | null; days_running: number };
type Run = {
  id: string;
  user_id: string;
  tema: string;
  sources: string[];
  settings: Record<string, unknown>;
  extra_prompt: string | null;
  status: string;
  stages: Stage[];
  cancel_requested: boolean;
  analysis_md: string | null;
  analysis: unknown | null;
  meta_provider: string;
  error: string | null;
  criado_em: string;
  updated_at: string;
  blocks: number;
  credits: number;
  question?: unknown;
  ads: StubAd[];
};
type LibEntry = Record<string, unknown> & { id: string; especialidades: string[]; ads: StubAd[]; criado_em: string };

export function adSpyDevStub(): Plugin {
  const runs = new Map<string, Run>();
  const library: LibEntry[] = [];
  // Mineração › Análises de Criativos. Favoritos à parte, como os da Biblioteca.
  const criativos = new Map<string, Record<string, unknown>>();
  const favoritosCriativos = new Set<string>();
  // Favoritos do "usuário" do stub, por id de análise.
  const favoritos = new Set<string>();
  // Resumos de Marketing › Clientes, por `padrao` do cliente.
  const briefs = new Map<string, Record<string, unknown>>();
  const compositions = new Map<string, Record<string, unknown>>();
  const brandKits = new Map<string, ReturnType<typeof kitVazio>>();
  const artes = new Map<string, Record<string, unknown>>();
  const arquivos = new Map<string, { bytes: Buffer; mime: string }>();
  const lerBinario = (req: IncomingMessage) =>
    new Promise<{ bytes: Buffer; mime: string }>((resolve) => {
      const partes: Buffer[] = [];
      req.on("data", (c: Buffer) => partes.push(c));
      req.on("end", () => resolve({ bytes: Buffer.concat(partes), mime: String(req.headers["content-type"] || "image/png") }));
    });
  /** Uma composição SALVA com um carrossel de Feed e um anúncio de Meta Ads, para a tela do estático. */
  const seedEstatico = () => {
    if (compositions.has("stub-estatico")) return;
    const agora = new Date().toISOString();
    const anuncios = [
      {
        formato: "instagram_feed", angulo: "[stub] O ronco como sinal, não como piada", formato_justificativa: null, status: "ok", error: null, avisos: [], composicao_md: null,
        composicao: {
          abertura: "Ronco não é só barulho — e o seu corpo sabe disso.",
          legenda: "Ronco não é só barulho — e o seu corpo sabe disso. [stub] Entenda o que pode estar por trás e quando vale investigar.",
          carrossel: ["Capa: 'Seu ronco tem nome' — foto do médico no consultório", "O que é apneia: 'O sono é interrompido dezenas de vezes por hora'", "Sinais: 'Cansaço de manhã não é normal'", "CTA: 'Dá para investigar com uma conversa'"],
          direcao_foto: "Médico no consultório, luz natural.",
        },
      },
      {
        formato: "meta_ads", angulo: "[stub] Avaliação do sono", formato_justificativa: null, status: "ok", error: null, avisos: [], composicao_md: null,
        composicao: { primary_text: "Acorda cansado mesmo dormindo 8 horas? [stub]", headline: "Seu sono pode estar pedindo ajuda", description: "Avaliação do sono", direcao_criativo: "Foto do médico." },
      },
    ];
    compositions.set("stub-estatico", {
      id: "stub-estatico", cliente: "stub_cliente", nome_exibicao: "[stub] Dr. Stub da Silva", library_entry_id: null, analise_titulo: null,
      formato: "instagram_feed", formato_justificativa: null, plano: anuncios.map((a) => ({ formato: a.formato, angulo: a.angulo, status: a.status })),
      entradas: [], extra_prompt: null, avisos: [], fontes: {}, status: "ok", error: null, criado_por: "stub-user", criado_em: agora, atualizado_em: agora,
      canDelete: true, composicao_md: "[stub] Composição salva para testar o estático.", composicao: null, anuncios, versoes: [], metricas: {}, semana_de: null, semana_ate: null, agent_id: "stub", conceitos: [], catalogo_copy: null,
    });
  };
  const orquestracoes = new Map<string, Record<string, unknown>>();
  const relatorios = new Map<string, Record<string, unknown>>();
  let nextAdId = 1;

  const summary = (run: Run) => {
    const exhausted = run.blocks >= BLOCKS_UNTIL_END;
    const target = Number(run.settings?.targetAds) || BLOCK;
    return {
      exhausted,
      buffered: exhausted ? 0 : 5,
      creditsUsed: run.credits,
      pagesUsed: run.credits,
      found: run.ads.length,
      // Inventado, mas na proporção que dados reais costumam ter com filtro apertado.
      rejected: run.credits * 7,
      target,
      creditBudget: Math.max(1, Math.ceil(target / 4) * 10),
      note: exhausted ? "Fim da busca: não há mais anúncios que atendam aos filtros." : null,
    };
  };

  function addBlock(run: Run) {
    run.status = "searching";
    const d = run.stages[0];
    Object.assign(d, { status: "running", started_at: new Date().toISOString(), note: "buscando" });
    setTimeout(() => {
      // Uma plataforma por peça, em rodízio, como o worker intercala as trilhas de verdade.
      const plataformas = [
        ...(run.sources.includes("meta") ? ["meta"] : []),
        ...(run.sources.includes("instagram_ads") && !run.sources.includes("meta") ? ["instagram_ads"] : []),
        ...(run.sources.some((f) => f.startsWith("instagram") && f !== "instagram_ads") ? ["instagram"] : []),
        ...(run.sources.includes("tiktok") ? ["tiktok"] : []),
        ...(run.sources.some((f) => f.startsWith("tiktok_")) ? ["tiktok_organic"] : []),
        ...(run.sources.some((f) => f.startsWith("google")) ? ["google"] : []),
        ...(run.sources.some((f) => f.startsWith("youtube")) ? ["youtube"] : []),
      ];
      if (!plataformas.length) plataformas.push("meta");
      // "Minerar este anunciante": todas as peças são da mesma página.
      const anunciante = run.sources.includes("meta_advertiser")
        ? (run.settings.advertiser as { pageId: string; pageName: string | null } | undefined)
        : undefined;
      for (let i = 0; i < BLOCK; i += 1) {
        const id = nextAdId++;
        const fonte = plataformas[i % plataformas.length];
        const base = {
          id,
          run_id: run.id,
          page_name: ADVERTISERS[id % ADVERTISERS.length],
          ad_copy: COPIES[id % COPIES.length],
          title: null,
          media_type: id % 5 === 0 ? "image" : "video",
          thumb_path: `stub/${id}.jpg`,
          avatar_path: `stub/${id}-avatar.jpg`,
          media_path: null,
          media_url: null,
          duration_sec: 30,
          transcript: null,
          transcript_lang: null,
          transcript_model: null,
          selected: false,
          criado_em: new Date().toISOString(),
        };
        // Mesma conta do `organicSignals` do worker, para o card do stub mostrar o que o real mostra.
        const sinais = (m: { views: number; likes: number; comments: number; followers: number | null }) => ({
          ...m,
          engagementRate: Math.round(((m.likes + m.comments) / m.views) * 10000) / 10000,
          engagementBasis: "views",
          viewsPerFollower: m.followers ? Math.round((m.views / m.followers) * 100) / 100 : null,
        });
        const desde = (dias: number) => new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
        if (fonte === "google") {
          const anunciante = `AR0161401435009843${String(2000 + (id % ADVERTISERS.length))}`;
          const criativo = `CR0856762784612456${String(8000 + id)}`;
          run.ads.push({
            ...base,
            // A listagem do Google não traz texto: ele só chega no detalhe, depois da seleção.
            ad_copy: "",
            media_type: id % 3 ? "image" : "video",
            source: "google",
            external_id: criativo,
            page_id: anunciante,
            page_profile_uri: `https://adstransparency.google.com/advertiser/${anunciante}`,
            permalink: `https://adstransparency.google.com/advertiser/${anunciante}/creative/${criativo}`,
            cta_text: null,
            link_url: null,
            display_format: id % 3 ? "TEXT" : "VIDEO",
            publisher_platform: ["GOOGLE"],
            started_running_on: desde(120 - id * 3),
            days_running: Math.max(1, 120 - id * 3 - 2),
            collation_count: null,
            is_active: null,
            found_via: run.sources.includes("google") ? "tema" : "anunciante",
            metrics: { lastShownOn: desde(2), googleFormat: id % 3 ? "text" : "video" },
          });
        } else if (fonte === "tiktok_organic") {
          const handle = `clinica.exemplo${id % ADVERTISERS.length}`;
          run.ads.push({
            ...base,
            source: "tiktok_organic",
            external_id: String(7334621391758642000 + id),
            page_id: handle,
            page_profile_uri: `https://www.tiktok.com/@${handle}`,
            permalink: `https://www.tiktok.com/@${handle}/video/${7334621391758642000 + id}`,
            cta_text: null,
            link_url: null,
            display_format: "VIDEO",
            publisher_platform: ["TIKTOK"],
            started_running_on: desde(id * 2),
            days_running: id * 2,
            collation_count: null,
            is_active: null,
            found_via: run.sources.includes("tiktok_videos") ? "videos" : "hashtag:exemplo",
            metrics: { ...sinais({ views: 9000 * (1 + (id % 9)), likes: 700 * (1 + (id % 5)), comments: 40 + id, followers: null }), shares: 30 + id, saves: 90 + id },
          });
        } else if (fonte === "instagram") {
          const handle = `clinica.exemplo${id % ADVERTISERS.length}`;
          run.ads.push({
            ...base,
            source: "instagram",
            external_id: `STUB${id}abc`,
            page_id: handle,
            page_profile_uri: `https://www.instagram.com/${handle}/`,
            permalink: `https://www.instagram.com/reel/STUB${id}abc/`,
            cta_text: null,
            link_url: null,
            display_format: "REEL",
            publisher_platform: ["INSTAGRAM"],
            started_running_on: desde(4 + id),
            days_running: 4 + id,
            collation_count: null,
            is_active: null,
            found_via: id % 2 ? "reels" : `hashtag:${String(run.tema).toLowerCase().replace(/[^a-z0-9]/g, "")}`,
            metrics: sinais({ views: 1200 * (id % 9 + 1) * (id % 3 + 1), likes: 90 * (id % 7 + 1), comments: 4 * (id % 5 + 1), followers: 18000 }),
          });
        } else if (fonte === "youtube") {
          const canal = `canalexemplo${id % ADVERTISERS.length}`;
          run.ads.push({
            ...base,
            source: "youtube",
            external_id: `stubYT${String(id).padStart(5, "0")}`,
            page_id: canal,
            page_profile_uri: `https://www.youtube.com/@${canal}`,
            permalink: `https://www.youtube.com/shorts/stubYT${String(id).padStart(5, "0")}`,
            title: `${ADVERTISERS[id % ADVERTISERS.length]}: o que ninguém te conta`,
            cta_text: null,
            link_url: null,
            display_format: "SHORT",
            media_type: "video",
            publisher_platform: ["YOUTUBE"],
            started_running_on: desde(9 + id),
            days_running: 9 + id,
            collation_count: null,
            is_active: null,
            found_via: "shorts",
            metrics: sinais({ views: 2400 * (id % 8 + 1) * (id % 4 + 1), likes: 120 * (id % 6 + 1), comments: 6 * (id % 5 + 1), followers: null }),
          });
        } else if (fonte === "tiktok") {
          const dias = 10 + id * 3;
          run.ads.push({
            ...base,
            source: "tiktok",
            external_id: String(1871655924410000 + id),
            page_id: null,
            page_profile_uri: null,
            permalink: `https://library.tiktok.com/ads/detail/?ad_id=${1871655924410000 + id}`,
            cta_text: null,
            link_url: null,
            display_format: "VIDEO",
            media_type: "video",
            publisher_platform: ["TIKTOK"],
            started_running_on: desde(dias + 5),
            days_running: dias,
            collation_count: null,
            is_active: null,
            found_via: "busca",
            metrics: { estimatedAudience: ["1K-10K", "10K-100K", "100K-1M"][id % 3], lastShownOn: desde(5) },
          });
        } else {
          run.ads.push({
            ...base,
            source: "meta",
            external_id: String(1498059261982500 + id),
            // Numérico, como na Biblioteca: é o que o botão "minerar este anunciante" exige.
            page_id: anunciante?.pageId ?? String(100000000 + (id % ADVERTISERS.length)),
            ...(anunciante ? { page_name: anunciante.pageName || `Página ${anunciante.pageId}` } : {}),
            page_profile_uri: null,
            permalink: `https://www.facebook.com/ads/library/?id=${1498059261982500 + id}`,
            cta_text: "Saiba mais",
            link_url: null,
            display_format: "VIDEO",
            publisher_platform: id % 3 ? ["INSTAGRAM"] : ["FACEBOOK", "INSTAGRAM"],
            started_running_on: desde(200 - id * 7),
            days_running: Math.max(3, 200 - id * 7),
            collation_count: [1, 13, 1, 2, 1, 5, 1, 1][id % 8],
            is_active: id % 7 !== 0,
            found_via: fonte === "instagram_ads" ? "instagram_ads" : null,
            metrics: { pageLikes: [2300, 48000, 910000][id % 3] },
          });
        }
      }
      run.blocks += 1;
      run.credits += run.blocks === 1 ? 1 : run.blocks % 2;
      Object.assign(d, { status: "done", ended_at: new Date().toISOString(), note: `+${BLOCK} anúncio(s)` });
      run.status = "awaiting_selection";
      run.updated_at = new Date().toISOString();
    }, 1200);
  }

  function analyze(run: Run) {
    run.status = "running";
    run.analysis_md = null;
    run.analysis = null;
    const selected = run.ads.filter((a) => a.selected);
    const [, dl, tr, an] = run.stages;
    for (const s of [dl, tr, an]) Object.assign(s, { status: "pending", done: 0, total: null, note: null, started_at: null, ended_at: null });
    const step = (fn: () => void, ms: number) => new Promise<void>((r) => setTimeout(() => { fn(); run.updated_at = new Date().toISOString(); r(); }, ms));
    (async () => {
      const cancel = () => {
        for (const s of [dl, tr, an]) if (s.status === "pending" || s.status === "running") Object.assign(s, { status: "skipped", note: "cancelada" });
        run.status = "awaiting_selection";
        run.cancel_requested = false;
      };
      Object.assign(dl, { status: "running", total: selected.length, started_at: new Date().toISOString() });
      for (let i = 1; i <= selected.length; i += 1) {
        if (run.cancel_requested) return cancel();
        await step(() => (dl.done = i), 250);
      }
      Object.assign(dl, { status: "done", ended_at: new Date().toISOString() });
      Object.assign(tr, { status: "running", total: selected.length, started_at: new Date().toISOString() });
      for (let i = 1; i <= selected.length; i += 1) {
        if (run.cancel_requested) return cancel();
        await step(() => {
          tr.done = i;
          const ad = selected[i - 1];
          if (ad && ad.media_type === "video") ad.transcript = TRANSCRIPTS[i % TRANSCRIPTS.length];
        }, 350);
      }
      Object.assign(tr, { status: "done", ended_at: new Date().toISOString(), note: `${selected.length} transcrito(s) · small em cpu` });
      Object.assign(an, { status: "running", started_at: new Date().toISOString() });
      await step(() => {}, 1800);
      if (run.cancel_requested) return cancel();
      Object.assign(an, { status: "done", ended_at: new Date().toISOString() });
      run.analysis_md = ANALYSIS_MD;
      run.analysis = ANALYSIS_JSON;
      run.status = "done";
    })();
  }

  return {
    name: "ad-spy-dev-stub",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/api/spy", async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = (req.url || "").split("?")[0];
        const query = new URLSearchParams((req.url || "").split("?")[1] || "");
        const method = (req.method || "GET").toUpperCase();
        const BUSY = ["searching", "running"];

        // --- Brand kit e artes estáticas (27/10/2026) ------------------------------------------
        // Em memória, com o código de produção para normalizar, aplicar as regras do CFM e montar o
        // post. O "agente" é fingido (as páginas saem da copy do anúncio), mas o RENDER é o de
        // verdade: Playwright local abrindo /render.html deste mesmo Vite.
        seedEstatico();
        const kitRota = url.match(/^\/clientes\/([^/]+)\/brand-kit$/);
        if (kitRota) {
          const cliente = decodeURIComponent(kitRota[1]);
          if (method === "GET") {
            const kit = brandKits.get(cliente) ?? kitVazio(cliente);
            return json(res, 200, { kit, atualizado_em: brandKits.has(cliente) ? new Date().toISOString() : null, identificacaoDoEstudo: { nome: "Dr. Stub da Silva", crm: "12345/RS", rqe: "", de: new Date().toISOString() } });
          }
          if (method === "PUT") {
            const body = await readJsonBody<{ kit?: Record<string, unknown> }>(req);
            const { kit, erros } = normalizarBrandKit({ ...(body.kit || {}), cliente });
            if (erros.length) return json(res, 400, { error: "Alguns campos não puderam ser salvos.", erros });
            const imagens = brandKits.get(cliente)?.imagens ?? kit.imagens;
            brandKits.set(cliente, { ...kit, imagens });
            return json(res, 200, { kit: brandKits.get(cliente), atualizado_em: new Date().toISOString() });
          }
        }
        const kitImg = url.match(/^\/clientes\/([^/]+)\/brand-kit\/imagens\/(logo|logo_escuro|foto_medico)$/);
        if (kitImg) {
          const cliente = decodeURIComponent(kitImg[1]);
          const tipo = kitImg[2] as "logo" | "logo_escuro" | "foto_medico";
          const kit = brandKits.get(cliente) ?? kitVazio(cliente);
          if (method === "GET") {
            const arq = kit.imagens[tipo] ? arquivos.get(kit.imagens[tipo] as string) : null;
            if (!arq) return json(res, 404, { error: "Imagem não encontrada." });
            res.setHeader("Content-Type", arq.mime);
            return res.end(arq.bytes);
          }
          if (method === "PUT") {
            const { bytes, mime } = await lerBinario(req);
            const caminho = `brand-kits/${cliente}/${tipo}-${Date.now()}`;
            arquivos.set(caminho, { bytes, mime });
            brandKits.set(cliente, { ...kit, imagens: { ...kit.imagens, [tipo]: caminho } });
            return json(res, 200, { imagens: brandKits.get(cliente)!.imagens });
          }
          if (method === "DELETE") {
            brandKits.set(cliente, { ...kit, imagens: { ...kit.imagens, [tipo]: null } });
            return json(res, 200, { imagens: brandKits.get(cliente)!.imagens });
          }
        }
        if (url === "/artes/fotos" && method === "POST") {
          const { bytes, mime } = await lerBinario(req);
          const caminho = `artes/${query.get("cliente")}/fotos/${Date.now().toString(36)}`;
          arquivos.set(caminho, { bytes, mime });
          return json(res, 200, { caminho });
        }
        if (url === "/artes" && method === "POST") {
          const body = await readJsonBody<{ compositionId?: string; indice?: number; opcoes?: Record<string, unknown> }>(req);
          const comp = compositions.get(String(body.compositionId));
          if (!comp) return json(res, 404, { error: "Composição não encontrada." });
          if (comp.status !== "ok") return json(res, 409, { error: "Só dá para criar o estático de uma composição salva." });
          const indice = Number(body.indice ?? 0);
          const anuncio = anunciosDaLinha(comp)[indice] as { formato: string; composicao: Record<string, unknown> } | undefined;
          if (!anuncio) return json(res, 409, { error: "Este anúncio não está pronto." });
          const cliente = String(comp.cliente);
          const kit = brandKits.get(cliente) ?? kitVazio(cliente);
          if (!temIdentificacao(kit)) return json(res, 409, { error: "Cadastre nome, CRM e UF do médico no Brand kit do cliente antes de criar a arte." });
          const { opcoes, erros } = normalizarOpcoes(body.opcoes, { kit, cliente, formato: anuncio.formato });
          if (erros.length) return json(res, 400, { error: erros.join(" ") });
          const { exigencia } = exigenciaDeIdentificacao({ uso: opcoes.uso, circulaFora: opcoes.circula_fora, bioConferida: kit.bio_conferida });
          const onde = ondeIdentificar(exigencia, opcoes.onde_identificar);
          if (onde.erro) return json(res, 400, { error: onde.erro });
          const id = `stub-arte-${Date.now().toString(36)}`;
          const arte: Record<string, unknown> = {
            id, composition_id: comp.id, anuncio_indice: indice, cliente, nome_exibicao: comp.nome_exibicao,
            formato_origem: anuncio.formato, opcoes: { ...opcoes, template: "editorial", proporcao: "4:5" },
            marca: { nome_clinica: kit.nome_clinica, paleta: kit.paleta, fontes: kit.fontes, contatos: kit.contatos, enderecos: kit.enderecos, imagens: { logo: kit.imagens.logo, logo_escuro: kit.imagens.logo_escuro } },
            post: null, avisos: [], status: "running", error: null, criado_por: "stub-user",
            criado_em: new Date().toISOString(), atualizado_em: new Date().toISOString(), canDelete: true,
          };
          artes.set(id, arte);
          setTimeout(() => {
            const template = getTemplate("editorial")!;
            const total = totalDeSlides(anuncio);
            const cards = (Array.isArray(anuncio.composicao.carrossel) ? anuncio.composicao.carrossel : []) as string[];
            const abertura = String(anuncio.composicao.abertura || anuncio.composicao.headline || "Anúncio");
            // O "agente": título = o que está entre aspas no card (ou o card), apoio = o resto.
            const slides = Array.from({ length: total }, (_, i) => {
              const card = cards[i] || abertura;
              const aspas = /['"“‘]([^'"”’]+)['"”’]/.exec(card)?.[1];
              const titulo = (aspas || card.split(/[—:]/).pop() || card).trim().slice(0, 60);
              return { titulo, apoio: total > 1 && i > 0 ? card.replace(/^[^:]*:\s*/, "").slice(0, 200) : "", cta: i === total - 1 ? "Agende sua avaliação" : "", foto: i === 0 && opcoes.fotos.length ? 0 : null, alt: `[stub] Página ${i + 1}: ${titulo}` };
            });
            const resposta = "```json\n" + JSON.stringify({ slides, legenda: legendaDoAnuncio(anuncio), hashtags: ["stub"], identificacao: kit.identificacao }) + "\n```";
            const lido = parseArteReply(resposta, { template, total, fotos: opcoes.fotos.length });
            const { post, avisos } = montarPost({ lido, anuncio, template, opcoes, kitIdentificacao: kit.identificacao, onde });
            artes.set(id, { ...arte, post, avisos, status: "pronta" });
          }, 2500);
          return json(res, 202, { id, status: "running" });
        }
        if (url === "/artes" && method === "GET") {
          const lista = [...artes.values()]
            .filter((a) => (!query.get("compositionId") || a.composition_id === query.get("compositionId")) && (query.get("indice") == null || a.anuncio_indice === Number(query.get("indice"))))
            .sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)));
          return json(res, 200, { artes: lista });
        }
        const arteRota = url.match(/^\/artes\/([^/]+)(?:\/(render|fotos\/\d+))?$/);
        if (arteRota) {
          const arte = artes.get(arteRota[1]);
          if (!arte) return json(res, 404, { error: "Arte não encontrada." });
          const sub = arteRota[2];
          const fotos = ((arte.opcoes as { fotos?: { caminho: string }[] }).fotos || []);
          if (!sub && method === "GET") return json(res, 200, { arte: { ...arte, desatualizada: false } });
          if (!sub && method === "DELETE") {
            artes.delete(arte.id as string);
            return json(res, 200, { ok: true });
          }
          if (!sub && method === "PATCH") {
            const body = await readJsonBody<{ slides?: unknown[]; legenda?: string; hashtags?: string[]; fundo?: unknown }>(req);
            const template = getTemplate("editorial")!;
            const post = arte.post as Record<string, unknown>;
            const kit = brandKits.get(String(arte.cliente)) ?? kitVazio(String(arte.cliente));
            const r = aplicarRegrasDoPost({ ...post, slides: body.slides ?? post.slides, legenda: body.legenda ?? post.legenda, hashtags: body.hashtags ?? post.hashtags, fundo: "fundo" in body ? normalizarFundo(body.fundo) : post.fundo ?? null }, template, kit.identificacao);
            artes.set(arte.id as string, { ...arte, post: r.post, avisos: r.avisos });
            return json(res, 200, r);
          }
          if (sub?.startsWith("fotos/") && method === "GET") {
            const arq = arquivos.get(fotos[Number(sub.split("/")[1])]?.caminho);
            if (!arq) return json(res, 404, { error: "Foto não encontrada." });
            res.setHeader("Content-Type", arq.mime);
            return res.end(arq.bytes);
          }
          if (sub === "render" && method === "POST") {
            const body = await readJsonBody<{ indice?: number; formato?: "jpeg" | "png" }>(req);
            const dataUrl = (c?: string | null) => {
              const arq = c ? arquivos.get(c) : null;
              return arq ? `data:${arq.mime};base64,${arq.bytes.toString("base64")}` : null;
            };
            const marca = arte.marca as { imagens: { logo: string | null; logo_escuro: string | null } };
            try {
              const { renderizarSlides } = await import("./apps/ad-spy-worker/post-render.js");
              const host = req.headers.host || "localhost:8080";
              const [slide] = await renderizarSlides({
                post: arte.post, marca: arte.marca, indices: [Number(body.indice ?? 0)], formato: body.formato === "png" ? "png" : "jpeg",
                imagens: { logo: dataUrl(marca.imagens.logo), logo_escuro: dataUrl(marca.imagens.logo_escuro), fotos: fotos.map((f) => dataUrl(f.caminho)) },
                url: `http://${host}/render.html`,
              });
              res.setHeader("Content-Type", body.formato === "png" ? "image/png" : "image/jpeg");
              res.setHeader("Content-Disposition", `attachment; filename="stub-arte-${String(Number(body.indice ?? 0) + 1).padStart(2, "0")}.jpg"`);
              res.setHeader("X-Avisos-Render", encodeURIComponent(JSON.stringify(slide.avisos)));
              return res.end(slide.bytes);
            } catch (err) {
              return json(res, 500, { error: `Render do stub falhou: ${err instanceof Error ? err.message : err}` });
            }
          }
        }

        if (url === "/health") {
          return json(res, 200, {
            ok: true, db: true, inFlight: { analysis: 0, search: 0 },
            limits: { analysis: 1, search: 3, blockSize: BLOCK, maxPagesPerBlock: 3, maxSelected: 30 },
            agentId: "spyagent (stub)", metaProvider: "scrapecreators (stub)",
            providers: [{ id: "meta", impl: "scrapecreators", available: true }],
            whisper: { fasterWhisper: true, device: "cpu", model: "small", cudaDevices: 0, cudaUnusable: null },
            gateway: { url: "ws://127.0.0.1:18789", auth: "none", transport: "auto" },
          });
        }

        if (url === "/runs" && method === "POST") {
          const body = await readJsonBody<{ tema?: string; sources?: string[]; settings?: Record<string, unknown>; extraPrompt?: string }>(req);
          const id = `stub-${Date.now().toString(36)}`;
          const run: Run = {
            id, user_id: "stub-user", tema: String(body.tema || "(sem tema)"), sources: body.sources ?? ["meta"],
            settings: { transcribe: true, ...(body.settings || {}) }, extra_prompt: body.extraPrompt || null,
            status: "searching", stages: seedStages(), cancel_requested: false, analysis_md: null, analysis: null,
            meta_provider: "stub", error: null, criado_em: new Date().toISOString(), updated_at: new Date().toISOString(),
            blocks: 0, credits: 0, ads: [],
          };
          runs.set(id, run);
          addBlock(run);
          return json(res, 202, { runId: id, status: run.status });
        }

        const m = url.match(/^\/runs\/([^/]+)(?:\/([a-z]+))?$/);
        if (m) {
          const run = runs.get(m[1]);
          if (!run) return json(res, 404, { error: "Mineração não encontrada." });
          const action = m[2];

          if (!action && method === "GET") {
            const { ads, blocks: _b, credits: _c, ...rest } = run;
            return json(res, 200, { run: { ...rest, search: summary(run) }, ads });
          }
          if (!action && method === "DELETE") {
            runs.delete(run.id);
            return json(res, 200, { ok: true });
          }
          if (action === "more" && method === "POST") {
            if (BUSY.includes(run.status)) return json(res, 409, { error: "Aguarde a operação em andamento terminar." });
            if (summary(run).exhausted) return json(res, 409, { error: "Não há mais anúncios que atendam aos filtros." });
            addBlock(run);
            return json(res, 202, { ok: true });
          }
          if (action === "analyze" && method === "POST") {
            if (BUSY.includes(run.status)) return json(res, 409, { error: "Aguarde a operação em andamento terminar." });
            const body = await readJsonBody<{ adIds?: number[] }>(req);
            const ids = new Set((body.adIds ?? []).map(Number));
            if (!ids.size) return json(res, 400, { error: "Selecione pelo menos um anúncio." });
            for (const ad of run.ads) ad.selected = ids.has(ad.id);
            analyze(run);
            return json(res, 202, { ok: true, selected: ids.size });
          }
          if (action === "reanalyze" && method === "POST") {
            if (BUSY.includes(run.status)) return json(res, 409, { error: "Aguarde a operação em andamento terminar." });
            const an = run.stages[3];
            Object.assign(an, { status: "running", note: "reanalisando" });
            run.status = "running";
            setTimeout(() => {
              Object.assign(an, { status: "done", note: "reanalisada" });
              run.analysis_md = `${ANALYSIS_MD}\n\n_(reanálise ${new Date().toLocaleTimeString("pt-BR")})_`;
              run.analysis = ANALYSIS_JSON;
              run.status = "done";
            }, 2000);
            return json(res, 202, { ok: true });
          }
          if (action === "ask" && method === "DELETE") {
            run.question = null;
            return json(res, 200, { ok: true });
          }
          if (action === "ask" && method === "POST") {
            const body = await readJsonBody<{ pergunta?: string }>(req);
            const texto = String(body.pergunta || "").trim();
            if (texto.length < 5) return json(res, 400, { error: "Escreva a pergunta." });
            // Como no worker: a pergunta da tela vai para as guardadas (até 4), e voltar a uma
            // guardada traz as respostas dela.
            type Guardada = { texto: string; concluido_em: string | null; respostas: Record<string, unknown> };
            const ant = run.question as (Guardada & { outras?: Guardada[] }) | null | undefined;
            const todas: Guardada[] = [
              ...(ant?.texto && Object.keys(ant.respostas || {}).length
                ? [{ texto: ant.texto, concluido_em: ant.concluido_em, respostas: ant.respostas }]
                : []),
              ...(ant?.outras ?? []),
            ];
            const q = {
              id: Date.now().toString(36), texto, status: "running", error: null as string | null,
              pedido_em: new Date().toISOString(), concluido_em: null as string | null,
              total: run.ads.length, feito: 0,
              respostas: { ...(todas.find((g) => g.texto === texto)?.respostas ?? {}) } as Record<string, unknown>,
              outras: todas.filter((g) => g.texto !== texto).slice(0, 4),
            };
            run.question = q;
            // Inventado: um veredito em rodízio, com o começo do texto como "trecho". Serve para ver
            // a ordenação e os estados do card, não para julgar a pergunta.
            setTimeout(() => { q.feito = Math.ceil(run.ads.length / 2); }, 1200);
            setTimeout(() => {
              // O rodízio muda com a pergunta, para duas perguntas darem ordens diferentes.
              const desvio = texto.length;
              run.ads.forEach((ad, n) => {
                if (q.respostas[String(ad.id)]) return;
                const i = n + desvio;
                const copy = String(ad.ad_copy || "");
                const veredito = copy ? ["atende", "nao", "parcial", "nao"][i % 4] : null;
                q.respostas[String(ad.id)] = {
                  veredito,
                  trecho: veredito && veredito !== "nao" && i % 5 ? copy.slice(0, 90) : null,
                  base: !copy ? "vazio" : ad.transcript ? "transcricao" : "copy",
                };
              });
              q.feito = run.ads.length;
              q.status = "done";
              q.concluido_em = new Date().toISOString();
            }, 2600);
            return json(res, 202, { ok: true, total: run.ads.length });
          }
          if (action === "cancel" && method === "POST") {
            if (run.status !== "running") return json(res, 409, { error: "Não há análise em andamento para cancelar." });
            run.cancel_requested = true;
            return json(res, 200, { ok: true });
          }
          if (action === "save" && method === "POST") {
            if (run.status !== "done" || !run.analysis_md) return json(res, 409, { error: "Só dá para salvar uma análise concluída." });
            const body = await readJsonBody<{ especialidades?: string[]; titulo?: string }>(req);
            if (!body.especialidades?.length) return json(res, 400, { error: "Escolha pelo menos uma especialidade." });
            const ads = run.ads.filter((a) => a.selected).sort((a, b) => b.days_running - a.days_running || a.id - b.id);
            const entry: LibEntry = {
              id: `lib-${Date.now().toString(36)}`, run_id: run.id, tema: run.tema, titulo: body.titulo || null,
              especialidades: body.especialidades, settings: run.settings, extra_prompt: run.extra_prompt,
              analysis_md: run.analysis_md, analysis: run.analysis, ads: JSON.parse(JSON.stringify(ads)),
              saved_by: "stub-user", saved_by_name: "Você (stub)", criado_em: new Date().toISOString(),
            };
            library.unshift(entry);
            return json(res, 201, { id: entry.id });
          }
        }

        // --- Mineração › Análises de Criativos ------------------------------------------------
        if (url === "/criativos" && method === "POST") {
          const body = await readJsonBody<{ runId?: string; libraryEntryId?: string; adId?: number; especialidade?: string; titulo?: string }>(req);
          if (!body.especialidade) return json(res, 400, { error: "Escolha a especialidade da análise." });
          const origem = body.runId
            ? runs.get(body.runId)?.ads
            : (library.find((e) => e.id === body.libraryEntryId)?.ads as StubAd[] | undefined);
          const ad = origem?.find((a) => a.id === Number(body.adId));
          if (!ad) return json(res, 404, { error: "Anúncio não encontrado." });
          const id = `cri-${Date.now().toString(36)}`;
          const agora = new Date().toISOString();
          const item: Record<string, unknown> = {
            id, run_id: body.runId ?? null, library_entry_id: body.libraryEntryId ?? null, ad_id: ad.id,
            titulo: body.titulo || null, especialidades: [body.especialidade], ad, status: "running",
            etapa: ad.media_type === "video" && !ad.transcript ? "transcrevendo o vídeo" : "analisando o criativo",
            error: null, dissecacao: null, dissecacao_md: null, saved_by: "stub-user", saved_by_name: "Você (stub)",
            criado_em: agora, atualizado_em: agora,
          };
          criativos.set(id, item);
          setTimeout(() => {
            Object.assign(item, {
              status: "done",
              etapa: null,
              dissecacao: {
                formato: "Vídeo vertical com a profissional falando para a câmera; legenda na tela.",
                estrutura: "Abre com uma pergunta sobre a dor, apresenta o procedimento, fecha com o convite para a avaliação.",
                anatomia_semantica: "Vocabulário coloquial (\"sorriso\", \"vergonha\"); nomeia o procedimento e omite preço e tempo de recuperação.",
                anatomia_psicologica: "Ataca a vergonha de sorrir e usa autoridade (CRO na tela); pega quem já sabe que tem o problema.",
                nivel_consciencia: "consciente_problema",
              },
              dissecacao_md: "## Formato\n(stub)",
              atualizado_em: new Date().toISOString(),
            });
          }, 2500);
          return json(res, 202, { id, status: "running" });
        }
        if (url.startsWith("/criativos") && method === "GET") {
          const um = url.match(/^\/criativos\/([^/?]+)$/);
          const comFav = (c: Record<string, unknown>) => ({ ...c, canDelete: true, favorito: favoritosCriativos.has(String(c.id)) });
          if (um) {
            const c = criativos.get(um[1]);
            return c ? json(res, 200, { criativo: comFav(c) }) : json(res, 404, { error: "Análise de criativo não encontrada." });
          }
          const esp = new URL(url, "http://x").searchParams.getAll("especialidade");
          const lista = [...criativos.values()]
            .filter((c) => !esp.length || (c.especialidades as string[]).some((e) => esp.includes(e)))
            .reverse()
            .map(comFav);
          return json(res, 200, { criativos: lista });
        }
        const criFav = url.match(/^\/criativos\/([^/]+)\/favorito$/);
        if (criFav && method === "PUT") {
          const body = await readJsonBody<{ favorito?: boolean }>(req);
          if (body.favorito === false) favoritosCriativos.delete(criFav[1]);
          else favoritosCriativos.add(criFav[1]);
          return json(res, 200, { ok: true, favorito: body.favorito !== false });
        }
        const criDel = url.match(/^\/criativos\/([^/]+)$/);
        if (criDel && method === "DELETE") {
          criativos.delete(criDel[1]);
          return json(res, 200, { ok: true });
        }

        // --- Marketing › Clientes -------------------------------------------------------------
        if (url === "/briefs" && method === "GET") {
          return json(res, 200, { briefs: [...briefs.values()] });
        }
        const brf = url.match(/^\/briefs\/([^/]+)(\/refresh)?$/);
        if (brf) {
          const cliente = decodeURIComponent(brf[1]);
          if (method === "GET") {
            const b = briefs.get(cliente);
            return b ? json(res, 200, { brief: b }) : json(res, 404, { error: "Resumo não encontrado." });
          }
          if (method === "POST" && brf[2]) {
            briefs.set(cliente, {
              cliente, nome_exibicao: null, brief_md: null, brief: null, metricas: null,
              fontes: null, status: "running", error: null, agent_id: "stub",
              semana_de: null, semana_ate: null,
              atualizado_em: new Date().toISOString(), atualizado_por: null,
            });
            // O agente real leva dezenas de segundos; aqui o suficiente para ver o polling ligar.
            setTimeout(() => {
              briefs.set(cliente, {
                cliente,
                nome_exibicao: cliente,
                // Marcado como exemplo pelo mesmo motivo do `meta_provider: "stub"`: uma tela de
                // dados falsos indistinguível da real já custou horas de caça a bug inexistente.
                brief_md:
                  "## Contexto Operacional\n\n**Contexto de exemplo do stub de desenvolvimento** — " +
                  "não veio de agente nenhum e não fala deste cliente de verdade.\n\nCriativo novo " +
                  "em aprovação desde o dia 3; a aprovação costuma travar do lado do cliente. Sai um " +
                  "criativo por semana quando a fila anda.\n\n## Riscos e alertas\n\nUm criativo " +
                  "único no ar há 40 dias.",
                brief: {
                  contexto_operacional: "Exemplo do stub — dados falsos, sem número nenhum",
                  riscos: [{ titulo: "Exemplo do stub", gravidade: "baixa", detalhe: "Dados falsos" }],
                },
                // Vazio como o worker novo grava: o Contexto Operacional não fala de número.
                metricas: {},
                fontes: { clickup: false, supabase: true },
                status: "ok", error: null, agent_id: "stub",
                semana_de: "2026-09-08", semana_ate: "2026-09-14",
                atualizado_em: new Date().toISOString(), atualizado_por: null,
              });
            }, 3000);
            return json(res, 202, { ok: true });
          }
        }

        // --- Marketing › Clientes: Documentos -------------------------------------------------
        //
        // A unidade é a PÁGINA de Doc, e o stub imita a forma real do workspace de propósito: o
        // documento do cliente é uma página dentro de um Doc coletivo ("Mapeamento do Cliente" tem
        // uma página por cliente). Um stub com um Doc por cliente faria a tela parecer certa em
        // localhost e errada em produção, que é o pior tipo de stub.
        const docs = url.match(/^\/clientes\/([^/]+)\/documentos$/);
        if (docs && method === "GET") {
          const cliente = decodeURIComponent(docs[1]);
          const agora = Date.now();
          return json(res, 200, {
            // Marcados como exemplo, como o resto do stub: uma lista de links falsos indistinguível
            // da real levaria alguém a procurar no ClickUp um documento que não existe.
            documentos: [
              {
                id: "stub-pag-1",
                nome: `[stub] Mapeamento - ${cliente}`,
                // Um Doc coletivo: duas páginas abaixo, de dois Docs diferentes, mostram o
                // agrupamento da aba funcionando.
                docNome: "[stub] Mapeamento do Cliente",
                url: null,
                local: `MktOps › [stub] Mapeamento do Cliente › Ativo`,
                // A via forte: o título da própria página nomeia o cliente, que é a convenção real.
                via: "pagina",
                tipo: "mapeamento_cliente",
                temConteudo: true,
                criadoEm: new Date(agora - 60 * 86400000).toISOString(),
                atualizadoEm: new Date(agora - 3 * 86400000).toISOString(),
                arquivado: false,
                publico: false,
              },
              {
                id: "stub-pag-2",
                nome: "[stub] Oferta",
                docNome: "[stub] Mapeamento do Cliente",
                url: null,
                local: `MktOps › [stub] Mapeamento do Cliente › Ativo › [stub] Mapeamento - ${cliente}`,
                // Subpágina: herdou o cliente da página acima dela.
                via: "pagina_pai",
                tipo: "mapeamento_cliente",
                temConteudo: true,
                criadoEm: new Date(agora - 60 * 86400000).toISOString(),
                atualizadoEm: new Date(agora - 3 * 86400000).toISOString(),
                arquivado: false,
                publico: false,
              },
              {
                // Fora da allowlist: aparece com link e SEM conteúdo, que é o desenho de segurança.
                // Está no stub para quem desenvolve ver esse estado sem precisar do ClickUp.
                id: "stub-pag-3",
                nome: "[stub] Acessos — exemplo de documento cujo conteúdo NÃO é ingerido",
                docNome: "[stub] Acessos — exemplo de documento cujo conteúdo NÃO é ingerido",
                url: null,
                local: `Carteira › Clientes Ativos › ${cliente}`,
                via: "tarefa",
                tipo: null,
                temConteudo: false,
                criadoEm: new Date(agora - 300 * 86400000).toISOString(),
                atualizadoEm: new Date(agora - 20 * 86400000).toISOString(),
                arquivado: false,
                publico: false,
              },
              {
                id: "stub-pag-4",
                nome: "[stub] Briefing inicial — exemplo, casado só pelo título do Doc",
                docNome: "[stub] Briefing inicial — exemplo, casado só pelo título do Doc",
                url: null,
                local: null,
                via: "nome",
                tipo: "briefing",
                // Sem conteúdo ingerido ainda: a tela mostra "conteúdo ainda não lido", que é
                // diferente de "não ingerido por decisão".
                temConteudo: false,
                criadoEm: new Date(agora - 400 * 86400000).toISOString(),
                atualizadoEm: new Date(agora - 380 * 86400000).toISOString(),
                arquivado: true,
                publico: false,
              },
            ],
            fontes: { clickup: true },
            lidoEm: new Date().toISOString(),
            truncado: false,
          });
        }

        // --- Marketing › Clientes: Relatório --------------------------------------------------
        if (url === "/relatorios" && method === "POST") {
          const body = await readJsonBody<{
            cliente?: string;
            observacao?: string;
            titulo?: string;
            snapshot?: { periodo?: Record<string, unknown>; comparacao?: Record<string, unknown>; avisos?: unknown[]; versao?: number };
          }>(req);
          if (!body.cliente) return json(res, 400, { error: "Informe o cliente." });
          const per = body.snapshot?.periodo;
          if (!per?.de || !per?.ate) return json(res, 400, { error: "Período inválido." });

          const id = `rel-${Date.now().toString(36)}`;
          const agora = new Date().toISOString();
          const linha: Record<string, unknown> = {
            id,
            cliente: body.cliente,
            nome_exibicao: body.cliente,
            // Vazio vira null, como no worker: é o null que faz a tela cair para o rótulo do período.
            titulo: String(body.titulo ?? "").trim() || null,
            periodo_de: per.de,
            periodo_ate: per.ate,
            periodo_kind: per.kind ?? null,
            periodo_label: per.label ?? null,
            comparacao_de: body.snapshot?.comparacao?.de ?? null,
            comparacao_ate: body.snapshot?.comparacao?.ate ?? null,
            comparacao_regra: body.snapshot?.comparacao?.regra ?? null,
            comparacao_motivo: body.snapshot?.comparacao?.motivo ?? null,
            observacao: body.observacao ?? null,
            relatorio_md: null,
            relatorio: null,
            prioridade: null,
            avisos: body.snapshot?.avisos ?? [],
            fontes: {},
            snapshot: body.snapshot ?? {},
            snapshot_versao: body.snapshot?.versao ?? 1,
            origem_numeros: "frontend",
            status: "running",
            error: null,
            agent_id: "stub",
            criado_por: "stub-user",
            criado_em: agora,
            atualizado_em: agora,
            canDelete: true,
          };
          relatorios.set(id, linha);

          // O agente real leva minutos; aqui o suficiente para ver o polling ligar e desligar.
          setTimeout(() => {
            relatorios.set(id, {
              ...linha,
              // Marcado como exemplo pelo mesmo motivo do `meta_provider: "stub"`: uma tela de dados
              // falsos indistinguível da real já custou horas de caça a bug inexistente.
              relatorio_md:
                "## Leitura crítica\n\n**Relatório de exemplo do stub de desenvolvimento** — não " +
                "veio de agente nenhum e não fala deste cliente de verdade.\n\n## Problema ou " +
                "oportunidade\n\nA conversão de lead para consulta é o ponto mais restritivo do " +
                "período (exemplo).\n\n## Causa e correlação\n\nCorrelação, não causa: o tempo de " +
                "primeira resposta subiu na mesma semana.\n\n## Ação recomendada\n\nMedir o tempo " +
                "de primeira resposta por 7 dias.",
              relatorio: {
                leitura: "Exemplo do stub — dados falsos.",
                problema: {
                  prioridade: "gargalo",
                  texto: "Conversão de lead para consulta (exemplo)",
                  impacto: "8 consultas abaixo da meta rateada",
                },
                causa: {
                  texto: "O tempo de primeira resposta subiu na mesma semana",
                  tipo: "correlacao",
                  verificar: "Tempo de primeira resposta por origem",
                },
                acao: {
                  texto: "Medir o tempo de primeira resposta por 7 dias",
                  responsavel: "a definir",
                  prazo: "a definir",
                },
                limitacoes: ["Exemplo do stub: nenhum número aqui é real"],
              },
              prioridade: "gargalo",
              fontes: { crm: true, ads: true, metas: true, overrides: false },
              snapshot: {
                ...(body.snapshot ?? {}),
                // Marcado como exemplo pelo mesmo motivo do `meta_provider: "stub"`. O primeiro tem
                // link de vídeo e o segundo não, para a tela ser vista nos dois casos.
                criativos: {
                  canais: { meta: true },
                  total: 7,
                  itens: [
                    {
                      canal: "meta", adId: "1", nome: "Exemplo do stub — depoimento", status: "ativo",
                      headline: "Exemplo do stub (dado falso)", thumbnail: null,
                      link: "https://www.facebook.com/reel/000000",
                      investimento: 1200, resultados: 18, tipoResultado: "Leads",
                      custoPorResultado: 66.6, leadsMeta: 18, cliques: 240, impressoes: 30000,
                    },
                    {
                      canal: "meta", adId: "2", nome: "Exemplo do stub — carrossel", status: "pausado",
                      headline: null, thumbnail: null, link: null,
                      investimento: 90, resultados: 0, tipoResultado: "Leads",
                      custoPorResultado: null, leadsMeta: 0, cliques: 12, impressoes: 2100,
                    },
                  ],
                },
              },
              status: "ok",
              atualizado_em: new Date().toISOString(),
            });
          }, 3000);

          return json(res, 202, { id, status: "running" });
        }
        if (url === "/relatorios" && method === "GET") {
          const cliente = query.get("cliente");
          const rows = [...relatorios.values()].filter((r) => !cliente || r.cliente === cliente);
          rows.sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)));
          return json(res, 200, { relatorios: rows });
        }
        const rel = url.match(/^\/relatorios\/([^/]+)$/);
        if (rel) {
          const relatorio = relatorios.get(rel[1]);
          if (!relatorio) return json(res, 404, { error: "Relatório não encontrado." });
          if (method === "GET") return json(res, 200, { relatorio });
          if (method === "PATCH") {
            const body = await readJsonBody<{ titulo?: string }>(req);
            const titulo = String(body.titulo ?? "").trim() || null;
            relatorios.set(rel[1], { ...relatorio, titulo, atualizado_em: new Date().toISOString() });
            return json(res, 200, { ok: true, titulo });
          }
          if (method === "DELETE") {
            relatorios.delete(rel[1]);
            return json(res, 200, { ok: true });
          }
        }

        // --- Marketing › Composer -------------------------------------------------------------
        const docConteudo = url.match(/^\/clientes\/([^/]+)\/documentos\/([^/]+)\/conteudo$/);
        if (docConteudo && method === "GET") {
          // Os três estados que a tela precisa saber mostrar, escolhidos pelo id da página — em
          // localhost dá para ver os três sem ClickUp nenhum. O quarto (conteúdo de verdade) é o
          // primeiro caso.
          const pageId = decodeURIComponent(docConteudo[2]);
          if (pageId === "stub-pag-1" || pageId === "stub-pag-2") {
            return json(res, 200, {
              conteudo_md:
                "## [stub] Persona\n\nMulheres de 35 a 50 anos, renda alta, buscam procedimento " +
                "estético com segurança.\n\n## [stub] Oferta\n\nAvaliação inicial sem custo.\n\n" +
                "_Conteúdo de exemplo do stub de desenvolvimento — não existe no ClickUp._",
              fontes: { clickup: true },
              erro: null,
              lidoEm: new Date().toISOString(),
            });
          }
          if (pageId === "stub-pag-3") {
            // Fora da allowlist: NÃO vamos ler, por decisão. É `clickup: false` com a razão, porque
            // dizer "está vazio" sobre o "Acessos" seria mentir.
            return json(res, 200, {
              conteudo_md: null,
              fontes: { clickup: false },
              erro:
                "O conteúdo deste documento não é lido por decisão: o tipo dele não está na lista " +
                "de tipos ingeridos. Abra no ClickUp pelo link.",
              lidoEm: null,
            });
          }
          return json(res, 200, {
            conteudo_md: null,
            fontes: { clickup: false },
            erro: "Stub de desenvolvimento: esta página ainda não teve o conteúdo ingerido.",
            lidoEm: null,
          });
        }

        if (url === "/compositions" && method === "POST") {
          const body = await readJsonBody<{
            cliente?: string;
            libraryEntryId?: string | null;
            entradas?: { tipo: string; id: string | null; titulo?: string | null }[];
            extraPrompt?: string;
          }>(req);
          if (!body.cliente) return json(res, 400, { error: "Informe o cliente." });
          // As mesmas exigências do worker: análise e ao menos um documento.
          if (!body.libraryEntryId) {
            return json(res, 400, { error: "Escolha uma análise da Biblioteca para compor." });
          }
          if (!(body.entradas ?? []).some((e) => e.tipo === "documento")) {
            return json(res, 400, { error: "Escolha ao menos um documento do cliente para compor." });
          }

          // Nem o formato nem a QUANTIDADE vêm no pedido: quem decide é o agente. O stub imita isso
          // lendo o que o pedido escreveu — os formatos nomeados e o primeiro número de 1 a 8 — e
          // caindo em UM Reels quando não pediu nada, como o agente de verdade.
          const pedido = (body.extraPrompt || "").toLowerCase();
          const disponiveis = AD_FORMATS.filter((f) => f.disponivel);
          const nomeados = disponiveis.filter(
            (f) =>
              pedido.includes(f.label.toLowerCase()) ||
              pedido.includes(f.id) ||
              // "reels", "stories", "feed": é assim que se pede, sem o "Instagram" na frente.
              pedido.includes(f.label.toLowerCase().replace(/^instagram /, "").replace(/ \(.*$/, "")),
          );
          const numero = Number(pedido.match(/\b([1-9])\b/)?.[1] ?? 0);
          const base = nomeados.length ? nomeados : [disponiveis[0]];
          const total = Math.min(MAX_ANUNCIOS, Math.max(numero, base.length));
          const formatos = Array.from({ length: total }, (_, i) => base[i % base.length]);
          const entradas = Array.isArray(body.entradas) ? body.entradas : [];

          const id = `cmp-${Date.now().toString(36)}`;
          const analise = library.find((e) => e.id === body.libraryEntryId);
          const agora = new Date().toISOString();
          const linha: Record<string, unknown> = {
            id,
            cliente: body.cliente,
            nome_exibicao: body.cliente,
            library_entry_id: analise?.id ?? null,
            analise_titulo: analise ? analise.titulo || analise.tema : null,
            // NULL enquanto roda: o formato só existe depois que o "agente" escolhe.
            formato: null,
            formato_justificativa: null,
            // Vazios até a "primeira chamada" voltar: é ela que decide o conjunto.
            plano: [],
            anuncios: [],
            entradas,
            extra_prompt: body.extraPrompt ?? null,
            composicao_md: null,
            composicao: null,
            avisos: [],
            fontes: null,
            metricas: null,
            semana_de: null,
            semana_ate: null,
            status: "running",
            error: null,
            agent_id: "stub",
            criado_por: "stub-user",
            criado_em: agora,
            atualizado_em: agora,
            canDelete: true,
          };
          compositions.set(id, linha);

          const camposDoStub = (formato: (typeof AD_FORMATS)[number]) => {
            const composicao: Record<string, string | string[]> = {};
            for (const campo of formato.campos) {
              composicao[campo.id] =
                campo.tipo === "lista"
                  ? Array.from({ length: campo.itens?.min || 2 }, (_, i) =>
                      // O primeiro item estoura o limite DE PROPÓSITO: é assim que se revê o aviso
                      // de "34/30" sem precisar de um agente errando na hora certa.
                      i === 0 && campo.limite
                        ? `Exemplo do stub ${"x".repeat(campo.limite)}`
                        : `Exemplo ${i + 1} do stub para ${campo.label}`,
                    )
                  : `Exemplo do stub para ${campo.label} — dados falsos, não veio de agente nenhum.`;
            }
            return composicao;
          };

          const anuncios = formatos.map((formato, i) => ({
            formato: formato.id,
            angulo: `Ângulo de exemplo ${i + 1} do stub`,
            formato_justificativa: "Escolhido pelo stub a partir do que o pedido dizia (ou o default).",
            status: "pendente",
            composicao_md: null as string | null,
            composicao: null as Record<string, string | string[]> | null,
            avisos: [] as ReturnType<typeof validarLimites>,
            error: null,
          }));

          /** Grava a linha como o worker grava: `plano` e `avisos` sempre derivados de `anuncios`. */
          const gravar = (extra: Record<string, unknown> = {}) => {
            // Apagada no meio do caminho: não ressuscitar a linha.
            if (!compositions.has(id)) return;
            compositions.set(id, {
              ...compositions.get(id),
              anuncios: anuncios.map((a) => ({ ...a })),
              plano: anuncios.map((a) => ({ formato: a.formato, angulo: a.angulo, status: a.status })),
              avisos: anuncios.flatMap((a, i) => a.avisos.map((x) => ({ ...x, anuncio: i }))),
              atualizado_em: new Date().toISOString(),
              ...extra,
            });
          };

          const escrever = (i: number) => {
            // Cancelada no meio: a rota de cancelar já fechou a linha; não escrever por cima.
            if (compositions.get(id)?.status !== "running") return;
            const composicao = camposDoStub(formatos[i]);
            Object.assign(anuncios[i], {
              status: "ok",
              composicao,
              avisos: validarLimites(formatos[i].id, composicao),
              composicao_md: i === 0 ? null : `Nota de exemplo do stub para o anúncio ${i + 1}.`,
            });
            if (anuncios[i + 1]) anuncios[i + 1].status = "running";
            // Pronta = em revisão, como no worker: quem pediu revê e salva.
            gravar(i === anuncios.length - 1 ? { status: "revisao" } : {});
            // Um a um, como o worker: é o que deixa ver o marcador "2 de 5" andando em localhost.
            if (anuncios[i + 1]) setTimeout(() => escrever(i + 1), 2000);
          };

          // O agente real leva minutos; aqui o suficiente para ver o polling ligar e desligar.
          setTimeout(() => {
            gravar({
              // Marcado como exemplo pelo mesmo motivo do `meta_provider: "stub"`: uma tela de
              // dados falsos indistinguível da real já custou horas de caça a bug inexistente.
              composicao_md:
                "**Composição de exemplo do stub de desenvolvimento** — não veio de agente " +
                "nenhum e não fala deste cliente de verdade.",
              formato: formatos[0].id,
              formato_justificativa: anuncios[0].formato_justificativa,
              fontes: {
                analise: Boolean(analise),
                brief: entradas.some((e) => e.tipo === "brief"),
                relatorios: entradas.filter((e) => e.tipo === "relatorio").length,
                documentos: entradas.filter((e) => e.tipo === "documento").length,
                // No stub nenhum documento tem corpo, igual ao worker antes da busca existir.
                documentos_sem_corpo: entradas.filter((e) => e.tipo === "documento").length,
              },
              metricas: {},
            });
            escrever(0);
          }, 3000);

          return json(res, 202, { id, status: "running" });
        }
        if (url === "/compositions" && method === "GET") {
          const cliente = query.get("cliente");
          const rows = [...compositions.values()].filter(
            (c) => !cliente || c.cliente === cliente,
          );
          // Mais recente primeiro, como o worker (`order=criado_em.desc`).
          rows.sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)));
          return json(res, 200, { compositions: rows });
        }
        // --- Revisão da composição: editar, pedir revisão, desfazer, salvar -------------------
        const cmpAnuncio = url.match(/^\/compositions\/([^/]+)\/anuncios\/(\d+)(?:\/(revisao|desfazer))?$/);
        if (cmpAnuncio) {
          const [, cid, idx, acao] = cmpAnuncio;
          const atual = compositions.get(cid);
          if (!atual) return json(res, 404, { error: "Composição não encontrada." });
          if (atual.status !== "revisao") return json(res, 409, { error: "Esta composição não está em revisão." });
          const indice = Number(idx);
          const lista = [...((atual.anuncios as Record<string, unknown>[]) ?? [])];
          const anuncio = lista[indice];
          if (!anuncio) return json(res, 404, { error: "Anúncio não encontrado nesta composição." });
          const versoes = [...((atual.versoes as Record<string, unknown>[]) ?? [])];
          const derivar = (l: Record<string, unknown>[]) => ({
            anuncios: l,
            plano: l.map((a) => ({ formato: a.formato, angulo: a.angulo, status: a.status })),
            avisos: l.flatMap((a, i) =>
              ((a.avisos as object[]) ?? []).map((x) => ({ ...x, anuncio: i })),
            ),
          });
          const guardar = (motivo: string) =>
            versoes.push({ indice, motivo, em: new Date().toISOString(), composicao: anuncio.composicao, avisos: anuncio.avisos });

          if (method === "PATCH" && !acao) {
            const body = await readJsonBody<{ campos?: Record<string, string | string[]> }>(req);
            guardar("edicao");
            const campos = body.campos ?? {};
            lista[indice] = {
              ...anuncio,
              composicao: campos,
              avisos: validarLimites(String(anuncio.formato), campos),
              editado: true,
              error: null,
            };
            compositions.set(cid, { ...atual, ...derivar(lista), versoes });
            return json(res, 200, { ok: true });
          }
          if (method === "POST" && acao === "revisao") {
            const body = await readJsonBody<{ pedido?: string }>(req);
            lista[indice] = { ...anuncio, status: "running", ultima_revisao: body.pedido ?? "" };
            compositions.set(cid, { ...atual, ...derivar(lista) });
            // O "agente" de mentira: acrescenta um marcador a cada campo de texto, para ver mudar.
            setTimeout(() => {
              const agoraLinha = compositions.get(cid);
              if (!agoraLinha) return;
              const l = [...(agoraLinha.anuncios as Record<string, unknown>[])];
              const antes = l[indice];
              const novos = Object.fromEntries(
                Object.entries((antes.composicao as Record<string, unknown>) ?? {}).map(([k, v]) => [
                  k,
                  typeof v === "string" ? `${v} [revisado pelo stub]` : v,
                ]),
              ) as Record<string, string | string[]>;
              guardar("revisao");
              l[indice] = {
                ...antes,
                status: "ok",
                composicao: novos,
                avisos: validarLimites(String(antes.formato), novos),
                error: null,
              };
              compositions.set(cid, { ...agoraLinha, ...derivar(l), versoes });
            }, 3000);
            return json(res, 202, { ok: true });
          }
          if (method === "POST" && acao === "desfazer") {
            const pos = versoes.map((v) => v.indice).lastIndexOf(indice);
            if (pos < 0) return json(res, 409, { error: "Não há versão anterior deste anúncio." });
            const [versao] = versoes.splice(pos, 1);
            lista[indice] = { ...anuncio, composicao: versao.composicao, avisos: versao.avisos ?? [] };
            compositions.set(cid, { ...atual, ...derivar(lista), versoes });
            return json(res, 200, { ok: true });
          }
        }
        const cmpSalvar = url.match(/^\/compositions\/([^/]+)\/salvar$/);
        if (cmpSalvar && method === "POST") {
          const atual = compositions.get(cmpSalvar[1]);
          if (!atual) return json(res, 404, { error: "Composição não encontrada." });
          if (atual.status !== "revisao") return json(res, 409, { error: "Esta composição não está em revisão." });
          compositions.set(cmpSalvar[1], { ...atual, status: "ok" });
          // A orquestração que esperava esta composição fecha junto.
          for (const [oid, o] of orquestracoes) {
            if (o.composition_id === cmpSalvar[1] && o.status === "revisao") {
              orquestracoes.set(oid, {
                ...o,
                status: "ok",
                etapas: (o.etapas as { key: string }[]).map((e) =>
                  e.key === "revisao" ? { ...e, status: "done", note: "revisada e salva" } : e,
                ),
              });
            }
          }
          return json(res, 200, { ok: true });
        }

        const cmpCancel = url.match(/^\/compositions\/([^/]+)\/cancel$/);
        if (cmpCancel && method === "POST") {
          const atual = compositions.get(cmpCancel[1]);
          if (!atual) return json(res, 404, { error: "Composição não encontrada." });
          if (atual.status !== "running") return json(res, 409, { error: "Esta composição já terminou." });
          // Mesma regra do worker: com anúncio pronto fecha ok (os prontos ficam), sem nenhum é erro.
          const anuncios = (atual.anuncios as { status: string }[] | undefined) ?? [];
          const prontos = anuncios.some((a) => a.status === "ok");
          const fechados = anuncios.map((a) =>
            a.status === "ok" ? a : { ...a, status: "error", error: "Cancelada por quem pediu." },
          );
          compositions.set(cmpCancel[1], {
            ...atual,
            status: prontos ? "ok" : "error",
            error: "Cancelada por quem pediu.",
            anuncios: fechados,
            plano: fechados.map((a) => ({ ...(a as object), composicao: undefined })),
          });
          return json(res, 202, { ok: true });
        }
        const cmp = url.match(/^\/compositions\/([^/]+)$/);
        if (cmp) {
          const composition = compositions.get(cmp[1]);
          if (!composition) return json(res, 404, { error: "Composição não encontrada." });
          if (method === "GET") return json(res, 200, { composition });
          if (method === "DELETE") {
            compositions.delete(cmp[1]);
            return json(res, 200, { ok: true });
          }
        }

        // --- Marketing › Composer › Orquestrador -------------------------------------------------
        if (url === "/orquestracoes" && method === "POST") {
          const body = await readJsonBody<{ cliente?: string; pedido?: string }>(req);
          if (!body.cliente) return json(res, 400, { error: "Informe o cliente." });
          const id = `orq-${Date.now().toString(36)}`;
          const agora = () => new Date().toISOString();
          const etapas = [
            ["numeros", "Números do cliente", "semana de 2026-09-28 a 2026-10-04"],
            ["plano", "Diagnóstico e plano", "Qualificar melhor: o tráfego traz lead e o CRM não agenda."],
            ["analise", "Análise de concorrentes", "da Biblioteca: análise de exemplo do stub"],
            ["pedido", "Pedido ao Composer", null],
            ["composicao", "Composição", "1 anúncio(s)"],
            ["revisao", "Revisão", null],
          ].map(([key, label, fim]) => ({
            key, label, fim, status: "pending", note: null as string | null,
            started_at: null as string | null, ended_at: null as string | null,
          }));
          const linha: Record<string, unknown> = {
            id,
            cliente: body.cliente,
            nome_exibicao: body.cliente,
            pedido: body.pedido ?? null,
            status: "running",
            error: null,
            etapas,
            diagnostico_md: null,
            decisoes: {},
            perguntas: [],
            metricas: {},
            semana_de: null,
            semana_ate: null,
            run_id: null,
            library_entry_id: null,
            composition_id: null,
            criado_por: "stub-user",
            criado_em: agora(),
            atualizado_em: agora(),
            canDelete: true,
          };
          orquestracoes.set(id, linha);

          // Uma etapa a cada 1,5 s: o suficiente para ver o percurso andar em localhost. Os dados
          // são falsos e dizem que são — nenhum agente foi consultado.
          const pedidoAoComposer = "[stub] Um Reels sobre a objeção mais comum do nicho.";
          const avancar = (i: number) => {
            if (orquestracoes.get(id)?.status !== "running") return;
            if (i > 0) Object.assign(etapas[i - 1], { status: "done", note: etapas[i - 1].fim, ended_at: agora() });
            const extra: Record<string, unknown> = {};
            if (i === 1) {
              Object.assign(extra, {
                semana_de: "2026-09-28",
                semana_ate: "2026-10-04",
                metricas: {
                  atual: { investimento: 3000, leadsTrafego: 62, leadsCRM: 48, consultasAgendadas: 6, faturamentoBruto: 18000, roas: 6 },
                  anterior: { investimento: 3000, leadsTrafego: 58, leadsCRM: 45, consultasAgendadas: 11, faturamentoBruto: 24000, roas: 8 },
                },
              });
            }
            if (i === 2) {
              Object.assign(extra, {
                diagnostico_md:
                  "**Diagnóstico de exemplo do stub de desenvolvimento** — não veio de agente nenhum. " +
                  "O investimento se manteve e os leads também; o que caiu foram as consultas agendadas.",
                decisoes: {
                  abordagem: "Qualificar melhor: o tráfego traz lead e o CRM não agenda.",
                  contexto_operacional: true,
                  analise: { id: "stub-lib", titulo: "análise de exemplo do stub", motivo: "mesmo nicho e recente", nova: false },
                  mineracao: null,
                  relatorios: [{ id: "stub-rel", titulo: "Setembro", motivo: "é o período do diagnóstico" }],
                  documentos: [],
                  pedido_ao_composer: null,
                },
                perguntas: [
                  { para: "orquestrador", assunto: "diagnóstico e plano", pergunta: "[stub] ficha, números, relatórios, documentos e análises do cliente", resposta: "[stub] diagnóstico e plano", erro: null, em: agora() },
                ],
              });
            }
            if (i === 4) {
              const atual = orquestracoes.get(id)!;
              // A composição é uma linha comum: aparece em Composições Salvas como qualquer outra.
              const formato = AD_FORMATS.find((f) => f.id === "instagram_reels")!;
              const composicao = Object.fromEntries(
                formato.campos.map((c) => [
                  c.id,
                  c.tipo === "lista"
                    ? Array.from({ length: c.itens?.min || 2 }, (_, k) => `Exemplo ${k + 1} do stub para ${c.label}`)
                    : `Exemplo do stub para ${c.label} — dados falsos.`,
                ]),
              );
              const cid = `cmp-${Date.now().toString(36)}`;
              const anuncio = {
                formato: formato.id,
                angulo: "Ângulo de exemplo do stub",
                formato_justificativa: "Escolhido pelo stub.",
                status: "ok",
                composicao_md: null,
                composicao,
                avisos: validarLimites(formato.id, composicao),
                error: null,
              };
              compositions.set(cid, {
                id: cid,
                cliente: body.cliente,
                nome_exibicao: body.cliente,
                library_entry_id: null,
                analise_titulo: "análise de exemplo do stub",
                formato: formato.id,
                formato_justificativa: anuncio.formato_justificativa,
                plano: [{ formato: anuncio.formato, angulo: anuncio.angulo, status: "ok" }],
                anuncios: [anuncio],
                entradas: [{ tipo: "brief", id: null, titulo: "Contexto Operacional" }],
                extra_prompt: pedidoAoComposer,
                composicao_md: "**Composição de exemplo do stub** — pedida pelo orquestrador de mentira.",
                composicao: null,
                avisos: [],
                fontes: { analise: true, brief: true, relatorios: 1, documentos: 0, documentos_sem_corpo: 0 },
                metricas: {},
                semana_de: null,
                semana_ate: null,
                status: "revisao",
                error: null,
                agent_id: "stub",
                criado_por: "stub-user",
                criado_em: agora(),
                atualizado_em: agora(),
                canDelete: true,
              });
              Object.assign(extra, {
                composition_id: cid,
                decisoes: { ...(atual.decisoes as object), pedido_ao_composer: pedidoAoComposer },
              });
            }
            // A última etapa é a revisão: a vez passa a uma pessoa, e o stub para aqui, como o worker.
            const revisao = etapas[i]?.key === "revisao";
            if (i < etapas.length) {
              Object.assign(etapas[i], {
                status: revisao ? "aguardando" : "running",
                note: revisao ? "aguardando a revisão e o salvar de quem disparou" : null,
                started_at: agora(),
              });
            }
            orquestracoes.set(id, {
              ...orquestracoes.get(id),
              ...extra,
              etapas: etapas.map(({ fim: _f, ...e }) => e),
              status: revisao ? "revisao" : i < etapas.length ? "running" : "ok",
              atualizado_em: agora(),
            });
            if (i < etapas.length && !revisao) setTimeout(() => avancar(i + 1), 1500);
          };
          avancar(0);
          return json(res, 202, { id, status: "running" });
        }
        if (url === "/orquestracoes" && method === "GET") {
          const rows = [...orquestracoes.values()];
          rows.sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)));
          return json(res, 200, { orquestracoes: rows });
        }
        const orqCancel = url.match(/^\/orquestracoes\/([^/]+)\/cancel$/);
        if (orqCancel && method === "POST") {
          const atual = orquestracoes.get(orqCancel[1]);
          if (!atual) return json(res, 404, { error: "Orquestração não encontrada." });
          if (atual.status !== "running") return json(res, 409, { error: "Esta orquestração já terminou." });
          // `avancar` confere o status antes de cada passo, então gravar o fim aqui basta para parar.
          orquestracoes.set(orqCancel[1], {
            ...atual,
            status: "error",
            error: "Cancelada por quem disparou.",
            etapas: (atual.etapas as { status: string }[]).map((e) =>
              e.status === "running" ? { ...e, status: "error", note: "cancelada" } : e,
            ),
          });
          return json(res, 202, { ok: true });
        }
        const orq = url.match(/^\/orquestracoes\/([^/]+)$/);
        if (orq) {
          const orquestracao = orquestracoes.get(orq[1]);
          if (!orquestracao) return json(res, 404, { error: "Orquestração não encontrada." });
          if (method === "GET") return json(res, 200, { orquestracao });
          if (method === "DELETE") {
            orquestracoes.delete(orq[1]);
            return json(res, 200, { ok: true });
          }
        }

        if (url === "/pesquisa" && method === "POST") {
          const corpo = await readJsonBody<{ nicho?: string }>(req);
          return json(res, 200, {
            resumoMd:
              "O nicho anuncia por técnica e por naturalidade do resultado, não por preço. " +
              "Termos de busca do Google (\"melhor clínica\") não aparecem na copy.",
            termos: [
              { termo: "sem raspagem", porque: "é como o mercado nomeia a técnica na copy", confianca: "visto", onde: "anúncio da Clínica de exemplo" },
              { termo: "fio a fio", porque: "jargão recorrente nas legendas", confianca: "visto", onde: "perfil de exemplo" },
              { termo: "fue", porque: "nome técnico, aparece em anúncio de especialista", confianca: "inferido", onde: "" },
              { termo: String(corpo?.nicho ?? "nicho").slice(0, 40), porque: "o próprio tema, como linha de base", confianca: "palpite", onde: "" },
            ],
            concorrentes: [{ nome: "Clínica de exemplo", onde: "instagram.com/exemplo" }],
            vocabulario: ["linha frontal", "densidade", "pós-operatório"],
            fontes: { web: true },
            semBlocoJson: false,
          });
        }

        if (url === "/probe" && method === "POST") {
          const corpo = await readJsonBody<{ termos?: string[]; fontes?: string[] }>(req);
          const termos = (corpo?.termos ?? []).slice(0, 5);
          const fontes = corpo?.fontes?.length ? corpo.fontes : ["meta"];
          const organica = (f: string) =>
            f === "instagram_reels" || f === "instagram_hashtag" || f.startsWith("youtube");
          return json(res, 200, {
            // Números inventados, mas no formato real: um termo bom, um fraco e um vazio ajudam
            // a revisar a tela sem gastar crédito. Agrupado por fonte, como o worker devolve.
            resultados: fontes.flatMap((fonte) =>
              termos.map((termo, i) => ({
                termo,
                fonte,
                consulta:
                  fonte === "instagram_hashtag" || fonte === "youtube_hashtag"
                    ? `#${termo.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9_]/g, "")}`
                    : null,
                retornados: organica(fonte) ? 12 : 30,
                passaram: [11, 3, 0][i % 3],
                anunciantes: [7, 2, 0][i % 3],
                medianaDias: organica(fonte) ? null : [148, 41, null][i % 3],
                medianaViews: organica(fonte) ? [48000, 3200, null][i % 3] : null,
                motivos: organica(fonte)
                  ? { "copy curta": 1 }
                  : i % 3 === 0
                    ? { "roda há pouco tempo": 12 }
                    : { "poucos anúncios com o criativo": 27 },
                temMais: true,
                erro: null,
              })),
            ),
            creditsUsed: termos.length * fontes.length,
            maxTermos: 5,
          });
        }

        if (url === "/library" && method === "GET") {
          const esp = query.getAll("especialidade");
          const rows = library.filter((e) => !esp.length || e.especialidades.some((x) => esp.includes(x)));
          return json(res, 200, {
            entries: rows.map(({ ads, ...e }) => ({
              ...e,
              adCount: ads.length,
              coverAdIds: ads.slice(0, 4).map((a) => a.id),
              canDelete: true,
              favorito: favoritos.has(e.id),
            })),
          });
        }
        const fav = url.match(/^\/library\/([^/]+)\/favorito$/);
        if (fav && method === "PUT") {
          const entry = library.find((e) => e.id === fav[1]);
          if (!entry) return json(res, 404, { error: "Análise não encontrada." });
          const corpo = await readJsonBody<{ favorito?: boolean }>(req);
          const favorito = corpo?.favorito !== false;
          if (favorito) favoritos.add(entry.id);
          else favoritos.delete(entry.id);
          return json(res, 200, { ok: true, favorito });
        }

        const lib = url.match(/^\/library\/([^/]+)$/);
        if (lib) {
          const entry = library.find((e) => e.id === lib[1]);
          if (!entry) return json(res, 404, { error: "Análise não encontrada." });
          if (method === "GET") return json(res, 200, { entry: { ...entry, canDelete: true } });
          if (method === "DELETE") {
            library.splice(library.indexOf(entry), 1);
            return json(res, 200, { ok: true });
          }
        }

        const media = url.match(/^\/media\/(\d+)\/(thumb|avatar)\.jpg$/);
        if (media) {
          const n = Number(media[1]);
          res.statusCode = 200;
          res.setHeader("Content-Type", "image/svg+xml");
          return res.end(placeholderSvg(ADVERTISERS[n % ADVERTISERS.length], media[2] === "avatar"));
        }

        return next();
      });
    },
  };
}
