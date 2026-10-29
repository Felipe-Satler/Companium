/**
 * Ad Composer — de análise a ideia de anúncio.
 *
 * Junta o que vive em abas separadas e só se encontrava na cabeça do estrategista: a ANÁLISE da
 * Biblioteca (o que funciona neste nicho), o CONTEXTO OPERACIONAL do cliente (o que está
 * acontecendo com ele), os RELATÓRIOS de período e os DOCUMENTOS do ClickUp. Manda tudo para um
 * agente dedicado junto com a spec do formato de destino, e grava a ideia campo a campo.
 *
 * ## Todas as fontes são OPCIONAIS, e é de propósito
 *
 * Compor sem análise é um pedido legítimo ("escreve algo para este cliente"). O resumo pode não
 * existir ainda; o cliente pode não ter relatório nem documento. Nenhum desses casos derruba a
 * composição — mas TODOS ficam registrados em `fontes`, e o prompt diz ao agente o que ele NÃO tem,
 * para ele não preencher o buraco com invenção. A tela mostra `fontes` junto da ideia: saber com o
 * que ela foi feita é parte de poder confiar nela.
 *
 * ## Os números saem daqui em 02/10/2026
 *
 * Havia um insumo "números da semana fechada", lido do CRM e dos anúncios. Ele saiu: quem leva
 * número à composição é o **Relatório**, escolhido pela pessoa, com o período que ela quis e com as
 * metas e correções manuais que a tela aplica. Uma semana fixa que ninguém pediu dizia menos e
 * custava uma leitura de CRM por composição.
 *
 * ## Uma composição são de 1 a 8 anúncios (12/10/2026)
 *
 * Quantos, e para que uso é cada um, quem decide é o agente, lendo o pedido. A PRIMEIRA chamada
 * devolve o conjunto inteiro e o primeiro anúncio; as seguintes escrevem um anúncio cada, em ordem.
 * A linha é regravada a cada anúncio pronto, e é isso que a tela lê para dizer "3 de 5".
 *
 * Em sequência, e não em paralelo, pelo mesmo motivo dos lotes do "Perguntar ao grid": é o que já
 * roda em produção contra o OpenClaw, e duas sessões simultâneas do mesmo agente nunca foram
 * verificadas ao vivo.
 */

import { createHash } from "node:crypto";
import { runAgentCli } from "./agent-cli.js";
import {
  buildAnuncioPrompt,
  buildComposerPrompt,
  buildRevisaoPrompt,
  parseComposerReply,
  parsePlano,
} from "./composer-prompt.js";
import { avisosDoConjunto, comVersaoAnterior, resumoDoPlano } from "./composer-conjunto.js";
import {
  anguloParaLista,
  avisosDoConceito,
  blocoDoConceito,
  descreverConjuntoDeConceitos,
} from "./conceitos.js";
import { ehEstudoDeCopy, ehPaginaDeEstudo } from "../../shared/estudo-copy.js";
import { fecharComposicao } from "./orfas.js";
import { COMPOSER_AGENT_ID, COMPOSER_RUN_TIMEOUT_MS, MAX_COMPOSER_CHARS } from "./config.js";
import { coletarFichas, mesesDeCasa } from "./briefs.js";
import { conteudoDoDocumento } from "./clickup.js";
import {
  getBrief,
  getComposition,
  getCriativo,
  getLibraryEntry,
  getReport,
  listClientDocPages,
  patchComposition,
} from "./db.js";

/** O motivo gravado numa composição cancelada. A tela o reconhece pelo começo ("Cancelada"). */
export const MOTIVO_CANCELADA = "Cancelada por quem pediu.";

function sessionId(cliente, indice = 0) {
  const short = createHash("sha256")
    .update(`${cliente}:${indice}:${Date.now()}`)
    .digest("hex")
    .slice(0, 16);
  // Mesma receita do spy e dos resumos: sessão nova por execução (sessão viva reaproveitada faz o
  // Gateway abortar o turno em andamento) e teto de 64 chars.
  return `compose-${short}`;
}


