/**
 * Ingestão dos documentos do ClickUp: traz para o servidor e mantém atualizado.
 *
 * ## A unidade é a PÁGINA
 *
 * O documento de um cliente neste workspace não é um Doc: é uma **página** dentro de um Doc
 * coletivo. "Mapeamento do Cliente" tem 66 páginas de clientes sob a página "Ativo" e 94 sob
 * "Inativo". Por isso o sync tem três etapas em vez de duas — listar Docs, enumerar as páginas de
 * cada um, baixar o corpo de quem é da allowlist — e por isso a atribuição roda sobre páginas. Ver
 * o cabeçalho de `docs-atribuicao.js` para o que a investigação derrubou, e o da migração 20261002
 * para o vazamento que o conteúdo concatenado abria.
 *
 * ## O custo, que é o que molda o desenho
 *
 * Listar os Docs do workspace é barato (uma busca paginada). **Enumerar** as páginas de um Doc é
 * uma chamada por Doc, e **baixar** o corpo é outra. Então cada etapa é incremental pelo
 * `date_updated` do ClickUp:
 *
 * - `precisaEstrutura` compara com `estrutura_lida_em`. Vale para TODO Doc, inclusive os fora da
 *   allowlist: a enumeração devolve títulos, não corpo (`lerEstruturaDoc` usa o endpoint de
 *   listagem de propósito), e sem ela a página de um cliente dentro de um Doc genérico ficaria
 *   invisível na aba.
 * - `precisaConteudo` compara com `conteudo_lido_em` e exige a allowlist.
 *
 * A **atribuição**, ao contrário das duas, roda sempre e sobre todas as páginas — ela é pura e sai
 * de `readDocPagesState()`, uma consulta, não uma chamada de API. Tem de ser assim porque ela
 * depende da carteira de clientes, que muda: um cliente novo precisa receber seus documentos sem
 * esperar que o ClickUp por coincidência marque os Docs dele como editados.
 *
 * ## Três decisões que não são de desempenho
 *
 * - **A allowlist manda.** Corpo só é lido para os tipos de `shared/clickup-doc-tipos.js`. O resto
 *   entra como linha (nome, link, caminho) e nunca tem o corpo gravado — ver o documento chamado
 *   "Acessos", que é o que motiva a regra, e `ehTemplate`, que tira os moldes em branco do caminho.
 * - **Pai se resolve uma vez na vida.** A busca de Docs só devolve o id do pai; descobrir o nome
 *   custa requisição, e na medição 74 de 100 documentos compartilhavam UM pai.
 * - **Marca-e-varre, com guarda.** Documento apagado no ClickUp tem de sair daqui, senão continua
 *   servindo de insumo ao Composer. Mas um sync que falhou no meio não pode apagar a tabela, então
 *   a varredura só roda quando a listagem foi completa e plausível.
 */

import {
  deleteDocPagesNaoVistas,
  deleteDocsNaoVistos,
  readClickupParents,
  readDocPagesState,
  readDocsSyncState,
  readProjetosLista,
  upsertClickupParents,
  upsertClientDocs,
  upsertDocPages,
} from "./db.js";
import {
  clickupHabilitado,
  lerDocs,
  lerEstruturaDoc,
  lerPaginasDoc,
  lerPaginasUmaAUma,
  resolverPai,
  teamId,
} from "./clickup.js";
import { clientesAtivos } from "./briefs.js";
import { linhaDoDoc, linhasDasPaginas, precisaConteudo, precisaEstrutura } from "./docs-atribuicao.js";

/** Quantas chamadas em paralelo. Baixo de propósito: a API tem limite por minuto. */
const CONCORRENCIA = 4;

