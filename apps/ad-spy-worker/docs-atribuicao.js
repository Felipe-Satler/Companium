/**
 * Documentos do ClickUp -> cliente. **Lógica pura**, sem rede: é aqui que a feature acerta ou erra.

 *
 * O risco não é a tela nem a requisição: é atribuir o documento ao cliente ERRADO. Um mapeamento
 * estratégico do cliente A aparecendo na aba do cliente B é vazamento entre contas, e agora que o
 * conteúdo vai ao prompt do Composer o erro não para na tela: vira peça criativa feita com a
 * estratégia de outro. Daí quase todo teste deste módulo ser sobre o que NÃO casa.
 *
 * ## Como o ClickUp da Groohub é de fato organizado (medido em 02/10/2026)
 *
 * Não existe espaço "Clientes" — os espaços são Comercial, RevOps, MktOps, Gestão, Tech, Testes
 * Automação. E a unidade de atribuição **não é o Doc: é a PÁGINA dentro dele**. O padrão dominante
 * do workspace é o Doc coletivo:
 *
 *   groohub › Mapeamento do Cliente › Ativo › Mapeamento - Dra. Amanda Duarte
 *
 * "Mapeamento do Cliente" tem 66 páginas de clientes sob a página "Ativo" e 94 sob "Inativo";
 * "Briefing de Conteúdo" segue a mesma forma. "Ativo" e "Inativo" são PÁGINAS, não pastas.
 *
 * Duas premissas da primeira versão caíram com isso, e as duas estavam escritas aqui:
 *
 * - **"Cada cliente é uma tarefa."** A tarefa-pai 86a43dceu chama-se "Mapeamento Estratégico" e não
 *   nomeia cliente nenhum; quem nomeava era o título do Doc. A tarefa segue sendo sinal, não O
 *   sinal — e para páginas ela é o sinal mais FRACO, porque vale para o Doc inteiro.
 * - **"Doc com vários clientes é empate, logo não atribui."** Doc coletivo com dezenas de páginas de
 *   clientes diferentes é o caso normal. `melhorCliente` recusava justamente o caso mais comum do
 *   workspace, e é por isso que 117 Docs sincronizados rendiam quase nenhuma atribuição. A regra de
 *   empate continua valendo **no nível do Doc**, onde ela é certa; no nível da página o empate
 *   praticamente não ocorre, porque o título da página nomeia um cliente só.
 *
 * Os códigos de `parent.type` deste workspace são 1 e 12, e não os 4/5/6/7 que a documentação de
 * Views enumera. Este módulo **não os interpreta**: ele recebe o pai já resolvido (`kind`, `nome`,
 * `cadeia`), descoberto por tentativa nos endpoints. Depender daqueles números foi o bug que fez a
 * aba não achar documento nenhum, e tratá-los como opacos é a correção definitiva.
 */

import { canonicalizeAdsClient, clientMatchKey, stripAccents } from "./client-match.js";
import { classificarDoc, ehTemplate } from "../../shared/clickup-doc-tipos.js";

/** O link do documento. A API **não** devolve URL; o formato é `/{workspace}/v/dc/{doc}`. */
export function docUrl(workspaceId, docId) {
  if (!workspaceId || !docId) return null;
  return `https://app.clickup.com/${workspaceId}/v/dc/${docId}`;
}

/**
 * Nome -> lista de tokens alfanuméricos, sem acento e em minúsculas.
 *
 * Tokens em vez de uma string única porque o casamento por título precisa de FRONTEIRA: "Dr. José
 * Rosa" dentro de "Mapeamento Estratégico - Dr. José Ramos" tem de casar, e `clara` não pode casar
 * dentro de `claramente`. Comparar sequência de tokens dá as duas coisas.
 */