/**
 * Uma pergunta ao agente do Composer numa sessão nova. É o que a etapa de Conceitos Estratégicos usa
 * (`composer-conceitos.js`): a mesma receita de sessão e de timeout das chamadas de escrita.
 */
export async function perguntarAoComposer(content, { cliente, n = 0, signal, log = () => {} }) {
  const { finalText } = await runAgentCli({
    agentId: COMPOSER_AGENT_ID,
    content,
    sessionId: sessionId(`conceitos:${cliente}`, n),
    timeoutMs: COMPOSER_RUN_TIMEOUT_MS,
    signal,
    log,
  });
  return finalText;
}

/**
 * A ficha do cliente.
 *
 * **Só a ficha.** Até 02/10/2026 esta função lia também CRM e anúncios da semana fechada, para dar
 * ao agente "os números da semana" como contexto de tom. Esse insumo saiu: quem leva número à
 * composição agora é o **Relatório**, que a pessoa escolhe e que traz o período que ela quis, com
 * metas e correções manuais — em vez de uma semana fixa que ninguém pediu.
 *
 * A troca para `coletarFichas()` é o ganho silencioso: some do caminho da composição toda a leitura
 * de CRM e de anúncios, e com ela o `assertMetricasVivas`, que podia derrubar uma composição por
 * causa de um dado que ela não usava.
 */
async function contextoDoCliente(cliente) {
  const d = await coletarFichas();
  const ficha = d.clientes.find((c) => c.padrao === cliente);
  if (!ficha) {
    // Cliente fora da lista de ATIVOS não é erro de leitura: é pedido para um cliente que a
    // planilha não tem. Sem ficha não há a quem compor, e inventar o cliente seria pior.
    throw new Error(`Cliente "${cliente}" não está na lista de ativos da planilha.`);
  }
  const especialidades = ficha.chaves.map((k) => d.espPor.get(k)).find((v) => v?.length) || [];
  return {
    ficha: {
      nome: ficha.nome,
      especialidades,
      plano: ficha.plano,
      squad: ficha.squad,
      desde: ficha.desde,
      mesesDeCasa: mesesDeCasa(ficha.desde),
      temCRM: ficha.temCRM,
    },
  };
}

/**
 * O material de uma composição: a ficha, a análise, o resumo, os relatórios, os documentos e os
 * criativos que a pessoa escolheu, lidos de onde moram.
 *
 * Separado de `runComposition` porque a REVISÃO de um anúncio precisa do mesmo material — revisar
 * sem ele seria pedir ao agente que melhore uma peça sem saber de quem ela é. Relido a cada uso,
 * e não guardado na linha: é grande, e o documento pode ter mudado no ClickUp desde então.
 *
 * @returns {Promise<{ ctx: object, analise: object|null, material: object, fontes: object }>}
 */
