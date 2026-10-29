/**
 * Leitura do ClickUp — **só GET**, e só o que a aba Documentos precisa.
 *
 * Por que o worker lê direto em vez de perguntar ao agente: lista de documento é dado, não
 * diagnóstico (ver o comentário de `CLICKUP_API_TOKEN` em config.js). Por que um módulo separado do
 * `clickup-docs.js`: ali mora a lógica que decide de quem é cada documento, testável com fixture;
 * aqui mora a rede, que teste nenhum deveria tocar.
 *
 * O índice é do WORKSPACE INTEIRO e fica em cache: a busca de Docs da v3 não filtra por cliente
 * (filtra por pai, e não sabemos o id do pai de cada cliente), então o custo é o mesmo para um
 * cliente ou para os 62 — o que torna o cache a diferença entre uma aba instantânea e uma aba que
 * pagina o workspace a cada abertura.
 */

import { conteudoComSubpaginas, subpaginasDe } from "./docs-atribuicao.js";
import {
  CLICKUP_API_TOKEN,
  CLICKUP_ENV_ACEITAS,
  CLICKUP_MAX_DOC_PAGES,
  CLICKUP_TEAM_ID,
} from "./config.js";

const BASE = "https://api.clickup.com/api";

export function clickupHabilitado() {
  return Boolean(CLICKUP_API_TOKEN);
}

/**
 * Uma requisição GET à API.
 *
 * O 401/403 ganha mensagem própria porque é o erro que vai acontecer de verdade — token expirado,
 * token de outro workspace, token sem acesso ao espaço. "Request failed with 401" manda a pessoa
 * procurar bug no código em vez de olhar o `spy.env`.
 */
/**
 * `tolerarErro` devolve `null` em vez de lançar. É o que permite descobrir o TIPO de um id
 * tentando os endpoints, onde "este não é" chega como erro HTTP e é resposta útil, não falha.
 * Parâmetro novo e opcional: nenhuma chamada existente muda de comportamento.
 */