/**
 * Doc com mais páginas que isto tem o corpo lido PÁGINA A PÁGINA, só as de clientes. O `/pages` do
 * Doc inteiro devolve o corpo de todas numa resposta só, e na "Central de Copy" (2.364 páginas) ele
 * estoura o tempo do ClickUp — "500 context deadline exceeded", medido em 20/10/2026. Pedir o Doc
 * inteiro já sabendo que vai falhar seria esperar o tempo dele estourar a cada execução.
 */
const LIMITE_DOC_INTEIRO = 300;
/** Quantas páginas um Doc lido página a página tem lidas por execução; o resto fica para a próxima. */
const MAX_PAGINAS_POR_DOC = 80;

/**
 * O erro é "o token não tem acesso", e não uma falha a investigar?
 *
 * É FATO, não defeito: a busca de Docs lista metadado de documento cujo corpo a ClickUp nega
 * (espaço privado, doc restrito), e no workspace da Groohub 21 tarefas-pai respondem
 * `401 OAUTH_027 — Team not authorized` e a pasta 90131707316 responde `401 ACCESS_022`. Só se
 * conserta no ClickUp, dando acesso ao dono do token. Entra contado e resumido, não como uma linha
 * de erro por documento mandando conferir a credencial que está certa.
 */
const semAcessoAoToken = (msg) =>
  /\((401|403)\)|EXTRA_AUTHZ|OAUTH_027|ACCESS_022|not_found_or_authorized/.test(msg);

/**
 * Limite de requisições por minuto estourado.
 *
 * Merece contagem própria porque é o único erro aqui que significa "tente de novo e vai dar certo",
 * e porque a primeira execução depois da migração é a que pode provocá-lo: ela enumera as páginas
 * dos 117 Docs do workspace do zero, somadas às leituras de corpo. O desenho já lida — sem
 * `estrutura_lida_em` gravado, a próxima execução tenta de novo —, mas um 429 contado e nomeado é a
 * diferença entre "rode de novo" e meia hora procurando um bug que não existe.
 */
const limiteDeTaxa = (msg) => /\(429\)|ClickUp 429|rate limit/i.test(msg);