export async function montarMaterial({ cliente, libraryEntryId = null, entradas = [], extraPrompt = "" }) {
  const ids = (tipo) =>
    (Array.isArray(entradas) ? entradas : [])
      .filter((e) => e?.tipo === tipo && e.id)
      .map((e) => String(e.id));
  const querTipo = (tipo) => (Array.isArray(entradas) ? entradas : []).some((e) => e?.tipo === tipo);

  // `entradas` vazio significa pedido antigo (ou o stub): mantém o comportamento de sempre levar o
  // resumo, em vez de compor sobre o vazio sem ninguém ter pedido isso. Um `tipo: "metricas"` vindo
  // de uma aba velha é ignorado em silêncio — o insumo não existe mais, e recusar o pedido por
  // causa dele puniria quem não recarregou a página.
  const semEntradas = !Array.isArray(entradas) || entradas.length === 0;
  const usaBrief = semEntradas || querTipo("brief");

  const ctx = await contextoDoCliente(cliente);

  // Insumo apagado entre o pedido e a execução não derruba nada: some da composição, e `fontes`
  // diz com o que ela foi feita de verdade.
  const analise = libraryEntryId ? await getLibraryEntry(libraryEntryId).catch(() => null) : null;
  const brief = usaBrief ? await getBrief(cliente).catch(() => null) : null;

  const relatorios = (
    await Promise.all(ids("relatorio").map((rid) => getReport(rid).catch(() => null)))
  ).filter((r) => r?.relatorio_md);

  // Análises de criativo (Mineração › Análises de Criativos): só as que terminaram. Uma que ainda
  // roda ou falhou não tem dissecação para dar, e entrar vazia faria o agente citar o que não leu.
  const criativos = (
    await Promise.all(
      ids("criativo").map(async (cid) => {
        const c = await getCriativo(cid).catch(() => null);
        // Os números (criativo interno) vêm do pedido: são do período que a pessoa olhava.
        const meta = (Array.isArray(entradas) ? entradas : []).find(
          (e) => e?.tipo === "criativo" && String(e.id) === cid
        );
        return c ? { ...c, numeros: meta?.numeros || null } : null;
      })
    )
  ).filter((c) => c?.status === "done" && (c.dissecacao || c.dissecacao_md));

  // Documento sem corpo entra assim mesmo: o prompt diz ao agente que ele só tem título e pasta.
  //
  // Os ids são de PÁGINA de Doc, e `conteudoDoDocumento` recebe o cliente para se recusar a
  // devolver o corpo de uma página de outro. É a guarda que importa justamente aqui: um id trocado
  // na seleção levaria o mapeamento estratégico de um cliente ao prompt do anúncio de outro, e
  // nenhuma revisão da peça pronta pegaria isso.
  // Qual dos documentos é o Estudo de Copy, pelo nome no BANCO (página, Doc ou página acima dela),
  // como a rota confere — o título das `entradas` veio do navegador. Sem a lista (banco fora), cai
  // para o título.
  const paginas = ids("documento").length ? await listClientDocPages(cliente).catch(() => null) : [];
  const paginaPorId = new Map((paginas || []).map((p) => [String(p.page_id), p]));
  // Uma página com subpáginas traz o conteúdo delas (`conteudoDoDocumento`). Subpágina escolhida
  // junto com uma página acima dela já veio com ela: entrar de novo seria o mesmo texto duas vezes.
  const pedidos = new Set(ids("documento"));
  const temAcimaPedida = (id) => {
    for (let p = paginaPorId.get(id), passos = 0; p?.pagina_pai_id && passos < 50; passos += 1) {
      if (pedidos.has(String(p.pagina_pai_id))) return true;
      p = paginaPorId.get(String(p.pagina_pai_id));
    }
    return false;
  };
  const docsPedidos = ids("documento").filter((id) => !temAcimaPedida(id));
  const documentos = docsPedidos.length
    ? await Promise.all(
        docsPedidos.map(async (docId) => {
          const meta = (Array.isArray(entradas) ? entradas : []).find(
            (e) => e?.tipo === "documento" && String(e.id) === docId
          );
          const pagina = paginaPorId.get(docId);
          const conteudo = await conteudoDoDocumento(docId, { cliente }).catch(() => null);
          return {
            page_id: docId,
            nome: meta?.titulo || pagina?.nome || docId,
            local: meta?.local || null,
            estudo: pagina
              ? ehPaginaDeEstudo({ nome: pagina.nome, docNome: pagina.doc?.nome, caminho: pagina.caminho })
              : ehEstudoDeCopy(meta?.titulo),
            conteudo_md: conteudo?.conteudo_md ?? null,
          };
        })
      )
    : [];

  const material = {
    ficha: ctx.ficha,
    analise,
    brief: brief?.brief_md ? brief : null,
    relatorios,
    documentos,
    criativos,
    extraPrompt,
    maxChars: MAX_COMPOSER_CHARS,
  };
  const fontes = {
    analise: Boolean(analise?.analysis_md),
    brief: Boolean(brief?.brief_md),
    relatorios: relatorios.length,
    documentos: documentos.length,
    documentos_sem_corpo: documentos.filter((d) => !d.conteudo_md).length,
    criativos: criativos.length,
  };
  return { ctx, analise, material, fontes };
}