async function get(versao, caminho, params = {}, { tolerarErro = false } = {}) {
  if (!clickupHabilitado()) {
    // Nomeia as env vars aceitas porque o token do ClickUp já existe no servidor com um nome
    // escolhido antes desta aba: a mensagem útil é "é algum destes", não um nome só.
    throw new Error(
      `O worker não tem como ler o ClickUp: nenhuma destas env vars está preenchida — ${CLICKUP_ENV_ACEITAS.join(
        ", "
      )}. Ver apps/ad-spy-worker/spy.env.example.`
    );
  }
  const url = new URL(`${BASE}/${versao}/${caminho}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  const resp = await fetch(url, {
    method: "GET",
    headers: { Authorization: CLICKUP_API_TOKEN, Accept: "application/json" },
  });

  if (!resp.ok && tolerarErro) return null;
  if (resp.status === 401 || resp.status === 403) {
    // O CORPO vai na mensagem porque é onde vem o `ECODE`, e é ele que distingue causas que a
    // mensagem genérica confunde. Medido em 01/10/2026: a busca de Docs respondia 200 e
    // `/docs/{id}/pages` respondia 403 com o MESMO token — ou seja, "confira a credencial" era
    // conselho errado, e sem o corpo não havia como saber disso.
    const corpo = await resp.text().catch(() => "");
    throw new Error(
      `ClickUp recusou (${resp.status}) em ${caminho}: ${corpo.slice(0, 300) || "(sem corpo)"}`
    );
  }
  if (!resp.ok) {
    const corpo = await resp.text().catch(() => "");
    throw new Error(`ClickUp ${resp.status} em ${caminho}: ${corpo.slice(0, 300)}`);
  }
  return resp.json();
}

/**
 * O id do workspace.
 *
 * Com uma conta de um workspace só — o caso da Groohub — a env var é dispensável. Com dois, escolher
 * o primeiro mostraria os documentos do workspace errado sem nenhum sinal de que escolheu, então ele
 * para e diz qual env var falta, com os ids à mão.
 */
let teamIdCache = null;
export async function teamId() {
  if (CLICKUP_TEAM_ID) return CLICKUP_TEAM_ID;
  if (teamIdCache) return teamIdCache;
  const data = await get("v2", "team");
  const teams = Array.isArray(data?.teams) ? data.teams : [];
  if (teams.length === 1) {
    teamIdCache = String(teams[0].id);
    return teamIdCache;
  }
  throw new Error(
    teams.length === 0
      ? "O token do ClickUp não vê nenhum workspace."
      : `O token vê ${teams.length} workspaces (${teams
          .map((t) => `${t.id}=${t.name}`)
          .join(", ")}). Defina CLICKUP_TEAM_ID para escolher um.`
  );
}

/** Uma varredura paginada da busca de Docs, com os filtros dados. */
async function varrerDocs(team, filtros) {
  const docs = [];
  let cursor;
  let paginas = 0;
  let truncado = false;

  for (;;) {
    const data = await get("v3", `workspaces/${team}/docs`, {
      limit: 100,
      deleted: "false",
      ...filtros,
      cursor,
    });
    const lote = Array.isArray(data?.docs) ? data.docs : [];
    docs.push(...lote);
    paginas += 1;
    cursor = data?.next_cursor || null;
    if (!cursor || lote.length === 0) break;
    if (paginas >= CLICKUP_MAX_DOC_PAGES) {
      truncado = true;
      break;
    }
  }

  return { docs, truncado };
}

/**
 * Todos os Docs do workspace: os em uso MAIS os arquivados.
 *
 * **Duas varreduras, porque `archived` é FILTRO e não inclusão** — medido no workspace da Groohub em
 * 01/10/2026: sem o parâmetro vieram 100 (o limite da página), com `archived=true` vieram 5. A
 * primeira versão passava `archived: "true"` achando que somava os arquivados aos outros; o que ela
 * fazia era pedir SÓ eles, e a aba inteira trabalhava com 5 documentos do workspace todo. Era a
 * causa principal de "nenhum documento encontrado" para qualquer cliente.
 *
 * Arquivado é mostrado marcado e no fim da lista: "estratégia do ano passado" é documento que às
 * vezes é exatamente o que se procura. Apagado não entra em nenhuma das duas.
 */
export async function lerDocs(team) {
  const [vivos, arquivados] = await Promise.all([
    varrerDocs(team, {}),
    // Se esta falhar, a aba perde os arquivados mas não perde os em uso — que é o que importa.
    varrerDocs(team, { archived: "true" }).catch(() => ({ docs: [], truncado: false })),
  ]);

  // O filtro pode não ser exclusivo em toda versão da API; dedupe por id para não listar duas vezes.
  const porId = new Map();
  for (const d of [...vivos.docs, ...arquivados.docs]) {
    if (d?.id && !porId.has(String(d.id))) porId.set(String(d.id), d);
  }

  return { docs: [...porId.values()], truncado: vivos.truncado || arquivados.truncado };
}

/** Pasta "hidden" no ClickUp é o contêiner implícito de lista sem pasta: o nome não diz nada. */
const nomeUtil = (x) => (x && x.hidden !== true && x.name ? String(x.name).trim() : null);

/**
 * Um `parent.id` de Doc -> `{ kind, nome, cadeia }`.
 *
 * **Descoberto por tentativa, de propósito.** A busca de Docs devolve `parent.type` como número, e
 * neste workspace os números são 1 e 12 — não os 4/5/6/7 que a documentação de Views enumera. Eu
 * codifiquei aqueles números e a aba não achou documento nenhum. Perguntar aos endpoints qual
 * responde 200 custa de 1 a 4 requisições por pai, UMA vez na vida (o resultado fica em
 * `marketing_clickup_parents`), e não quebra quando a ClickUp mudar a tabela de códigos.
 *
 * O formato do id é só uma DICA de ordem: numérico parece lista/pasta/espaço, alfanumérico parece
 * tarefa. As quatro tentativas acontecem de qualquer jeito, então a dica economiza chamadas — nunca
 * decide.
 */
export async function resolverPai(parentId) {
  const id = String(parentId ?? "").trim();
  if (!id) return { kind: "desconhecido", nome: null, cadeia: [] };

  const ordem = /^\d+$/.test(id)
    ? ["list", "folder", "space", "task"]
    : ["task", "list", "folder", "space"];

  for (const kind of ordem) {
    const data = await get("v2", `${kind}/${id}`, {}, { tolerarErro: true });
    if (!data?.name) continue;
    const nome = String(data.name).trim();

    if (kind === "task") {
      // A tarefa é o registro do cliente neste workspace, então ela é o fim da cadeia. O espaço vem
      // só com id na resposta de tarefa, por isso não entra: cadeia com id cru não ajuda ninguém.
      return {
        kind,
        nome,
        cadeia: [nomeUtil(data.folder), nomeUtil(data.list), nome].filter(Boolean),
      };
    }
    if (kind === "list") {
      return {
        kind,
        nome,
        cadeia: [nomeUtil(data.space), nomeUtil(data.folder), nome].filter(Boolean),
      };
    }
    if (kind === "folder") {
      return { kind, nome, cadeia: [nomeUtil(data.space), nome].filter(Boolean) };
    }
    return { kind, nome, cadeia: [nome] };
  }

  // Nenhum endpoint reconheceu o id: documento no nível do workspace, ou pai que o token não
  // enxerga. Fica `desconhecido` em vez de virar erro — o documento ainda pode ser atribuído pelo
  // título, e gravar o desconhecido evita tentar os quatro endpoints de novo a cada sync.
  return { kind: "desconhecido", nome: null, cadeia: [] };
}

/**
 * A ÁRVORE DE PÁGINAS de um Doc: id, título, página-mãe e caminho — **sem conteúdo**.
 *
 * Esta é a chamada que faz a atribuição funcionar neste workspace. O documento de um cliente aqui é
 * uma página dentro de um Doc coletivo ("Mapeamento do Cliente" tem 66 páginas de clientes sob a
 * página "Ativo"), e a busca de Docs não diz nada sobre páginas — ela devolve um Doc com um título
 * que não nomeia cliente nenhum. Sem enumerar, não há o que atribuir.
 *
 * **O endpoint de listagem, não o de páginas, e isso é uma decisão de segurança.** `/pages` devolve
 * a mesma árvore COM o corpo de cada página; `/pageListing` devolve só a estrutura. Como a
 * enumeração roda para todo Doc do workspace — inclusive os fora da allowlist, porque a página de
 * um cliente dentro de um deles precisa aparecer como link —, usar `/pages` aqui traria o corpo do
 * documento "Acessos" para a memória do processo. A allowlist existe para isso não acontecer, e
 * respeitá-la só na gravação seria respeitá-la pela metade.
 *
 * `max_page_depth: -1` pede a árvore inteira: a hierarquia observada tem três níveis (Doc › "Ativo"
 * › página do cliente) e um teto de profundidade cortaria exatamente o nível que interessa. Se a
 * API recusar o parâmetro, a chamada é repetida SEM ele e vale o default — um parâmetro que a
 * ClickUp mude de nome ou de faixa não pode derrubar a enumeração do workspace inteiro, que é o que
 * aconteceria: todo Doc cairia na linha sintética e a aba esvaziaria de uma vez.
 */
export async function lerEstruturaDoc(team, docId) {
  const caminho = `workspaces/${team}/docs/${docId}/pageListing`;
  let data = await get("v3", caminho, { max_page_depth: -1 }, { tolerarErro: true });
  // `tolerarErro` só devolve null em erro HTTP, então o retry não engole falha de rede.
  if (data === null) data = await get("v3", caminho);
  const raiz = Array.isArray(data) ? data : Array.isArray(data?.pages) ? data.pages : [];

  const out = [];
  const andar = (nos, caminho, paiId) => {
    for (const no of nos) {
      if (!no?.id) continue;
      const nome = String(no.name ?? "").trim();
      out.push({ id: String(no.id), nome, pagina_pai_id: paiId, caminho: [...caminho] });
      const filhos = Array.isArray(no.pages) ? no.pages : [];
      // O caminho da subpágina inclui o título desta: é o que permite "Dra. Amanda Duarte" passar o
      // cliente às subpáginas dela (ver `casarPagina`).
      if (filhos.length) andar(filhos, [...caminho, nome], String(no.id));
    }
  };
  andar(raiz, [], null);
  return out;
}

/**
 * O conteúdo das páginas de um Doc, **uma por uma**.
 *
 * Uma chamada por Doc devolve todas as páginas, então o custo é o mesmo de antes — o que muda é que
 * o resultado não é mais colado num texto só. A concatenação era o ponto onde o mapeamento de 66
 * clientes virava um campo único: atribuir aquele campo a um cliente levaria a estratégia dos
 * outros 65 ao prompt dele. Não existe mais um lugar onde isso caiba.
 *
 * É a parte CARA da ingestão, e é por isso que o sync só a paga para quem é da allowlist e foi
 * editado desde a última leitura (`precisaConteudo`).
 */
export async function lerPaginasDoc(team, docId) {
  // A árvore INTEIRA, como em `lerEstruturaDoc`. Até 20/10/2026 só o primeiro nível era lido, e
  // toda subpágina do workspace aparecia na aba sem conteúdo — o Estudo de Copy do Dr. Otavio,
  // com o texto numa subpágina, foi como isso apareceu. Mesmo retry sem o parâmetro de lá.
  const caminho = `workspaces/${team}/docs/${docId}/pages`;
  let data = await get("v3", caminho, { content_format: "text/md", max_page_depth: -1 }, { tolerarErro: true });
  if (data === null) data = await get("v3", caminho, { content_format: "text/md" });
  const raiz = Array.isArray(data) ? data : Array.isArray(data?.pages) ? data.pages : [];

  const out = [];
  const vistas = new Set();
  const andar = (nos, paiId) => {
    for (const p of nos) {
      if (!p?.id || vistas.has(String(p.id))) continue;
      vistas.add(String(p.id));
      out.push({
        id: String(p.id),
        nome: String(p?.name ?? "").trim(),
        pagina_pai_id: p?.parent_page_id ? String(p.parent_page_id) : paiId,
        conteudo_md: String(p?.content ?? "").trim(),
      });
      if (Array.isArray(p.pages) && p.pages.length) andar(p.pages, String(p.id));
    }
  };
  andar(raiz, null);
  return out;
}

/**
 * O conteúdo de ALGUMAS páginas de um Doc, uma chamada por página.
 *
 * Existe por causa do Doc coletivo grande: a "Central de Copy" da Groohub — o material de copy de
 * TODOS os clientes num Doc só, com uma seção por cliente — tem 2.364 páginas, e o
 * `/pages` que devolve todas com o corpo estoura o tempo do lado do ClickUp ("500 context deadline
 * exceeded", medido em 20/10/2026), enquanto uma página sozinha volta em ~300 ms. Quando só algumas
 * páginas interessam — o preview de uma, o sync das que são de clientes —, pedir uma a uma é mais
 * barato e não depende do tamanho do Doc.
 *
 * Falha de uma página não derruba as outras: ela fica em `erros`. Limite de taxa (429) para a
 * leitura no meio, porque insistir só gastaria a cota que o resto do worker também usa.
 *
 * @returns {Promise<{ conteudos: Map<string, string>, erros: Map<string, string>, limiteDeTaxa: boolean }>}
 */
export async function lerPaginasUmaAUma(team, docId, pageIds, { concorrencia = 3 } = {}) {
  const fila = [...new Set((pageIds || []).map(String))];
  const conteudos = new Map();
  const erros = new Map();
  let limiteDeTaxa = false;
  const trabalhador = async () => {
    while (fila.length && !limiteDeTaxa) {
      const id = fila.shift();
      try {
        const p = await get("v3", `workspaces/${team}/docs/${docId}/pages/${id}`, { content_format: "text/md" });
        conteudos.set(id, String(p?.content ?? "").trim());
      } catch (err) {
        const msg = String(err?.message || err);
        erros.set(id, msg);
        if (/\b429\b/.test(msg)) limiteDeTaxa = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concorrencia, fila.length) }, trabalhador));
  return { conteudos, erros, limiteDeTaxa };
}

/** Quantas páginas a leitura direta (preview, composição) busca no ClickUp de uma vez, no máximo. */
const MAX_PAGINAS_AO_VIVO = 40;

/**
 * O CORPO de um documento do ClickUp — e documento aqui é uma **página**.
 *
 * Serve o preview da tela e o prompt do Composer. O contrato de resposta é o que o stub desta
 * função definiu e a rota consome, agora com o quarto caso que o stub não previa:
 *
 *   `{ conteudo_md: string }`   -> o corpo, em markdown
 *   `{ conteudo_md: null }`     -> lemos, e a página não tem corpo
 *   `{ motivo }`                -> NÃO vamos ler, por decisão (tipo fora da allowlist)
 *   `null`                      -> não conseguimos ler
 *
 * `motivo` existe porque responder `{ conteudo_md: null }` para o "Acessos" diria "está vazio",
 * que é mentira sobre um documento que tem conteúdo e que a pessoa pode abrir no ClickUp.
 *
 * **Recebe um `page_id`, não um `doc_id`.** Desde que a unidade de atribuição passou a ser a
 * página, é a página que a aba lista e que o Composer guarda em `entradas`. Um `doc_id` antigo
 * guardado numa composição anterior simplesmente não acha linha e cai no quarto caso — degradação
 * honesta, e não um conteúdo errado servido com confiança.
 *
 * **Serve da TABELA, não do ClickUp.** O sync é quem fala com a API; aqui a resposta vem de
 * `marketing_client_doc_pages`, que é instantânea e é exatamente o que vai ao prompt — um preview
 * que mostrasse outro texto não serviria para nada.
 *
 * ## `cliente` é a guarda, e ela é o ponto desta função
 *
 * Quem chama diz de QUAL cliente espera que a página seja, e a função se recusa a devolver o corpo
 * de uma página de outro. Sem isso, a garantia de não misturar clientes dependeria de a tela mandar
 * sempre os ids certos — ou seja, de um acerto na camada mais fácil de errar, com o resultado
 * indo direto ao prompt de um modelo. Com a guarda, o erro mais grave que um id trocado pode causar
 * é um insumo faltando.
 *
 * Opcional por compatibilidade: sem `cliente` a função se comporta como antes. Os dois chamadores
 * de produção — a rota de conteúdo e `composer.js` — passam.
 */
export async function conteudoDoDocumento(pageId, { cliente = null } = {}) {
  const { getDocPage, listPaginasDoDoc } = await import("./db.js");

  const linha = await getDocPage(pageId).catch(() => null);
  if (!linha) {
    // Nem o sync viu esta página. Não lemos ao vivo sem linha: sem linha não há cliente atribuído,
    // e servir o corpo de um documento que não sabemos de quem é furaria a única garantia que esta
    // feature tem.
    console.error(`[clickup] conteúdo de ${pageId}: a página não está na tabela (o sync ainda não a viu)`);
    return null;
  }

  if (cliente && linha.cliente !== cliente) {
    return {
      conteudo_md: null,
      lidoEm: null,
      motivo:
        "Este documento não está atribuído a este cliente, então o conteúdo dele não é servido " +
        "aqui. Se ele deveria ser, o que precisa mudar é a atribuição — o título da página no " +
        "ClickUp, ou o lugar dela.",
    };
  }

  if (!linha.tipo) {
    return {
      conteudo_md: null,
      lidoEm: null,
      motivo:
        "O conteúdo deste documento não é lido por decisão: o tipo dele não está na lista de " +
        "tipos ingeridos, porque documento de credencial e afins não devem ser copiados para o " +
        "nosso banco nem para o prompt de um modelo. Abra no ClickUp pelo link.",
    };
  }

  // Uma página com subpáginas é UM documento (decisão do usuário, 20/10/2026): o Estudo de Copy do
  // Dr. Otavio é uma página de corpo vazio com o texto numa subpágina. Entram as subpáginas do
  // MESMO cliente — a guarda acima vale para elas também — e cada uma, de credencial, fica de fora.
  const doDoc = await listPaginasDoDoc(linha.doc_id).catch(() => [linha]);
  const subpaginas = subpaginasDe(linha.page_id, doDoc).filter((p) => p.cliente === linha.cliente && p.tipo);

  // O que o sync ainda não leu é lido AGORA, numa chamada só ao Doc. **Lê e devolve, sem gravar.**
  // Gravar exigiria atribuir a página a um cliente, e atribuir exige a carteira inteira para
  // desempatar — é o trabalho do sync, não de uma requisição de preview. O preço é que um preview
  // antes do sync relê; é raro e o react-query guarda a resposta.
  //
  // Página a página, e não o Doc inteiro: num Doc coletivo de milhares de páginas o pedido inteiro
  // estoura o tempo do ClickUp (ver `lerPaginasUmaAUma`), e aqui só interessam estas.
  const faltam = [linha, ...subpaginas].filter((p) => !p.conteudo_lido_em);
  let vivas = null;
  if (faltam.length && clickupHabilitado()) {
    try {
      const team = await teamId();
      const ids = faltam.slice(0, MAX_PAGINAS_AO_VIVO).map((p) => String(p.page_id));
      const lidas = await lerPaginasUmaAUma(team, linha.doc_id, ids);
      vivas = lidas.conteudos;
      // Antes daqui o erro era engolido, e "não foi possível ler" chegava à tela sem nenhum rastro
      // no log de POR QUÊ (permissão, limite de taxa, rede).
      for (const [id, msg] of lidas.erros) {
        console.error(`[clickup] conteúdo de ${id} (Doc ${linha.doc_id}, pedido por ${pageId}) falhou: ${msg}`);
      }
      if (faltam.length > MAX_PAGINAS_AO_VIVO) {
        console.error(`[clickup] conteúdo de ${pageId}: ${faltam.length} páginas sem leitura, lidas só ${MAX_PAGINAS_AO_VIVO}`);
      }
    } catch (err) {
      console.error(`[clickup] conteúdo de ${pageId} (Doc ${linha.doc_id}) falhou: ${err?.message || err}`);
    }
  }
  const corpo = (p) => (p.conteudo_lido_em ? p.conteudo_md || "" : vivas?.has(String(p.page_id)) ? vivas.get(String(p.page_id)) : null);

  const proprio = corpo(linha);
  const corpos = subpaginas.map((p) => ({ caminho_relativo: p.caminho_relativo, conteudo_md: corpo(p) }));
  if (proprio === null && corpos.every((c) => c.conteudo_md === null)) {
    if (!faltam.length || vivas) {
      console.error(`[clickup] conteúdo de ${pageId}: o ClickUp não devolveu esta página nem as subpáginas dela`);
    }
    return null;
  }
  return {
    conteudo_md: conteudoComSubpaginas(proprio, corpos),
    lidoEm: faltam.length ? new Date().toISOString() : linha.conteudo_lido_em,
    subpaginas: subpaginas.length,
  };
}