/** Executa `fn` sobre `itens` com paralelismo limitado, preservando a ordem do resultado. */
async function emLotes(itens, fn, limite = CONCORRENCIA) {
  const out = new Array(itens.length);
  let proximo = 0;
  const trabalhador = async () => {
    for (;;) {
      const i = proximo;
      proximo += 1;
      if (i >= itens.length) return;
      out[i] = await fn(itens[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, trabalhador));
  return out;
}

/**
 * Resolve os pais que ainda não conhecemos e grava o que descobriu.
 *
 * Pai que nenhum endpoint reconhece é gravado como `desconhecido` — e isso é importante: sem
 * gravar, cada sync tentaria de novo os quatro endpoints para os mesmos ids, para sempre. Um
 * `desconhecido` guardado é conhecimento, não falha.
 */
async function resolverPais(docs, { log = () => {} } = {}) {
  const conhecidos = await readClickupParents();
  const faltando = [
    ...new Set(
      docs
        .map((d) => (d.parent?.id ? String(d.parent.id) : null))
        .filter((id) => id && !conhecidos.has(id))
    ),
  ];

  if (faltando.length) {
    log(`[docs-sync] resolvendo ${faltando.length} pai(s) ainda desconhecido(s)`);
    const resolvidos = await emLotes(faltando, async (id) => {
      try {
        const pai = await resolverPai(id);
        return { parent_id: id, kind: pai.kind, nome: pai.nome, cadeia: pai.cadeia };
      } catch (err) {
        log(`[docs-sync] pai ${id} falhou: ${err?.message || err}`);
        return null;
      }
    });
    const bons = resolvidos.filter(Boolean);
    if (bons.length) await upsertClickupParents(bons);
    for (const p of bons) conhecidos.set(p.parent_id, p);
  }

  return conhecidos;
}

/**
 * Sincroniza os documentos do ClickUp com as tabelas.
 *
 * `cliente` opcional restringe a ESCRITA de conteúdo a um cliente (a listagem é sempre do workspace
 * inteiro, porque a busca não filtra por cliente). Serve ao botão da tela: quem está olhando um
 * cliente não deve esperar a carteira toda.
 */
export async function sincronizarDocs({ cliente = null, log = () => {} } = {}) {
  if (!clickupHabilitado()) {
    throw new Error("Sem credencial do ClickUp: nada a sincronizar.");
  }

  const inicio = new Date().toISOString();
  const team = await teamId();

  const { docs, truncado } = await lerDocs(team);
  log(`[docs-sync] ${docs.length} documento(s) no workspace${truncado ? " (TRUNCADO)" : ""}`);

  const [projetos, estadoDocs, estadoPaginas, pais] = await Promise.all([
    readProjetosLista(),
    readDocsSyncState(),
    readDocPagesState(),
    resolverPais(docs, { log }),
  ]);
  const clientes = clientesAtivos(projetos);
  const docExistentePor = new Map(estadoDocs.map((r) => [String(r.doc_id), r]));
  const docPorId = new Map(docs.map((d) => [String(d.id), d]));

  const paginasGuardadas = new Map();
  for (const pg of estadoPaginas) {
    const k = String(pg.doc_id);
    if (!paginasGuardadas.has(k)) paginasGuardadas.set(k, []);
    paginasGuardadas.get(k).push(pg);
  }

  const linhas = docs.map((doc) =>
    linhaDoDoc({
      doc,
      pai: pais.get(String(doc.parent?.id ?? "")) ?? null,
      clientes,
      workspaceId: team,
    })
  );

  // --- 1) Estrutura: quais páginas cada Doc tem -------------------------------------------------
  const aEnumerar = linhas.filter((linha) =>
    precisaEstrutura({ linha, existente: docExistentePor.get(linha.doc_id) ?? null })
  );
  log(`[docs-sync] ${aEnumerar.length} documento(s) com páginas a (re)enumerar`);

  const estruturas = new Map();
  const estruturaSemAcesso = [];
  let estourouLimite = 0;
  await emLotes(aEnumerar, async (linha) => {
    try {
      estruturas.set(linha.doc_id, await lerEstruturaDoc(team, linha.doc_id));
    } catch (err) {
      const msg = String(err?.message || err);
      if (semAcessoAoToken(msg)) estruturaSemAcesso.push(linha.doc_id);
      else if (limiteDeTaxa(msg)) estourouLimite += 1;
      else log(`[docs-sync] páginas de ${linha.doc_id} falharam: ${msg}`);
    }
  });

  /**
   * As páginas de cada Doc, da melhor fonte disponível.
   *
   * Quando a enumeração falha e não há nada guardado, entra UMA linha sintética representando o Doc
   * inteiro (`page_id = 'doc:<doc_id>'`). Ela existe para o Doc não desaparecer da aba por causa de
   * uma permissão negada — a pessoa continua vendo o nome e o link, que é tudo que a allowlist
   * permitiria de qualquer jeito num Doc sem corpo lido. O prefixo garante que esse id nunca
   * colida com o de uma página de verdade, e quando a enumeração voltar a funcionar a linha deixa
   * de ser vista e a varredura a remove.
   */
  const paginasPorDoc = new Map();
  const sinteticos = new Set();
  for (const linha of linhas) {
    let pgs = estruturas.get(linha.doc_id);
    if (!pgs) {
      pgs = (paginasGuardadas.get(linha.doc_id) ?? [])
        .slice()
        .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
        .map((g) => ({
          id: g.page_id,
          nome: g.nome,
          pagina_pai_id: g.pagina_pai_id,
          caminho: g.caminho ?? [],
        }));
    }
    if (!pgs.length) {
      pgs = [{ id: `doc:${linha.doc_id}`, nome: linha.nome, pagina_pai_id: null, caminho: [] }];
      sinteticos.add(linha.doc_id);
    }
    paginasPorDoc.set(linha.doc_id, pgs);
  }

  // --- 2) Atribuição: de quem é cada página ----------------------------------------------------
  const linhasPagina = [];
  const clientesPorDoc = new Map();
  let coletivos = 0;
  for (const linha of linhas) {
    const { linhas: pls, coletivo } = linhasDasPaginas({
      doc: docPorId.get(linha.doc_id) ?? { name: linha.nome },
      linhaDoc: linha,
      paginas: paginasPorDoc.get(linha.doc_id) ?? [],
      clientes,
    });
    if (coletivo) coletivos += 1;
    linhasPagina.push(...pls);
    clientesPorDoc.set(
      linha.doc_id,
      new Set(pls.map((p) => p.cliente).filter(Boolean))
    );
  }

  // --- 3) Conteúdo: o corpo das páginas da allowlist -------------------------------------------
  const aBaixar = linhas.filter((linha) => {
    // Sync de um cliente só: paga o conteúdo dos Docs que têm ALGUMA página dele.
    if (cliente && !clientesPorDoc.get(linha.doc_id)?.has(cliente)) return false;
    // Sem saber as páginas, não há linha onde gravar o corpo de cada uma — e gravar o Doc inteiro
    // num campo só é exatamente o que esta mudança desfez.
    if (sinteticos.has(linha.doc_id)) return false;
    return precisaConteudo({
      linha,
      existente: docExistentePor.get(linha.doc_id) ?? null,
      // Só página de CLIENTE e com tipo: as sem dono nunca são lidas página a página, e contá-las
      // faria um Doc grande voltar à fila a cada execução, para sempre.
      temPaginaSemConteudo: (paginasGuardadas.get(linha.doc_id) ?? []).some(
        (pg) => !pg.conteudo_lido_em && pg.cliente && pg.tipo && !String(pg.page_id).startsWith("doc:")
      ),
    });
  });
  log(`[docs-sync] ${aBaixar.length} documento(s) com conteúdo a (re)baixar`);

  const conteudoSemAcesso = [];
  const estadoPagina = new Map(estadoPaginas.map((pg) => [String(pg.page_id), pg]));

  /**
   * O corpo das páginas de CLIENTE de um Doc, uma a uma (ver `LIMITE_DOC_INTEIRO`): primeiro as que
   * nunca foram lidas, depois as lidas antes da última edição do Doc, até `MAX_PAGINAS_POR_DOC`.
   * `completo` só quando todas as que precisavam foram lidas — é o que deixa o Doc ser marcado como
   * lido; senão a próxima execução continua de onde esta parou.
   */
  const lerPaginaAPagina = async (linha, motivo) => {
    const candidatas = linhasPagina
      .filter((pg) => pg.doc_id === linha.doc_id && pg.cliente && pg.tipo && !String(pg.page_id).startsWith("doc:"))
      // Sync de UM cliente (o "recarregar" da aba): só as páginas dele. Numa Central de Copy com
      // todos os clientes, ler as 80 primeiras de quaisquer clientes poderia nem chegar às dele.
      .filter((pg) => !cliente || pg.cliente === cliente)
      .map((pg) => {
        const lidaEm = estadoPagina.get(String(pg.page_id))?.conteudo_lido_em;
        const prioridade = !lidaEm
          ? 2
          : linha.atualizado_em_clickup && new Date(linha.atualizado_em_clickup) > new Date(lidaEm)
            ? 1
            : 0;
        return { id: String(pg.page_id), prioridade };
      })
      .filter((c) => c.prioridade > 0)
      .sort((a, b) => b.prioridade - a.prioridade);
    const lote = candidatas.slice(0, MAX_PAGINAS_POR_DOC).map((c) => c.id);
    const r = await lerPaginasUmaAUma(team, linha.doc_id, lote);
    if (r.limiteDeTaxa) estourouLimite += 1;
    const falhas = [...r.erros.values()].filter((m) => !limiteDeTaxa(m));
    if (falhas.length) log(`[docs-sync] ${falhas.length} página(s) de ${linha.doc_id} falharam, ex.: ${falhas[0]}`);
    log(
      `[docs-sync] ${linha.doc_id} lido página a página (${motivo}): ${r.conteudos.size} de ` +
        `${candidatas.length} página(s) de cliente a ler`
    );
    return {
      doc_id: linha.doc_id,
      paginas: [...r.conteudos].map(([id, conteudo_md]) => ({ id, conteudo_md })),
      completo: r.conteudos.size === candidatas.length,
    };
  };

  const resultados = await emLotes(aBaixar, async (linha) => {
    const tamanho = paginasPorDoc.get(linha.doc_id)?.length ?? 0;
    if (tamanho > LIMITE_DOC_INTEIRO) return lerPaginaAPagina(linha, `${tamanho} páginas`);
    try {
      return { doc_id: linha.doc_id, paginas: await lerPaginasDoc(team, linha.doc_id), completo: true };
    } catch (err) {
      const msg = String(err?.message || err);
      if (semAcessoAoToken(msg)) conteudoSemAcesso.push(linha.doc_id);
      else if (limiteDeTaxa(msg)) estourouLimite += 1;
      else {
        // Falha de verdade (rede, 500) não derruba o sync. O Doc inteiro pode ter estourado o
        // tempo do ClickUp: as páginas de cliente ainda dá para ler uma a uma.
        log(`[docs-sync] conteúdo de ${linha.doc_id} falhou: ${msg} — tentando página a página`);
        return lerPaginaAPagina(linha, "o Doc inteiro falhou").catch(() => null);
      }
      return null;
    }
  });

  const conteudoPor = new Map();
  const docsLidos = new Set();
  for (const r of resultados.filter(Boolean)) {
    if (r.completo) docsLidos.add(r.doc_id);
    for (const pg of r.paginas) conteudoPor.set(pg.id, pg.conteudo_md);
  }

  if (estourouLimite) {
    log(
      `[docs-sync] ${estourouLimite} chamada(s) recusada(s) por LIMITE DE TAXA do ClickUp (429). ` +
        "Nada se perdeu: as datas de leitura não foram gravadas para esses Docs, então a próxima " +
        "execução os pega. Rode de novo em alguns minutos."
    );
  }

  const semAcesso = [...new Set([...estruturaSemAcesso, ...conteudoSemAcesso])];
  if (semAcesso.length) {
    log(
      `[docs-sync] ${semAcesso.length} documento(s) SEM ACESSO para o token (401/403): ` +
        `${estruturaSemAcesso.length} na enumeração de páginas e ${conteudoSemAcesso.length} no ` +
        `corpo. Conserto é no ClickUp — dar acesso ao usuário dono do token, ou usar o token de ` +
        `quem vê esses espaços. Ex.: ${semAcesso.slice(0, 3).join(", ")}`
    );
  }

  // --- 4) Gravação -----------------------------------------------------------------------------
  const agora = new Date().toISOString();

  const payloadDocs = linhas.map((linha) => {
    const base = { ...linha, sincronizado_em: agora };
    // Chave AUSENTE preserva o valor antigo no `merge-duplicates`; chave com `null` o apaga. É por
    // isso que as datas de leitura só entram para quem foi lido NESTA execução.
    if (estruturas.has(linha.doc_id)) base.estrutura_lida_em = agora;
    if (docsLidos.has(linha.doc_id)) base.conteudo_lido_em = agora;
    return base;
  });

  let paginasSemCorpo = 0;
  const payloadPaginas = linhasPagina.map((linha) => {
    const base = { ...linha, sincronizado_em: agora };
    // Página lida NESTA execução — no Doc inteiro ou página a página, mesmo que o Doc não tenha
    // sido lido por completo — grava o corpo.
    if (!conteudoPor.has(linha.page_id)) {
      // O Doc foi lido, mas o endpoint de corpo não trouxe esta página — ela saiu do Doc depois da
      // enumeração, ou a enumeração vinha guardada e está velha. Fica sem as chaves de conteúdo
      // para a próxima execução tentar, em vez de ser marcada como "lida e vazia".
      if (docsLidos.has(linha.doc_id)) paginasSemCorpo += 1;
      return base;
    }
    const md = conteudoPor.get(linha.page_id) || "";
    return { ...base, conteudo_md: md || null, conteudo_chars: md.length, conteudo_lido_em: agora };
  });

  const gravadas = await upsertClientDocs(payloadDocs);
  const gravadasPaginas = await upsertDocPages(payloadPaginas);

  /**
   * A varredura só roda quando a listagem é confiável.
   *
   * `truncado` significa que a paginação bateu no teto, então há documentos que não vimos — varrer
   * apagaria linhas de documentos que existem. E uma listagem vazia é leitura falhando, não
   * workspace vazio: é a mesma regra de `coletarFichas`, que se recusa a tratar planilha vazia como
   * "nenhum cliente ativo".
   *
   * Páginas e Docs são varridos juntos: as duas tabelas receberam `sincronizado_em` nesta execução
   * (a atribuição reescreve TODA página, não só as reenumeradas), então o mesmo corte serve às
   * duas. Doc apagado inteiro leva as páginas pela FK; a varredura de páginas pega o caso menor,
   * que é a página apagada dentro de um Doc que continua existindo.
   */
  let removidas = 0;
  let removidasPaginas = 0;
  const podeVarrer = !truncado && !cliente && docs.length > 0;
  if (podeVarrer) {
    removidasPaginas = await deleteDocPagesNaoVistas(inicio);
    removidas = await deleteDocsNaoVistos(inicio);
    if (removidas || removidasPaginas) {
      log(
        `[docs-sync] ${removidas} documento(s) e ${removidasPaginas} página(s) removida(s) ` +
          "(sumiram do ClickUp)"
      );
    }
  } else if (!cliente) {
    log("[docs-sync] varredura PULADA: listagem truncada ou vazia — não dá para saber o que sumiu");
  }

  const semTipo = linhas.filter((l) => !l.tipo).length;
  const semCliente = linhasPagina.filter((p) => !p.cliente).length;
  log(
    `[docs-sync] fim: ${gravadas} documento(s) e ${gravadasPaginas} página(s) gravada(s), ` +
      `${estruturas.size} estrutura(s) enumerada(s), ${docsLidos.size} conteúdo(s) lido(s), ` +
      `${semTipo} sem tipo (conteúdo NÃO lido, de propósito), ${semCliente} página(s) sem cliente, ` +
      `${coletivos} Doc(s) coletivo(s), ${sinteticos.size} sem páginas enumeradas, ` +
      `${semAcesso.length} sem acesso` +
      (paginasSemCorpo ? `, ${paginasSemCorpo} página(s) sem corpo no retorno` : "") +
      (estourouLimite ? `, ${estourouLimite} recusada(s) por limite de taxa` : "")
  );

  return {
    total: linhas.length,
    paginas: linhasPagina.length,
    gravadas,
    gravadasPaginas,
    estruturasLidas: estruturas.size,
    semAcesso: semAcesso.length,
    conteudosLidos: docsLidos.size,
    // Docs cujas páginas resolveram para mais de um cliente — o caso comum do workspace, e também
    // o sinal de que a herança do Doc foi desligada ali (ver `linhasDasPaginas`).
    coletivos,
    semPaginas: sinteticos.size,
    semTipo,
    semCliente,
    removidas,
    removidasPaginas,
    estourouLimite,
    truncado,
    varreduraPulada: !podeVarrer && !cliente,
    sincronizadoEm: agora,
  };
}
