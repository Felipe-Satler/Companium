/**
 * Orquestrador — uma composição conduzida do começo ao fim, sem ninguém clicando entre as etapas.
 *
 * Recebe um cliente e faz, em ordem, o que o estrategista faz passando por três telas:
 *
 *   1. NÚMEROS    lê as duas semanas fechadas do cliente (CRM + anúncios);
 *   2. PLANO      o orquestrador diagnostica, escolhe a abordagem, decide se uma análise da
 *                 Biblioteca serve e escolhe relatórios e documentos;
 *   3. ANÁLISE    usa a análise escolhida — ou manda fazer uma: agente de pesquisa -> busca ->
 *                 pergunta ao grid -> transcrição e análise -> salva na Biblioteca;
 *   4. PEDIDO     o orquestrador escreve o pedido ao Composer, já sabendo o que a análise diz;
 *   5. CONCEITOS  o Composer sugere um Conceito Estratégico por anúncio (desde 20/10/2026), do Estudo
 *                 de Copy do cliente e das análises de criativo da especialidade dele; a orquestração
 *                 PARA aqui esperando quem disparou aprovar — ou, com "pular revisão", aprova sozinha;
 *   6. COMPOSIÇÃO o Composer escreve os anúncios (`runComposition`, o mesmo da tela).
 *
 * ## O orquestrador decide; este arquivo executa
 *
 * O agente é texto-entra/texto-sai, como todos os outros. Ele não "conversa" com os outros bots:
 * escreve o que perguntar a cada um, e é este arquivo que leva a pergunta e traz a resposta. Cada
 * pergunta feita fica em `perguntas`, com para quem foi e o que voltou — é a diferença entre um
 * piloto automático que dá para auditar e uma caixa preta que entrega anúncio.
 *
 * ## Falha no meio NÃO derruba o fim
 *
 * Sem números, o plano é feito pelos relatórios. Mineração que não acha anúncio, fila de análise
 * que não libera, pergunta ao grid que falha: a orquestração registra o que houve na etapa e segue
 * para compor com o que tem — o Composer sabe compor sem análise, e diz isso em `fontes`. Só duas
 * coisas param tudo: o cliente não estar na carteira ativa e a composição em si falhar.
 *
 * ## De onde vêm os números
 *
 * Das duas semanas FECHADAS, lidas pelo worker (`coletarComMetricas`). Não é o mesmo número do
 * Relatório, que vem do navegador com metas e correções manuais e por isso não pode ser gerado
 * daqui. O orquestrador ESCOLHE relatórios já salvos; não escreve um novo.
 */

import { runAgentCli } from "./agent-cli.js";
import { salvarRunNaBiblioteca } from "./biblioteca.js";
import { coletarComMetricas, coletarFichas, mesesDeCasa } from "./briefs.js";
import { runComposition } from "./composer.js";
import { conduzirSozinho } from "./composer-conceitos.js";
import { depsDeConceitos, esperarFila, rodarConceitos } from "./conceitos-servico.js";
import { ehPaginaDeEstudo } from "../../shared/estudo-copy.js";
import { ehPaginaDeResumo } from "../../shared/resumo-estrategico.js";
import { subpaginasDe } from "./docs-atribuicao.js";
import { MAX_ANUNCIOS } from "../../shared/ad-formats.js";
import {
  COMPOSER_AGENT_ID,
  MAX_EXTRA_PROMPT_CHARS,
  MAX_ORQUESTRADOR_CHARS,
  ORQ_ESPERA_ANALISE_MS,
  ORQ_MAX_BUSCAS,
  ORQ_MAX_SELECIONADOS,
  ORQUESTRADOR_AGENT_ID,
  ORQUESTRADOR_RUN_TIMEOUT_MS,
  PERGUNTA_AGENT_ID,
  PERGUNTA_RUN_TIMEOUT_MS,
  PESQUISA_AGENT_ID,
  PESQUISA_RUN_TIMEOUT_MS,
} from "./config.js";
import {
  getBrief,
  getComposition,
  getLibraryEntry,
  getReport,
  getRun,
  insertComposition,
  insertRun,
  listAds,
  listClientDocPages,
  listCriativos,
  listFavoritosCriativos,
  listLibrary,
  listReports,
  patchComposition,
  patchOrquestracao,
  patchRun,
  setSelection,
} from "./db.js";
import {
  buildBriefingPrompt,
  buildPlanoPrompt,
  ordenarTermos,
  parseBriefingReply,
  parsePlanoReply,
  selecionarPecas,
} from "./orquestrador-prompt.js";
import { MAX_PERGUNTA_ADS, runPergunta } from "./pergunta.js";
import { buildPesquisaPrompt, parsePesquisaReply } from "./pesquisa.js";
import { analyzeSelected, hasAnalysisCapacity, searchBlock } from "./runner.js";