/**
 * Escreve UMA composição, sobre a linha `running` que a rota já criou.
 *
 * A linha existe ANTES desta função rodar, de propósito: é ela que a tela faz polling. Criar a
 * linha aqui deixaria a UI sem nada para acompanhar entre o 202 e o fim da chamada do agente —
 * o mesmo bug de pipeline do commit `cd92c96`.
 */
export async function runComposition({
  id,
  cliente,
  libraryEntryId = null,
  entradas = [],
  extraPrompt = "",
  conceitos = null,
  catalogo = null,
  signal = undefined,
  log = () => {},
}) {
  const { ctx, analise, material, fontes } = await montarMaterial({
    cliente,
    libraryEntryId,
    entradas,
    extraPrompt,
  });
  if (Array.isArray(conceitos) && conceitos.length && catalogo) {
    return escreverComConceitos({ id, cliente, ctx, analise, material, fontes, conceitos, catalogo, signal, log });
  }
  const content = buildComposerPrompt(material);

  log(
    `[compose ${cliente}] via ${COMPOSER_AGENT_ID} (${content.length} chars; ` +
      `análise=${fontes.analise} resumo=${fontes.brief} ` +
      `relatórios=${fontes.relatorios} documentos=${fontes.documentos} criativos=${fontes.criativos}` +
      (fontes.documentos_sem_corpo ? ` (${fontes.documentos_sem_corpo} sem corpo)` : "") +
      ")"
  );
  const { finalText } = await runAgentCli({
    agentId: COMPOSER_AGENT_ID,
    content,
    sessionId: sessionId(cliente),
    timeoutMs: COMPOSER_RUN_TIMEOUT_MS,
    signal,
    log,
  });

  const { plano, descartados, cortados } = parsePlano(finalText);
  if (descartados || cortados) {
    log(
      `[compose ${cliente}] plano ajustado: ${descartados} sem formato do catálogo, ` +
        `${cortados} acima do teto`
    );
  }

  // Sem plano legível, a resposta é lida pelo contrato ANTERIOR (um anúncio, `formato` + `campos`):
  // é o que devolve um agente ainda não reaplicado no servidor, e também o que sobra quando o JSON
  // veio quebrado — aí a prosa continua valendo, como sempre valeu.
  const primeiro = parseComposerReply(finalText, { formatoFixo: plano[0]?.formato ?? null });
  const anuncios = plano.length
    ? plano.map((item, i) => ({
        formato: item.formato,
        angulo: item.angulo,
        formato_justificativa: item.justificativa,
        status: i === 0 ? "ok" : "pendente",
        // A prosa da primeira chamada fala do CONJUNTO e fica na linha (`composicao_md`), não aqui.
        composicao_md: null,
        composicao: i === 0 ? primeiro.composicao : null,
        avisos: i === 0 ? primeiro.avisos : [],
        error: null,
      }))
    : [
        {
          formato: primeiro.formato,
          angulo: null,
          formato_justificativa: primeiro.justificativa,
          status: "ok",
          composicao_md: null,
          composicao: primeiro.composicao,
          avisos: primeiro.avisos,
          error: null,
        },
      ];

  const gravar = (extra = {}) =>
    patchComposition(id, {
      anuncios,
      plano: resumoDoPlano(anuncios),
      avisos: avisosDoConjunto(anuncios),
      ...extra,
    });

  // A primeira gravação já leva o conjunto INTEIRO, com os que faltam como `pendente`: é a partir
  // daqui que a tela sabe quantos anúncios esperar.
  await gravar({
    ...colunasDoConjunto({ ctx, analise, fontes, anuncios }),
    composicao_md: primeiro.composicaoMd,
  });
  log(`[compose ${cliente}] conjunto de ${anuncios.length} anúncio(s); 1 pronto`);

  return escreverOsAnuncios({
    id,
    cliente,
    anuncios,
    gravar,
    inicio: 1,
    signal,
    log,
    escrever: async (i) => {
      const { finalText: texto } = await runAgentCli({
        agentId: COMPOSER_AGENT_ID,
        content: buildAnuncioPrompt({ ...material, plano, indice: i }),
        sessionId: sessionId(cliente, i),
        timeoutMs: COMPOSER_RUN_TIMEOUT_MS,
        signal,
        log,
      });
      const lido = parseComposerReply(texto, { formatoFixo: anuncios[i].formato });
      return { composicao_md: lido.composicaoMd || null, composicao: lido.composicao, avisos: lido.avisos };
    },
    fontes,
  });
}