function tokens(nome) {
  return stripAccents(String(nome ?? ""))
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** `agulha` aparece como sequência CONTÍGUA de tokens dentro de `palheiro`? */
function contemSequencia(palheiro, agulha) {
  if (agulha.length === 0 || agulha.length > palheiro.length) return false;
  for (let i = 0; i <= palheiro.length - agulha.length; i += 1) {
    let ok = true;
    for (let j = 0; j < agulha.length; j += 1) {
      if (palheiro[i + j] !== agulha[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/**
 * As chaves de um cliente, cada uma como lista de tokens, da mais longa para a mais curta.
 *
 * Mais longa primeiro porque é ela que resolve a ambiguidade entre clientes de nome encaixado:
 * "Clarice Mendes" e "Clarice Mendes Odonto" são dois clientes, e um documento "Clarice Mendes Odonto -
 * Plano" casa com os dois. O mais específico ganha — ver `melhorCliente`.
 */
export function chavesEmTokens(cliente) {
  const brutas = [...(cliente?.chaves ?? []), cliente?.padrao, cliente?.nome].filter(Boolean);
  const vistas = new Set();
  const out = [];
  for (const bruta of brutas) {
    // Passa pela canonicalização para "Dr. José Ramos - VascuMed" virar a chave do dashboard: sem
    // isso o honorífico e o nome da clínica impedem o casamento com o slug `jose_ramos`.
    for (const variante of [bruta, canonicalizeAdsClient(bruta)]) {
      const t = tokens(clientMatchKey(variante));
      const assinatura = t.join("_");
      // Chave de um token só é perigosa demais: um cliente chamado "Vida" casaria com qualquer
      // documento que mencionasse "vida". Exige duas palavras no casamento por texto.
      if (t.length < 2 || vistas.has(assinatura)) continue;
      vistas.add(assinatura);
      out.push(t);
    }
  }
  out.sort((a, b) => b.length - a.length);
  return out;
}

/**
 * Força do casamento, do mais forte para o mais fraco. Vira a coluna `atribuido_via`.
 *
 * Uma escala, não um booleano, porque a tela e o Composer devem tratar diferente: um título de
 * página que nomeia o cliente é quase certeza, e um título de Doc é indício.
 *
 * As duas primeiras são de PÁGINA e ficam acima de tudo que vem do Doc — uma escala só, para
 * "página ganha de Doc" não precisar de regra à parte. `pagina` é o título da própria página
 * ("Mapeamento - Dra. Amanda Duarte"), `pagina_pai` é o de uma página ancestral dentro do mesmo Doc.
 */
const FORCA = { pagina: 5, pagina_pai: 4, tarefa: 3, pasta: 2, nome: 1 };

/**
 * Este documento casa com este cliente, e por qual via?
 *
 * Devolve `{ via, forca, especificidade }` ou `null`. `especificidade` é o tamanho da chave que
 * casou, usado para desempatar entre clientes de nome encaixado.
 */
export function casarDoc({ doc, pai, chavesTokens }) {
  const nomePai = tokens(pai?.nome);
  const cadeia = (pai?.cadeia ?? []).filter(Boolean);

  for (const chave of chavesTokens) {
    // 1) O pai é a TAREFA do cliente. No ClickUp da Groohub cada cliente é uma tarefa, então este é
    //    o sinal forte: o documento está pendurado no registro do cliente.
    if (pai?.kind === "task" && contemSequencia(nomePai, chave)) {
      return { via: "tarefa", forca: FORCA.tarefa, especificidade: chave.length };
    }
  }

  // 2) Espaço, pasta ou lista com o nome do cliente. Do mais interno para o mais externo: o mais
  //    interno é o mais específico.
  for (let i = cadeia.length - 1; i >= 0; i -= 1) {
    const alvo = tokens(cadeia[i]);
    for (const chave of chavesTokens) {
      if (contemSequencia(alvo, chave)) {
        return { via: "pasta", forca: FORCA.pasta, especificidade: chave.length };
      }
    }
  }

  // 3) Último recurso: o título do documento. É assim que "Mapeamento Estratégico - Dr. Lia
  //    Garrido" acha o cliente quando o pai não o nomeia. Indício, não prova — e a coluna
  //    `atribuido_via` guarda essa diferença.
  const nomeDoc = tokens(doc?.name);
  for (const chave of chavesTokens) {
    if (contemSequencia(nomeDoc, chave)) {
      return { via: "nome", forca: FORCA.nome, especificidade: chave.length };
    }
  }

  return null;
}

/**
 * De todos os clientes, qual fica com este documento.
 *
 * Avaliar a carteira INTEIRA de uma vez é o que torna este casamento seguro, e é possível porque o
 * sync processa tudo junto (a primeira versão avaliava um cliente por requisição e, sem poder
 * comparar, tinha de recusar qualquer casamento parcial de título). Ordem de decisão: via mais
 * forte, depois chave mais específica. Empate real devolve `null` em vez de escolher — mostrar o
 * documento no cliente errado é pior do que não atribuir, e a linha fica visível sem cliente.
 */
function escolherMelhor(clientes, casar) {
  let melhor = null;
  let empatado = false;

  for (const cliente of clientes) {
    const casou = casar(chavesEmTokens(cliente));
    if (!casou) continue;

    if (!melhor) {
      melhor = { cliente, ...casou };
      continue;
    }
    const ganha =
      casou.forca > melhor.forca ||
      (casou.forca === melhor.forca && casou.especificidade > melhor.especificidade);
    const empata =
      casou.forca === melhor.forca && casou.especificidade === melhor.especificidade;

    if (ganha) {
      melhor = { cliente, ...casou };
      empatado = false;
    } else if (empata) {
      empatado = true;
    }
  }

  return empatado ? null : melhor;
}

export function melhorCliente({ doc, pai, clientes }) {
  return escolherMelhor(clientes, (chavesTokens) => casarDoc({ doc, pai, chavesTokens }));
}

/** ms epoch (number ou string, como a API manda) -> ISO. Lixo vira null, não "Invalid Date". */
export function iso(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Um Doc da API + o pai resolvido -> a linha de `marketing_client_docs`, sem conteúdo.
 *
 * O conteúdo é decidido e baixado depois (`docs-sync.js`), porque depende de comparar datas e de
 * uma chamada por documento. Aqui fica só o que se sabe sem ir à rede de novo.
 */
export function linhaDoDoc({ doc, pai, clientes, workspaceId }) {
  // Template não é material de cliente, e o nome dele casa com a allowlist por ser o molde do
  // documento. Sem esta guarda, um "Template de Mapeamento Estratégico" numa pasta de cliente seria
  // atribuído a ele por `pasta` e viraria insumo — um formulário em branco que o modelo preencheria
  // com invenção. Ver `ehTemplate` em shared/clickup-doc-tipos.js.
  const escolhido = ehTemplate(doc?.name) ? null : melhorCliente({ doc, pai, clientes });
  const cadeia = (pai?.cadeia ?? []).filter(Boolean);
  return {
    doc_id: String(doc.id),
    cliente: escolhido?.cliente?.padrao ?? null,
    atribuido_via: escolhido?.via ?? null,
    nome: String(doc.name ?? "").trim() || "(sem título)",
    url: docUrl(workspaceId, doc.id),
    local: cadeia.length ? cadeia.join(" › ") : null,
    parent_id: doc.parent?.id ? String(doc.parent.id) : null,
    parent_type: Number.isFinite(Number(doc.parent?.type)) ? Number(doc.parent.type) : null,
    // A allowlist decide se o conteúdo pode ser lido. `null` é a resposta para a maioria, e é o
    // estado seguro — ver shared/clickup-doc-tipos.js.
    tipo: classificarDoc(doc.name),
    arquivado: Boolean(doc.archived),
    publico: Boolean(doc.public),
    criado_em_clickup: iso(doc.date_created),
    atualizado_em_clickup: iso(doc.date_updated),
  };
}

/**
 * Precisa (re)baixar o conteúdo deste documento?
 *
 * É o motor do sync incremental: listar o workspace é barato, baixar conteúdo é uma chamada por
 * documento. Só paga quem é novo, quem foi editado depois da última leitura, e quem é da allowlist.
 */
export function precisaConteudo({ linha, existente, temPaginaSemConteudo = false }) {
  if (!linha.tipo) return false;
  if (!existente?.conteudo_lido_em) return true;
  // Autocorreção (20/10/2026): até esta data o corpo só era lido das páginas do PRIMEIRO nível do
  // Doc, e as subpáginas ficaram sem conteúdo com o Doc marcado como lido. Página ainda sem leitura
  // faz o Doc ser relido mesmo sem edição — é o que conserta as antigas sem depender de alguém
  // editar cada Doc no ClickUp.
  if (temPaginaSemConteudo) return true;
  if (!linha.atualizado_em_clickup) return false;
  return new Date(linha.atualizado_em_clickup) > new Date(existente.conteudo_lido_em);
}

// ---------------------------------------------------------------------------------------------
// PÁGINAS — a unidade de atribuição de verdade neste workspace.
// ---------------------------------------------------------------------------------------------

/**
 * Esta página casa com este cliente, e por qual via?
 *
 * Duas vias, nesta ordem: o título da própria página, e o de uma página ancestral dentro do mesmo
 * Doc (de dentro para fora, porque o ancestral mais próximo é o mais específico).
 *
 * O título da página é o sinal mais forte que esta feature tem, e isso é consequência da convenção
 * observada no workspace: a página do cliente se chama "Mapeamento - Dra. Amanda Duarte". Não é
 * indício como o título de um Doc coletivo — é o nome que alguém deu àquela página para dizer de
 * quem ela é.
 */
export function casarPagina({ pagina, chavesTokens }) {
  const nome = tokens(pagina?.nome);
  for (const chave of chavesTokens) {
    if (contemSequencia(nome, chave)) {
      return { via: "pagina", forca: FORCA.pagina, especificidade: chave.length };
    }
  }

  // Herança dentro do Doc: uma página "Dra. Amanda Duarte" passa o cliente para as subpáginas dela.
  const ancestrais = (pagina?.caminho ?? []).filter(Boolean);
  for (let i = ancestrais.length - 1; i >= 0; i -= 1) {
    const alvo = tokens(ancestrais[i]);
    for (const chave of chavesTokens) {
      if (contemSequencia(alvo, chave)) {
        return { via: "pagina_pai", forca: FORCA.pagina_pai, especificidade: chave.length };
      }
    }
  }

  return null;
}

export function melhorClientePagina({ pagina, clientes }) {
  return escolherMelhor(clientes, (chavesTokens) => casarPagina({ pagina, chavesTokens }));
}

/**
 * Um Doc + suas páginas -> as linhas de `marketing_client_doc_pages`, sem conteúdo.
 *
 * ## A regra de herança, e por que ela tem uma guarda
 *
 * Uma página sem casamento próprio herda o cliente do Doc — é o que faz "Mapeamento Estratégico -
 * Dr. Lia Garrido" continuar funcionando: o título do Doc nomeia o cliente, as páginas dele
 * ("Persona", "Oferta") não nomeiam ninguém, e todas são daquele cliente.
 *
 * A herança é DESLIGADA quando o Doc é coletivo, e é essa guarda que impede o vazamento. Em
 * "Mapeamento do Cliente", a página "Ativo" não casa com ninguém; se ela herdasse, herdaria de um
 * Doc que não é de cliente nenhum (inofensivo), mas a mesma herança num Doc cujo TÍTULO cita um
 * cliente e cujas páginas citam outros entregaria as páginas dos outros a ele.
 *
 * Coletivo = as páginas resolveram para mais de um cliente, **ou** resolveram para um cliente
 * diferente do que o Doc reivindica.
 *
 * O segundo caso é conservador de propósito e tem um custo conhecido: num Doc de um cliente só
 * onde UMA página mencione outro cliente da carteira (um concorrente que também é cliente, por
 * exemplo), a herança cai para todas as páginas e o documento aparece quase vazio. Preferi isso ao
 * contrário — documento que não aparece é reclamação, documento do cliente errado no prompt é a
 * falha que esta feature existe para não ter. O sync conta os coletivos no log justamente para esse
 * caso ficar visível se acontecer.
 */
export function linhasDasPaginas({ doc, linhaDoc, paginas, clientes }) {
  const docTemplate = ehTemplate(doc?.name);

  const proprias = paginas.map((pg) =>
    // Página chamada "Template" dentro de um Doc legítimo: mesma razão da guarda do Doc.
    docTemplate || ehTemplate(pg?.nome) ? null : melhorClientePagina({ pagina: pg, clientes })
  );

  const distintos = new Set(proprias.filter(Boolean).map((e) => e.cliente.padrao));
  const coletivo =
    distintos.size > 1 ||
    (distintos.size === 1 && Boolean(linhaDoc.cliente) && !distintos.has(linhaDoc.cliente));

  const linhas = paginas.map((pg, i) => {
    const propria = proprias[i];
    let cliente = propria?.cliente?.padrao ?? null;
    let via = propria?.via ?? null;

    if (!cliente && !coletivo && !docTemplate && linhaDoc.cliente) {
      cliente = linhaDoc.cliente;
      // A via herdada é a do Doc ('tarefa' | 'pasta' | 'nome'), não uma via nova: a tela já
      // distingue essas três forças, e inventar um quarto rótulo para dizer a mesma coisa só
      // faria a aba mostrar dois nomes para o mesmo fato.
      via = linhaDoc.atribuido_via;
    }

    return {
      page_id: String(pg.id),
      doc_id: linhaDoc.doc_id,
      pagina_pai_id: pg.pagina_pai_id ? String(pg.pagina_pai_id) : null,
      nome: String(pg.nome ?? "").trim() || "(sem título)",
      caminho: (pg.caminho ?? []).filter(Boolean).map((x) => String(x)),
      ordem: i,
      cliente,
      atribuido_via: via,
      // A data é do Doc (a listagem de páginas não traz data de edição por página), mas o tipo
      // passa pelo nome da PÁGINA antes de herdar o do Doc: uma página "Acessos" dentro de um Doc
      // de Copys herdaria `copys` e teria a credencial lida. `classificarDoc` do nome da página
      // devolve `null` justamente nesse caso; nos outros ela devolve `outro`, e aí o rótulo do Doc
      // é mais informativo e prevalece.
      tipo: classificarDoc(pg?.nome) === null ? null : linhaDoc.tipo,
      atualizado_em_clickup: linhaDoc.atualizado_em_clickup,
    };
  });

  return { linhas, coletivo };
}

/**
 * Precisa (re)enumerar as páginas deste Doc?
 *
 * Mesmo critério do conteúdo, **sem** a trava da allowlist: enumerar devolve TÍTULOS e estrutura,
 * não corpo (`lerEstruturaDoc` usa o endpoint de listagem, que não traz conteúdo). Sem enumerar um
 * Doc fora da allowlist, a página de um cliente dentro dele ficaria invisível na aba — e aparecer
 * como link é exatamente o que a allowlist permite.
 */
export function precisaEstrutura({ linha, existente }) {
  if (!existente?.estrutura_lida_em) return true;
  if (!linha.atualizado_em_clickup) return false;
  return new Date(linha.atualizado_em_clickup) > new Date(existente.estrutura_lida_em);
}

// ---------------------------------------------------------------------------------------------
// SUBPÁGINAS — uma página com subpáginas é UM documento (decisão do usuário, 20/10/2026).
// ---------------------------------------------------------------------------------------------

const idDaPagina = (p) => String(p.page_id ?? p.id);

/**
 * As subpáginas de uma página, na ordem de leitura (cada uma seguida das dela, na ordem do Doc), com
 * o caminho relativo à página escolhida. Aceita linhas do banco (`page_id`) e páginas lidas do
 * ClickUp (`id`). Uma página que apareça duas vezes na árvore entra uma vez só.
 */
export function subpaginasDe(pageId, paginas) {
  const filhos = new Map();
  for (const p of Array.isArray(paginas) ? paginas : []) {
    if (!p?.pagina_pai_id) continue;
    const pai = String(p.pagina_pai_id);
    if (!filhos.has(pai)) filhos.set(pai, []);
    filhos.get(pai).push(p);
  }
  for (const lista of filhos.values()) lista.sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
  const out = [];
  const vistas = new Set([String(pageId)]);
  const andar = (id, caminho) => {
    for (const f of filhos.get(id) ?? []) {
      const fid = idDaPagina(f);
      if (vistas.has(fid)) continue;
      vistas.add(fid);
      const rel = [...caminho, String(f.nome ?? "").trim() || "(sem título)"];
      out.push({ ...f, caminho_relativo: rel });
      andar(fid, rel);
    }
  };
  andar(String(pageId), []);
  return out;
}

/** Quantas subpáginas (de qualquer nível) cada página tem, dentro da lista dada. */
export function contarSubpaginas(paginas) {
  const lista = Array.isArray(paginas) ? paginas : [];
  return new Map(lista.map((p) => [idDaPagina(p), subpaginasDe(idDaPagina(p), lista).length]));
}

/**
 * O texto de uma página com o das subpáginas, cada uma sob um título que diz de onde veio. Subpágina
 * sem corpo não entra (o título sozinho não diz nada). `null` quando não há texto nenhum.
 *
 * @param {string|null} proprio  o corpo da página escolhida
 * @param {{ caminho_relativo: string[], conteudo_md: string|null }[]} subpaginas
 */
export function conteudoComSubpaginas(proprio, subpaginas) {
  const partes = [];
  if (String(proprio ?? "").trim()) partes.push(String(proprio).trim());
  for (const s of Array.isArray(subpaginas) ? subpaginas : []) {
    const corpo = String(s?.conteudo_md ?? "").trim();
    if (corpo) partes.push(`## Subpágina: ${s.caminho_relativo.join(" › ")}\n\n${corpo}`);
  }
  return partes.length ? partes.join("\n\n") : null;
}