/** As etapas, na ordem. Semeadas no insert para a tela desenhar o caminho inteiro desde o começo. */
export const ETAPAS_ORQUESTRACAO = [
  { key: "numeros", label: "Números do cliente" },
  { key: "plano", label: "Diagnóstico e plano" },
  { key: "analise", label: "Análise de concorrentes" },
  { key: "pedido", label: "Pedido ao Composer" },
  // Desde 20/10/2026: um Conceito Estratégico por anúncio, aprovado antes de escrever. Sem "pular
  // revisão" a orquestração ESPERA aqui (status `conceitos`); quem aprova na tela é que a continua
  // (rota `/conceitos/confirmar`).
  { key: "conceitos", label: "Conceitos estratégicos" },
  { key: "composicao", label: "Composição" },
  // Desde 19/10/2026 a composição não é salva sozinha: a orquestração termina AGUARDANDO quem a
  // disparou rever os anúncios (editar, pedir revisão ao agente) e salvar. O "salvar" da rota de
  // composição é que fecha esta etapa — o processo do worker não fica esperando.
  { key: "revisao", label: "Revisão" },
];

export function semearEtapas() {
  return ETAPAS_ORQUESTRACAO.map((e) => ({
    ...e,
    status: "pending",
    note: null,
    started_at: null,
    ended_at: null,
  }));
}

// ---------------------------------------------------------------------------------------------
// A orquestração que parou nos conceitos continua pela TELA (rota `/conceitos/confirmar`). Estes
// são os patches da linha dela em cada passo — puros, para a rota só gravar.
// ---------------------------------------------------------------------------------------------

function comEtapa(etapas, key, mudanca) {
  return (Array.isArray(etapas) ? etapas : []).map((e) => (e.key === key ? { ...e, ...mudanca } : e));
}

/** Quem disparou aprovou os conceitos: a etapa fecha e a composição começa a ser escrita. */
export function orquestracaoAoConfirmar(orq, agora = new Date().toISOString()) {
  let etapas = comEtapa(orq.etapas, "conceitos", { status: "done", note: "aprovados por quem disparou", ended_at: agora });
  etapas = comEtapa(etapas, "composicao", { status: "running", note: "o Composer está escrevendo", started_at: agora, ended_at: null });
  return { status: "running", error: null, etapas };
}

/** Os anúncios ficaram prontos: a orquestração espera a revisão, como sempre esperou. */
export function orquestracaoAoTerminar(orq, { anuncios }, agora = new Date().toISOString()) {
  let etapas = comEtapa(orq.etapas, "composicao", { status: "done", note: `${anuncios} anúncio(s)`, ended_at: agora });
  etapas = comEtapa(etapas, "revisao", {
    status: "aguardando",
    note: "aguardando a revisão e o salvar de quem disparou",
    started_at: agora,
    ended_at: null,
  });
  return { status: "revisao", error: null, etapas };
}

/** A composição falhou, foi cancelada ou descartada: a orquestração fecha com o motivo. */
export function orquestracaoAoFalhar(orq, motivo, key, agora = new Date().toISOString()) {
  return {
    status: "error",
    error: String(motivo).slice(0, 500),
    etapas: comEtapa(orq.etapas, key, { status: "error", note: String(motivo).slice(0, 300), ended_at: agora }),
  };
}

/** Quantas análises candidatas o orquestrador lê por inteiro, e quantos relatórios. */
const MAX_ANALISES_CANDIDATAS = 5;
const MAX_RELATORIOS_CANDIDATOS = 6;
const MAX_DOCUMENTOS_CANDIDATOS = 40;

const CAMPOS_SOMA = [
  "investimento",
  "leadsTrafego",
  "leadsCRM",
  "consultasAgendadas",
  "faturamentoBruto",
];

/**
 * Os números de UM cliente dentro do mapa de `agregar`, somando as chaves candidatas dele.
 *
 * Um cliente pode aparecer no CRM por uma chave e nos anúncios por outra (nome com e sem a
 * clínica). `null` quando nenhuma chave casou: "não temos o dado" não pode virar uma linha de zeros.
 */
export function numerosDoCliente(mapa, chaves, fontes = {}) {
  const linhas = [...new Set(chaves)].map((k) => mapa?.get(k)).filter(Boolean);
  if (!linhas.length) return null;
  const out = {};
  for (const campo of CAMPOS_SOMA) {
    out[campo] = linhas.reduce((s, l) => s + (Number(l[campo]) || 0), 0);
  }
  out.roas = out.investimento > 0 ? out.faturamentoBruto / out.investimento : null;
  // Fonte que voltou vazia para a carteira inteira é leitura que falhou, não zero: os campos dela
  // viram ausentes (travessão no prompt e na tela). Um orquestrador que lê "investimento R$ 0,00"
  // conclui que o cliente parou de anunciar.
  if (fontes.ads === false) Object.assign(out, { investimento: null, leadsTrafego: null, roas: null });
  if (fontes.crm === false) {
    Object.assign(out, { leadsCRM: null, consultasAgendadas: null, faturamentoBruto: null, roas: null });
  }
  return out;
}