/** As colunas que a primeira gravação de uma composição escreve, nos dois caminhos. */
function colunasDoConjunto({ ctx, analise, fontes, anuncios }) {
  return {
    nome_exibicao: ctx.ficha.nome || null,
    analise_titulo: analise ? analise.titulo || analise.tema || null : null,
    // As colunas de UM anúncio continuam sendo escritas com o primeiro: é o que um frontend em
    // cache durante o deploy sabe ler, e o que a listagem mostra em composição antiga.
    formato: anuncios[0].formato,
    formato_justificativa: anuncios[0].formato_justificativa,
    composicao: null,
    fontes,
    // Explícito, e não ausente: as colunas continuam na tabela guardando o que as composições
    // ANTIGAS tiveram, e gravar `{}`/null é o que distingue "esta composição não usou número" de
    // "ninguém escreveu nada aqui".
    metricas: {},
    semana_de: null,
    semana_ate: null,
    agent_id: COMPOSER_AGENT_ID,
  };
}

/**
 * O laço que escreve os anúncios, um por chamada, em ordem. Igual nos dois caminhos — o antigo (a
 * primeira chamada decide o conjunto e escreve o primeiro, então começa do segundo) e o dos
 * Conceitos Estratégicos (o conjunto já foi decidido e aprovado, então começa do primeiro).
 */
async function escreverOsAnuncios({ id, cliente, anuncios, gravar, inicio, escrever, signal, log, fontes }) {
  // Cancelada no meio: o que já está pronto FICA. A linha fecha aqui mesmo, com os prontos e os que
  // faltavam marcados — quem chama vê `signal.aborted` e não a sobrescreve.
  const pararSeCancelada = async () => {
    if (!signal?.aborted) return;
    await patchComposition(id, fecharComposicao(anuncios, MOTIVO_CANCELADA));
    throw new Error(MOTIVO_CANCELADA);
  };

  for (let i = inicio; i < anuncios.length; i += 1) {
    // Um abort NO MEIO de uma chamada cai no catch abaixo como falha daquele anúncio, e é esta
    // checagem, na volta seguinte, que encerra a composição.
    await pararSeCancelada();
    anuncios[i].status = "running";
    await gravar();
    try {
      Object.assign(anuncios[i], { status: "ok", ...(await escrever(i)) });
    } catch (err) {
      // Um anúncio que falha não derruba os que já estão prontos nem os que faltam: ele fica
      // marcado, com o motivo, e a composição segue.
      const msg = err instanceof Error ? err.message : String(err);
      log(`[compose ${cliente}] anúncio ${i + 1}/${anuncios.length} FALHOU: ${msg}`);
      Object.assign(anuncios[i], { status: "error", error: msg.slice(0, 500) });
    }
    await gravar();
    log(`[compose ${cliente}] anúncio ${i + 1}/${anuncios.length} ${anuncios[i].status}`);
  }

  await pararSeCancelada();
  const avisos = avisosDoConjunto(anuncios);
  // Pronta para REVISÃO, não salva: desde 19/10/2026 quem pediu revê (edita, pede revisão ao agente)
  // e salva. Quem chama pode salvar direto — é o "pular revisão" do orquestrador.
  await gravar({ status: "revisao", error: null });
  const falhas = anuncios.filter((a) => a.status === "error").length;
  log(
    `[compose ${cliente}] pronta para revisão: ${anuncios.length} anúncio(s)` +
      (falhas ? `, ${falhas} com falha` : "") +
      (avisos.length ? `, ${avisos.length} aviso(s)` : "")
  );
  return { id, avisos, fontes, anuncios: anuncios.length };
}