/** Candidatas da Biblioteca: as do segmento do cliente primeiro, depois as mais recentes. */
export function ordenarCandidatas(entradas, especialidades) {
  const alvo = new Set((especialidades || []).map((e) => String(e).toLowerCase()));
  const casa = (e) => (e.especialidades || []).some((x) => alvo.has(String(x).toLowerCase()));
  return [...entradas].sort(
    (a, b) =>
      Number(casa(b)) - Number(casa(a)) || String(b.criado_em).localeCompare(String(a.criado_em))
  );
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A orquestração foi cancelada por quem a disparou.
 *
 * Erro próprio porque é o ÚNICO que atravessa os "falhou, mas segue" deste arquivo: uma mineração
 * que falha continua para a composição; uma orquestração cancelada não continua para lugar nenhum.
 */
export class OrquestracaoCancelada extends Error {
  constructor() {
    super("Cancelada por quem disparou.");
    this.name = "OrquestracaoCancelada";
  }
}

/**
 * Conduz UMA orquestração, sobre a linha `running` que a rota já criou.
 *
 * @param {object} p
 * @param {string} p.id
 * @param {string} p.cliente        o `padrao` do cliente
 * @param {string} [p.pedido]       direção opcional de quem disparou
 * @param {string} p.userId         dono da mineração e da composição que nascerem daqui
 * @param {string|null} p.userName
 * @param {object} p.settingsDaBusca  filtros da mineração autônoma, já normalizados pela rota
 * @param {string} p.metaProvider
 * @param {number} [p.pausaMs]      intervalo da espera pela fila de análise (os testes zeram)
 * @param {boolean} [p.pularRevisao]  salva a composição direto, sem esperar revisão humana. Existe
 *                                  para o futuro: a tela mostra a chave, desligada e travada.
 * @param {(compositionId: string) => void} [p.onComposicao]  chamada quando a composição nasce,
 *                                  para quem disparou poder cancelá-la pelo id dela
 * @param {AbortSignal} [p.signal]  cancelamento: mata a chamada de agente em curso e para na
 *                                  próxima fronteira entre etapas. A análise de anúncios em curso é
 *                                  cancelada pela rota (`cancelAnalysis`), que conhece a run.
 */
export async function runOrquestracao({
  id,
  cliente,
  pedido = "",
  userId,
  userName = null,
  settingsDaBusca,
  metaProvider,
  pausaMs = 15000,
  signal = undefined,
  onComposicao = () => {},
  pularRevisao = false,
  log = () => {},
}) {
  const say = (m) => log(`[orquestração ${cliente}] ${m}`);
  const checar = () => {
    if (signal?.aborted) throw new OrquestracaoCancelada();
  };
  const etapas = semearEtapas();
  const perguntas = [];
  // O que a rodada custou, contado enquanto acontece: créditos de busca (a única coisa aqui que é
  // dinheiro por unidade), chamadas de agente e peças que passaram por download e transcrição.
  // Vai dentro de `decisoes` — é a coluna jsonb que a tela já lê, e evita uma migração só para isto.
  const custo = { creditos: 0, buscas: 0, chamadas_agente: 0, pecas: 0, anuncios: 0 };
  let decisoes = null;
  const agora = () => new Date().toISOString();
  const gravar = (extra = {}) =>
    patchOrquestracao(id, {
      etapas,
      perguntas,
      ...(decisoes ? { decisoes: { ...decisoes, custo: { ...custo } } } : {}),
      ...extra,
    });

  const etapa = (key) => etapas.find((e) => e.key === key);
  const iniciar = async (key, note = null) => {
    Object.assign(etapa(key), { status: "running", note, started_at: agora(), ended_at: null });
    await gravar();
  };
  const anotar = async (key, note) => {
    etapa(key).note = note;
    await gravar();
  };
  const fechar = async (key, status, note, extra = {}) => {
    Object.assign(etapa(key), { status, ended_at: agora(), ...(note === undefined ? {} : { note }) });
    await gravar(extra);
  };

  /** Uma pergunta a um bot, com o registro do que foi perguntado e do que voltou. */
  const perguntarA = async ({ para, agentId, assunto, content, timeoutMs, sessao }) => {
    const registro = { para, assunto, pergunta: content.slice(0, 2000), resposta: null, erro: null, em: agora() };
    perguntas.push(registro);
    custo.chamadas_agente += 1;
    try {
      const { finalText } = await runAgentCli({
        agentId,
        content,
        // Sessão nova por pergunta: sessão viva reaproveitada faz o Gateway abortar o turno.
        sessionId: `orq-${id.slice(0, 8)}-${sessao}-${Date.now().toString(36)}`.slice(0, 64),
        timeoutMs,
        signal,
        log: say,
      });
      registro.resposta = String(finalText || "").slice(0, 2000);
      return finalText;
    } catch (err) {
      registro.erro = String(err?.message || err).slice(0, 500);
      throw err;
    } finally {
      await gravar().catch(() => {});
    }
  };

  // ---- 1. números ---------------------------------------------------------------------------
  await iniciar("numeros", "lendo as duas semanas fechadas");
  let fichas;
  let numeros;
  try {
    const d = await coletarComMetricas();
    fichas = d;
    const c = d.clientes.find((x) => x.padrao === cliente);
    const atual = c ? numerosDoCliente(d.atual, c.chaves, d.fontes) : null;
    numeros = atual
      ? { semana: d.semana, atual, anterior: numerosDoCliente(d.anterior, c.chaves, d.fontes) }
      : { motivo: "o cliente não aparece no CRM nem nas contas de anúncio nessas semanas" };
  } catch (err) {
    // CRM ou anúncios fora do ar não impedem a composição: o plano sai pelos relatórios, e o
    // diagnóstico diz que não havia número.
    numeros = { motivo: String(err?.message || err).slice(0, 300) };
    fichas = await coletarFichas();
  }
  const ficha = fichas.clientes.find((c) => c.padrao === cliente);
  if (!ficha) throw new Error(`Cliente "${cliente}" não está na lista de ativos da planilha.`);
  const especialidades = ficha.chaves.map((k) => fichas.espPor.get(k)).find((v) => v?.length) || [];
  const fichaDoPrompt = {
    nome: ficha.nome,
    especialidades,
    plano: ficha.plano,
    squad: ficha.squad,
    mesesDeCasa: mesesDeCasa(ficha.desde),
  };
  await fechar(
    "numeros",
    numeros.atual ? "done" : "skipped",
    numeros.atual ? `semana de ${numeros.semana.de} a ${numeros.semana.ate}` : `sem números: ${numeros.motivo}`,
    {
      nome_exibicao: ficha.nome || null,
      metricas: numeros.atual ? { atual: numeros.atual, anterior: numeros.anterior } : {},
      semana_de: numeros.semana?.de ?? null,
      semana_ate: numeros.semana?.ate ?? null,
    }
  );

  // ---- 2. plano -----------------------------------------------------------------------------
  checar();
  await iniciar("plano", "reunindo relatórios, documentos e análises");
  const [brief, listaRelatorios, paginas, biblioteca] = await Promise.all([
    getBrief(cliente).catch(() => null),
    listReports({ cliente }).catch(() => []),
    listClientDocPages(cliente).catch(() => []),
    listLibrary({}).catch(() => []),
  ]);

  // Sem Estudo de Copy não há Conceito Estratégico — e sem conceito não há composição. Conferido
  // AQUI, antes do plano e da mineração, para não gastar crédito de busca numa orquestração que não
  // vai poder compor. O mais recente com corpo lido entra sempre, decida o plano o que decidir.
  //
  // O Estudo pode ser uma página de corpo vazio com o texto em subpáginas (o do Dr. Otavio é assim):
  // vale a página de CIMA — a que não tem outra página de Estudo acima dela —, desde que ela ou uma
  // subpágina tenha texto, ou ainda não tenha sido lida (aí a leitura é feita ao compor).
  const ehDoEstudo = (p) => ehPaginaDeEstudo({ nome: p.nome, docNome: p.doc?.nome, caminho: p.caminho });
  const doEstudo = paginas.filter((p) => ehDoEstudo(p) && !p.doc?.arquivado);
  const idsDoEstudo = new Set(doEstudo.map((p) => String(p.page_id)));
  const temTexto = (p) => !p.conteudo_lido_em || p.conteudo_chars > 0;
  const estudo =
    doEstudo.find(
      (p) =>
        !(p.pagina_pai_id && idsDoEstudo.has(String(p.pagina_pai_id))) &&
        [p, ...subpaginasDe(p.page_id, paginas)].some(temTexto)
    ) || null;
  if (!estudo) {
    throw new Error(
      "O cliente não tem Estudo de Copy legível no ClickUp, e sem ele não há Conceitos Estratégicos. " +
        "Crie no ClickUp um documento cujo nome comece com “Estudo de Copy”."
    );
  }

  // O Resumo Estratégico (Central de Copy) também entra sempre, desde 26/10/2026 — obrigatório como
  // na tela. Mesma regra de "página de cima" do Estudo: escolher a página traz as subpáginas.
  const ehDoResumo = (p) => ehPaginaDeResumo({ nome: p.nome, caminho: p.caminho });
  const doResumo = paginas.filter((p) => ehDoResumo(p) && !p.doc?.arquivado);
  const idsDoResumo = new Set(doResumo.map((p) => String(p.page_id)));
  const resumoEstrategico =
    doResumo.find(
      (p) =>
        !(p.pagina_pai_id && idsDoResumo.has(String(p.pagina_pai_id))) &&
        [p, ...subpaginasDe(p.page_id, paginas)].some(temTexto)
    ) || null;
  if (!resumoEstrategico) {
    throw new Error(
      "O cliente não tem Resumo Estratégico legível no ClickUp, e ele é obrigatório para compor. " +
        "Crie na Central de Copy do cliente uma página cujo nome comece com “Resumo Estratégico”."
    );
  }

  const relatorios = (
    await Promise.all(
      listaRelatorios
        .filter((r) => r.status === "ok")
        .slice(0, MAX_RELATORIOS_CANDIDATOS)
        .map((r) => getReport(r.id).catch(() => null))
    )
  ).filter((r) => r?.relatorio_md);

  // Só página com corpo lido: documento sem conteúdo entra no Composer como título, e escolher por
  // conta própria um insumo que não diz nada é ocupar espaço dos outros.
  const documentos = paginas
    .filter((p) => p.conteudo_lido_em && p.conteudo_chars && !p.doc?.arquivado)
    .slice(0, MAX_DOCUMENTOS_CANDIDATOS)
    .map((p) => ({
      id: p.page_id,
      nome: p.nome,
      local: p.doc?.local || p.caminho || null,
      tipo: p.tipo,
      chars: p.conteudo_chars,
    }));

  const analises = (
    await Promise.all(
      ordenarCandidatas(biblioteca, especialidades)
        .slice(0, MAX_ANALISES_CANDIDATAS)
        .map((e) => getLibraryEntry(e.id).catch(() => null))
    )
  )
    .filter((e) => e?.analysis_md)
    .map((e) => ({ ...e, adCount: Array.isArray(e.ads) ? e.ads.length : null }));

  await anotar("plano", "perguntando ao orquestrador");
  const respostaPlano = await perguntarA({
    para: "orquestrador",
    agentId: ORQUESTRADOR_AGENT_ID,
    assunto: "diagnóstico e plano",
    content: buildPlanoPrompt({
      ficha: fichaDoPrompt,
      brief: brief?.brief_md ? brief : null,
      numeros,
      relatorios,
      documentos,
      analises,
      pedido,
      maxChars: MAX_ORQUESTRADOR_CHARS,
    }),
    timeoutMs: ORQUESTRADOR_RUN_TIMEOUT_MS,
    sessao: "plano",
  });
  const plano = parsePlanoReply(respostaPlano, { relatorios, documentos, analises });

  const tituloDoRelatorio = (rid) => {
    const r = relatorios.find((x) => String(x.id) === rid);
    return r?.titulo || r?.periodo_label || null;
  };
  decisoes = {
    abordagem: plano.abordagem,
    contexto_operacional: plano.usarContexto && Boolean(brief?.brief_md),
    analise: { id: plano.analise.id, titulo: null, motivo: plano.analise.motivo, nova: false },
    mineracao: plano.mineracao,
    relatorios: plano.relatorios.map((r) => ({ ...r, titulo: tituloDoRelatorio(r.id) })),
    documentos: plano.documentos.map((d) => {
      const doc = documentos.find((x) => String(x.id) === d.id);
      return { ...d, titulo: doc?.nome ?? null, local: doc?.local ?? null };
    }),
    pedido_ao_composer: null,
    criativos: [],
  };
  if (!decisoes.documentos.some((d) => String(d.id) === String(resumoEstrategico.page_id))) {
    decisoes.documentos.unshift({
      id: resumoEstrategico.page_id,
      motivo: "Resumo Estratégico: obrigatório em toda composição (entra sempre)",
      titulo: resumoEstrategico.nome,
      local: resumoEstrategico.doc?.local || null,
    });
  }
  if (!decisoes.documentos.some((d) => String(d.id) === String(estudo.page_id))) {
    decisoes.documentos.unshift({
      id: estudo.page_id,
      motivo: "Estudo de Copy: a base dos Conceitos Estratégicos (entra sempre)",
      titulo: estudo.nome,
      local: estudo.doc?.local || null,
    });
  }
  await fechar(
    "plano",
    "done",
    plano.semBlocoJson
      ? "o orquestrador respondeu sem o bloco do plano — segue só com o Contexto Operacional"
      : plano.abordagem,
    { diagnostico_md: plano.diagnosticoMd }
  );

  // ---- 3. análise ---------------------------------------------------------------------------
  checar();
  let analise = plano.analise.id ? analises.find((a) => String(a.id) === plano.analise.id) : null;
  if (analise) {
    decisoes.analise.titulo = analise.titulo || analise.tema || null;
    await iniciar("analise");
    await fechar("analise", "done", `da Biblioteca: ${decisoes.analise.titulo}`, {
      library_entry_id: analise.id,
    });
  } else if (plano.mineracao) {
    await iniciar("analise", `minerando "${plano.mineracao.nicho}"`);
    try {
      const nova = await minerar({
        mineracao: plano.mineracao,
        especialidade: especialidades[0] || plano.mineracao.nicho,
        nomeCliente: ficha.nome,
      });
      analise = nova.entrada;
      Object.assign(decisoes.analise, {
        id: analise.id,
        titulo: analise.titulo || analise.tema,
        nova: true,
      });
      decisoes.mineracao = { ...plano.mineracao, termo: nova.termo, pecas: nova.pecas };
      await fechar("analise", "done", `nova: "${nova.termo}", ${nova.pecas} peça(s) analisada(s)`, {
        library_entry_id: analise.id,
      });
    } catch (err) {
      // Cancelada no meio da mineração: o erro que chegou aqui é o efeito (a análise abortada), e
      // tratá-lo como falha comum levaria a orquestração a compor assim mesmo.
      checar();
      // A mineração falhar não cancela a composição: ela sai sem análise, e a etapa diz por quê.
      const msg = String(err?.message || err).slice(0, 500);
      say(`mineração falhou: ${msg}`);
      await fechar("analise", "error", `${msg} — a composição segue sem análise`);
    }
  } else {
    await fechar(
      "analise",
      "skipped",
      plano.analise.motivo || "o orquestrador não pediu análise de concorrentes"
    );
  }

  // ---- 4. pedido ao Composer ------------------------------------------------------------------
  checar();
  await iniciar("pedido", "perguntando ao orquestrador");
  let pedidoAoComposer = null;
  try {
    const resposta = await perguntarA({
      para: "orquestrador",
      agentId: ORQUESTRADOR_AGENT_ID,
      assunto: "pedido ao Composer",
      content: buildBriefingPrompt({
        ficha: fichaDoPrompt,
        diagnosticoMd: plano.diagnosticoMd,
        abordagem: plano.abordagem,
        analise,
        relatorios: decisoes.relatorios,
        documentos: decisoes.documentos,
        pedido,
        maxChars: MAX_ORQUESTRADOR_CHARS,
      }),
      timeoutMs: ORQUESTRADOR_RUN_TIMEOUT_MS,
      sessao: "pedido",
    });
    pedidoAoComposer = parseBriefingReply(resposta, { maxChars: MAX_EXTRA_PROMPT_CHARS }).pedido;
  } catch (err) {
    checar();
    say(`pedido ao Composer falhou: ${err?.message || err}`);
  }
  // Sem pedido escrito, o Composer recebe a abordagem: é menos do que se queria, mas é a decisão
  // que o orquestrador já tomou — e é melhor do que compor sem direção nenhuma.
  const instrucao = (pedidoAoComposer || plano.abordagem || String(pedido || "").trim() || "").slice(
    0,
    MAX_EXTRA_PROMPT_CHARS
  );
  decisoes.pedido_ao_composer = instrucao || null;
  await fechar(
    "pedido",
    pedidoAoComposer ? "done" : "error",
    pedidoAoComposer ? null : "o orquestrador não devolveu o pedido — o Composer recebe só a abordagem"
  );

  // ---- 5. conceitos ---------------------------------------------------------------------------
  checar();
  await iniciar("conceitos", "escolhendo as análises de criativo");
  // As análises de criativo de concorrentes da especialidade do cliente, as favoritas de quem
  // disparou primeiro e depois as mais recentes, até uma por anúncio possível: cada uma é um
  // formato que o Composer pode usar num conceito.
  const [candidatosCriativos, favoritos] = await Promise.all([
    listCriativos({ especialidades, origem: "mineracao" }).catch(() => []),
    listFavoritosCriativos(userId).catch(() => new Set()),
  ]);
  const criativos = candidatosCriativos
    .filter((c) => c.status === "done")
    .sort((x, y) => Number(favoritos.has(y.id)) - Number(favoritos.has(x.id)))
    .slice(0, MAX_ANUNCIOS);
  decisoes.criativos = criativos.map((c) => ({ id: c.id, titulo: c.titulo || c.ad?.page_name || null }));

  const entradas = [
    ...(decisoes.contexto_operacional
      ? [{ tipo: "brief", id: null, titulo: "Contexto Operacional", local: null }]
      : []),
    ...decisoes.relatorios.map((r) => ({ tipo: "relatorio", id: r.id, titulo: r.titulo, local: null })),
    ...decisoes.documentos.map((d) => ({ tipo: "documento", id: d.id, titulo: d.titulo, local: d.local })),
    ...decisoes.criativos.map((c) => ({ tipo: "criativo", id: c.id, titulo: c.titulo, local: null })),
  ];
  // A composição é uma linha comum de `marketing_compositions`: aparece em Composições Salvas como
  // qualquer outra, e a tela do orquestrador a acompanha pelo mesmo endpoint de polling.
  const composicao = await insertComposition({
    cliente,
    library_entry_id: analise?.id ?? null,
    entradas,
    extra_prompt: instrucao || null,
    status: "conceitos",
    conceitos: [],
    criado_por: userId,
    agent_id: COMPOSER_AGENT_ID,
  });
  await gravar({ composition_id: composicao.id });
  onComposicao(composicao.id);

  const falharComposicao = async (err, chave) => {
    const cancelada = Boolean(signal?.aborted);
    const msg = cancelada ? "Cancelada." : String(err?.message || err).slice(0, 500);
    // Cancelada depois do primeiro anúncio, a composição já se fechou com os prontos dentro
    // (composer.js); gravar "erro" por cima apagaria da tela o que ficou pronto.
    const atual = await getComposition(composicao.id).catch(() => null);
    const jaFechada = cancelada && atual && atual.status !== "running" && atual.status !== "conceitos";
    if (!jaFechada) {
      await patchComposition(composicao.id, { status: "error", error: msg }).catch(() => {});
    }
    await fechar(chave, "error", msg).catch(() => {});
    throw cancelada ? new OrquestracaoCancelada() : err;
  };

  await anotar(
    "conceitos",
    criativos.length
      ? `sugerindo conceitos com ${criativos.length} análise(s) de criativo`
      : `nenhuma análise de criativo de ${especialidades.join(", ") || "especialidade cadastrada"}`
  );
  let slots;
  try {
    await rodarConceitos(composicao, { log, signal });
    custo.chamadas_agente += 1;
    if (!pularRevisao) {
      // A vez é de uma pessoa: a orquestração espera em `conceitos`, sem spinner, e quem aprova na
      // tela é que a continua (rota `/conceitos/confirmar`, que fecha esta etapa e abre a próxima).
      Object.assign(etapa("conceitos"), {
        status: "aguardando",
        note: "aguardando quem disparou aprovar os conceitos",
      });
      await gravar({ status: "conceitos", error: null });
      say(`composição ${composicao.id}: conceitos sugeridos, aguardando aprovação`);
      return { id, compositionId: composicao.id, libraryEntryId: analise?.id ?? null, aguardandoConceitos: true };
    }
    slots = await conduzirSozinho({
      id: composicao.id,
      deps: depsDeConceitos(composicao, { log, signal }),
      esperar: () => esperarFila(composicao.id),
    });
  } catch (err) {
    await falharComposicao(err, "conceitos");
  }
  await fechar("conceitos", "done", `${slots.length} conceito(s) aprovado(s) sem revisão`);

  // ---- 6. composição --------------------------------------------------------------------------
  checar();
  await iniciar("composicao", "o Composer está escrevendo");
  const comConceitos = await getComposition(composicao.id);
  await patchComposition(composicao.id, { status: "running", error: null });
  try {
    const r = await runComposition({
      id: composicao.id,
      cliente,
      libraryEntryId: analise?.id ?? null,
      entradas,
      extraPrompt: instrucao,
      conceitos: slots,
      catalogo: comConceitos?.catalogo_copy,
      signal,
      log,
    });
    // Uma chamada do Composer por anúncio (ver composer.js).
    custo.anuncios = r.anuncios;
    custo.chamadas_agente += r.anuncios;
    await fechar("composicao", "done", `${r.anuncios} anúncio(s)`);
  } catch (err) {
    await falharComposicao(err, "composicao");
  }

  // ---- 7. revisão ----------------------------------------------------------------------------
  // Só se chega aqui com "pular revisão" (sem ele, a orquestração parou nos conceitos).
  await patchComposition(composicao.id, { status: "ok" });
  await iniciar("revisao");
  await fechar("revisao", "skipped", "pulada: a composição foi salva sem revisão", {
    status: "ok",
    error: null,
  });
  say(`ok: composição ${composicao.id} salva sem revisão`);
  return { id, compositionId: composicao.id, libraryEntryId: analise?.id ?? null };

  // ---------------------------------------------------------------------------------------------

  /**
   * Uma análise nova, sem ninguém no grid: pesquisa -> busca -> pergunta -> análise -> Biblioteca.
   * Lança com o motivo em português; quem chama registra na etapa e segue sem análise.
   */
  async function minerar({ mineracao, especialidade, nomeCliente }) {
    // a. palavras-chave: pergunta ao agente de pesquisa. Falhar aqui não impede a busca — o nicho
    // que o orquestrador escreveu serve de palavra-chave.
    let termos = [];
    try {
      const resposta = await perguntarA({
        para: "pesquisa",
        agentId: PESQUISA_AGENT_ID,
        assunto: "palavras-chave do nicho",
        content: buildPesquisaPrompt({ nicho: mineracao.nicho, contexto: mineracao.contexto || "" }),
        timeoutMs: PESQUISA_RUN_TIMEOUT_MS,
        sessao: "pesquisa",
      });
      termos = parsePesquisaReply(resposta).termos;
    } catch (err) {
      say(`agente de pesquisa falhou: ${err?.message || err}`);
    }
    const fila = ordenarTermos(termos, mineracao.nicho).slice(0, ORQ_MAX_BUSCAS);

    // b. busca: uma palavra-chave por vez, até uma trazer anúncio. Cada tentativa tem o orçamento de
    // créditos de uma busca normal; `ORQ_MAX_BUSCAS` é o teto de tentativas.
    let run = null;
    let ads = [];
    let ultimoErro = null;
    for (const termo of fila) {
      checar();
      await anotar("analise", `buscando anúncios de "${termo}"`);
      const criada = await insertRun({
        userId,
        tema: termo,
        sources: ["meta"],
        settings: settingsDaBusca,
        extraPrompt: mineracao.foco || null,
        metaProvider,
      });
      await searchBlock({ runId: criada.id, userId, first: true, log });
      const lida = await getRun(criada.id);
      // Busca que não trouxe anúncio também gastou: o crédito é por página pedida, não por achado.
      custo.buscas += 1;
      custo.creditos += Number(lida?.search_state?.creditsUsed) || 0;
      const lista = lida?.status === "awaiting_selection" ? await listAds(criada.id) : [];
      if (lista.length) {
        run = lida;
        ads = lista;
        break;
      }
      ultimoErro = lida?.error || `nenhum anúncio para "${termo}"`;
    }
    if (!run) throw new Error(`A busca não trouxe anúncios (${ultimoErro || "sem palavra-chave"}).`);
    await gravar({ run_id: run.id });

    // c. seleção: a pergunta do orquestrador vai ao agente que lê o grid. Sem resposta, vale só a
    // longevidade — pior, mas ainda é o critério que a Biblioteca da Meta sustenta.
    checar();
    let respostas = {};
    if (mineracao.pergunta) {
      await anotar("analise", `perguntando ao grid: “${mineracao.pergunta}”`);
      const registro = {
        para: "pergunta ao grid",
        assunto: "quais peças analisar",
        pergunta: mineracao.pergunta,
        resposta: null,
        erro: null,
        em: agora(),
      };
      perguntas.push(registro);
      try {
        const q = await runPergunta({
          id: Date.now().toString(36),
          pergunta: mineracao.pergunta,
          ads: ads.slice(0, MAX_PERGUNTA_ADS),
          pedidoEm: agora(),
          log: say,
          perguntar: async (content, lote) => {
            custo.chamadas_agente += 1;
            const { finalText } = await runAgentCli({
              agentId: PERGUNTA_AGENT_ID,
              content,
              sessionId: `pergunta-${run.id.slice(0, 8)}-orq-${lote}-${Date.now().toString(36)}`,
              timeoutMs: PERGUNTA_RUN_TIMEOUT_MS,
              signal,
              log: say,
            });
            return finalText;
          },
          // Gravada na run como qualquer pergunta: quem abrir a mineração vê os vereditos no grid.
          gravar: (question) => patchRun(run.id, { question }),
        });
        respostas = q.respostas || {};
        const vereditos = Object.values(respostas).map((r) => r.veredito);
        registro.resposta =
          `${vereditos.filter((v) => v === "atende").length} atendem, ` +
          `${vereditos.filter((v) => v === "parcial").length} em parte, de ${ads.length} peça(s)`;
        if (q.status === "error") registro.erro = q.error;
      } catch (err) {
        registro.erro = String(err?.message || err).slice(0, 300);
      }
      await gravar();
    }
    checar();
    const escolhidas = selecionarPecas(ads, respostas, { max: ORQ_MAX_SELECIONADOS });
    const marcadas = await setSelection(run.id, escolhidas);
    if (!marcadas) throw new Error("Nenhuma peça pôde ser selecionada para a análise.");

    // d. análise: a fila é a mesma da tela. Ocupada, espera — a pessoa não está olhando, e esperar
    // dez minutos custa menos do que entregar a composição sem a análise que se acabou de minerar.
    const limite = Date.now() + ORQ_ESPERA_ANALISE_MS;
    while (!hasAnalysisCapacity()) {
      checar();
      if (Date.now() >= limite) throw new Error("A fila de análise não liberou a tempo.");
      await anotar("analise", "aguardando a fila de análise liberar");
      await espera(pausaMs);
    }
    await anotar("analise", `transcrevendo e analisando ${marcadas} peça(s)`);
    await patchRun(run.id, { status: "running", error: null, cancel_requested: false });
    custo.pecas = marcadas;
    custo.chamadas_agente += 1;
    await analyzeSelected({ runId: run.id, userId, log });
    const analisada = await getRun(run.id);
    checar();
    if (analisada?.status !== "done" || !analisada.analysis_md) {
      throw new Error(analisada?.error || "A análise não terminou.");
    }
    perguntas.push({
      para: "análise de anúncios",
      assunto: "o que o nicho está fazendo",
      pergunta: mineracao.foco || `Análise de "${run.tema}"`,
      resposta: String(analisada.analysis_md).slice(0, 2000),
      erro: null,
      em: agora(),
    });

    // e. Biblioteca: salva em nome de quem disparou, com o título dizendo de onde veio — a análise
    // fica para a equipe, e ninguém a confunde com uma que alguém curou à mão.
    const entrada = await salvarRunNaBiblioteca({
      run: analisada,
      especialidade,
      titulo: `${mineracao.nicho} — orquestrador (${nomeCliente})`.slice(0, 200),
      userId,
      name: userName,
    });
    return { entrada, termo: run.tema, pecas: marcadas };
  }
}