/**
 * Escreve uma composição a partir dos Conceitos Estratégicos APROVADOS (20/10/2026).
 *
 * O conjunto — quantos anúncios, o uso e o conceito de cada um — já foi decidido e aprovado na etapa
 * de conceitos (`composer-conceitos.js`). Aqui cada chamada escreve UM anúncio executando o seu
 * conceito, com só a análise de criativo DELE (a estrutura que ele segue): mandar todas convidaria
 * o anúncio a misturar estruturas.
 */
async function escreverComConceitos({ id, cliente, ctx, analise, material, fontes, conceitos, catalogo, signal, log }) {
  const slots = conceitos;
  const criativoDoSlot = (s) => {
    const ref = catalogo.criativos.find((x) => x.id === s.conceito?.criativo_ref);
    return material.criativos.find((c) => c.id === ref?.criativo_id) || null;
  };
  const anuncios = slots.map((s) => ({
    formato: s.formato_saida,
    angulo: anguloParaLista(s, catalogo),
    formato_justificativa: null,
    conceito: s.conceito,
    status: "pendente",
    composicao_md: null,
    composicao: null,
    avisos: [],
    error: null,
  }));
  const plano = anuncios.map((a) => ({ formato: a.formato, angulo: a.angulo }));
  const gravar = (extra = {}) =>
    patchComposition(id, {
      anuncios,
      plano: resumoDoPlano(anuncios),
      avisos: avisosDoConjunto(anuncios),
      ...extra,
    });

  await gravar(colunasDoConjunto({ ctx, analise, fontes, anuncios }));
  log(`[compose ${cliente}] ${anuncios.length} anúncio(s) a partir dos conceitos aprovados`);

  return escreverOsAnuncios({
    id,
    cliente,
    anuncios,
    gravar,
    inicio: 0,
    signal,
    log,
    fontes,
    escrever: async (i) => {
      const slot = slots[i];
      const criativo = criativoDoSlot(slot);
      const { finalText: texto } = await runAgentCli({
        agentId: COMPOSER_AGENT_ID,
        content: buildAnuncioPrompt({
          ...material,
          criativos: criativo ? [criativo] : [],
          plano,
          indice: i,
          conceito: blocoDoConceito({ slot, slots, catalogo, criativo }),
          conjunto: descreverConjuntoDeConceitos(slots, catalogo, i),
        }),
        sessionId: sessionId(cliente, i),
        timeoutMs: COMPOSER_RUN_TIMEOUT_MS,
        signal,
        log,
      });
      const lido = parseComposerReply(texto, { formatoFixo: anuncios[i].formato });
      return {
        composicao_md: lido.composicaoMd || null,
        composicao: lido.composicao,
        avisos: [
          ...lido.avisos,
          ...(lido.composicao
            ? avisosDoConceito({ formatoSaida: slot.formato_saida, composicao: lido.composicao, conceito: slot.conceito, catalogo })
            : []),
        ],
      };
    },
  });
}

/**
 * Revisa UM anúncio de uma composição em revisão, a pedido de quem a está revisando.
 *
 * A rota já marcou o anúncio como `running` (é o que a tela acompanha). Aqui: o material é relido,
 * o agente revisa a versão ATUAL, e a versão anterior vai para `versoes` — é o que o "desfazer"
 * devolve se a revisão sair pior.
 *
 * A gravação final relê a linha e troca SÓ este anúncio: a revisão leva minutos, e a pessoa pode
 * ter editado outro anúncio nesse meio-tempo — gravar o conjunto lido no começo apagaria a edição.
 *
 * Falhar não perde nada: o anúncio volta como estava, com o motivo em `error`.
 */
export async function revisarAnuncio({ composicao, indice, pedido, userId = null, log = () => {} }) {
  const { material } = await montarMaterial({
    cliente: composicao.cliente,
    libraryEntryId: composicao.library_entry_id,
    entradas: composicao.entradas,
    extraPrompt: composicao.extra_prompt || "",
  });
  const anuncios = Array.isArray(composicao.anuncios) ? composicao.anuncios : [];
  const atual = anuncios[indice];
  const plano = anuncios.map((a) => ({ formato: a.formato, angulo: a.angulo }));

  // Composição feita de Conceitos Estratégicos: a revisão leva o conceito do anúncio, para não sair
  // dele, e só a análise de criativo que ele segue.
  const catalogo = composicao.catalogo_copy;
  const slots = Array.isArray(composicao.conceitos) ? composicao.conceitos : [];
  const slot = catalogo ? slots.find((s) => s.n === indice && s.conceito) : null;
  const criativoRef = slot ? catalogo.criativos.find((x) => x.id === slot.conceito.criativo_ref) : null;
  const criativo = criativoRef ? material.criativos.find((c) => c.id === criativoRef.criativo_id) || null : null;
  const doConceito = slot
    ? {
        criativos: criativo ? [criativo] : [],
        conceito: blocoDoConceito({ slot, slots, catalogo, criativo }),
        conjunto: descreverConjuntoDeConceitos(slots, catalogo, indice),
      }
    : {};

  let resultado;
  try {
    const { finalText } = await runAgentCli({
      agentId: COMPOSER_AGENT_ID,
      content: buildRevisaoPrompt({ ...material, ...doConceito, plano, indice, atual: atual.composicao, pedido }),
      sessionId: sessionId(composicao.cliente, 100 + indice),
      timeoutMs: COMPOSER_RUN_TIMEOUT_MS,
      log,
    });
    const lido = parseComposerReply(finalText, { formatoFixo: atual.formato });
    resultado = lido.composicao
      ? {
          status: "ok",
          error: null,
          composicao: lido.composicao,
          composicao_md: lido.composicaoMd || null,
          avisos: [
            ...lido.avisos,
            ...(slot
              ? avisosDoConceito({ formatoSaida: atual.formato, composicao: lido.composicao, conceito: slot.conceito, catalogo })
              : []),
          ],
        }
      : { status: "ok", error: "A revisão voltou sem os campos — o anúncio ficou como estava." };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`[revisão ${composicao.id} #${indice + 1}] FALHOU: ${msg}`);
    resultado = { status: "ok", error: `A revisão falhou (${msg.slice(0, 300)}) — o anúncio ficou como estava.` };
  }

  const linha = await getComposition(composicao.id);
  if (!linha) return; // apagada durante a revisão
  const lista = Array.isArray(linha.anuncios) ? [...linha.anuncios] : [];
  if (!lista[indice]) return;
  const revisou = Boolean(resultado.composicao);
  const versoes = revisou
    ? comVersaoAnterior(linha.versoes, { indice, anuncio: lista[indice], motivo: "revisao", por: userId })
    : linha.versoes;
  lista[indice] = { ...lista[indice], ...resultado, ultima_revisao: String(pedido || "").slice(0, 500) };
  await patchComposition(composicao.id, {
    anuncios: lista,
    plano: resumoDoPlano(lista),
    avisos: avisosDoConjunto(lista),
    versoes,
  });
  log(`[revisão ${composicao.id} #${indice + 1}] ${revisou ? "ok" : "sem mudança"}`);
}
