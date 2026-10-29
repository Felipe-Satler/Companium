/**
 * Atribuição de documento do ClickUp -> cliente.
 *
 * O risco desta feature não é a tela nem a requisição: é o documento ir para o cliente ERRADO.
 * Antes isso seria um link fora de lugar; agora o conteúdo vai ao prompt do Composer, então o erro
 * vira peça criativa feita com a estratégia de outro cliente. Por isso quase todo caso aqui é
 * sobre o que **não** casa, e o resto é sobre desempate.
 *
 * As fixtures usam a estrutura real medida no workspace: não existe espaço "Clientes" (os espaços
 * são Comercial, RevOps, MktOps, Gestão, Tech), e a unidade de atribuição é a **PÁGINA** dentro do
 * Doc — "Mapeamento do Cliente" é um Doc coletivo com uma página por cliente. A tarefa-pai continua
 * sendo sinal, mas deixou de ser O sinal quando se descobriu que a tarefa 86a43dceu se chama
 * "Mapeamento Estratégico" e não nomeia cliente nenhum.
 */
import { describe, it, expect } from "vitest";
import {
  casarDoc,
  casarPagina,
  chavesEmTokens,
  docUrl,
  linhaDoDoc,
  linhasDasPaginas,
  melhorCliente,
  melhorClientePagina,
  precisaConteudo,
  precisaEstrutura,
} from "../../apps/ad-spy-worker/docs-atribuicao.js";

const JOSE = {
  padrao: "jose_ramos",
  nome: "Dr. José Ramos - VascuMed",
  chaves: ["dr_jose_ramos_vascumed", "jose_ramos", "vascumed"],
};
const LIA = { padrao: "lia_garrido", nome: "Dra. Lia Garrido", chaves: ["dra_lia_garrido", "lia_garrido"] };
const CLARA = { padrao: "clarice_mendes", nome: "Clarice Mendes", chaves: ["clarice_mendes"] };
const CLARA_ODONTO = {
  padrao: "clarice_mendes_odonto",
  nome: "Clarice Mendes Odonto",
  chaves: ["clarice_mendes_odonto"],
};
const CARTEIRA = [JOSE, LIA, CLARA, CLARA_ODONTO];

/** O pai como `resolverPai` devolve: a tarefa do cliente, dentro de lista e pasta. */
const paiTarefa = (nome: string) => ({
  kind: "task",
  nome,
  cadeia: ["Clientes Ativos", "Carteira MktOps", nome],
});
const paiLista = (nome: string) => ({ kind: "list", nome, cadeia: ["MktOps", nome] });
const paiDesconhecido = { kind: "desconhecido", nome: null, cadeia: [] };

const doc = (over: Record<string, unknown> = {}) => ({
  id: "d1",
  name: "Mapeamento Estratégico",
  parent: { id: "86a3qeth0", type: 1 },
  date_created: 1_750_000_000_000,
  date_updated: 1_759_000_000_000,
  archived: false,
  public: false,
  ...over,
});

describe("chavesEmTokens", () => {
  it("limpa o honorífico e o sufixo da clínica, chegando ao slug do dashboard", () => {
    // A tarefa no ClickUp é "Dr. José Ramos - VascuMed" e o slug é "jose_ramos": sem a
    // canonicalização o cliente ficaria com zero documento e pareceria não ter nenhum.
    const chaves = chavesEmTokens(JOSE).map((t: string[]) => t.join("_"));
    expect(chaves).toContain("jose_ramos");
  });

  it("recusa chave de uma palavra só", () => {
    // Um cliente chamado "Vida" casaria com qualquer documento que mencionasse "vida".
    expect(chavesEmTokens({ padrao: "vida", nome: "Vida", chaves: ["vida"] })).toEqual([]);
  });

  it("ordena da mais específica para a menos", () => {
    const tam = chavesEmTokens(JOSE).map((t: string[]) => t.length);
    expect(tam).toEqual([...tam].sort((a, b) => b - a));
  });
});

describe("casarDoc", () => {
  it("o pai ser a TAREFA do cliente é o sinal mais forte", () => {
    const r = casarDoc({
      doc: doc(),
      pai: paiTarefa("Dr. José Ramos - VascuMed"),
      chavesTokens: chavesEmTokens(JOSE),
    });
    expect(r).toMatchObject({ via: "tarefa" });
  });

  it("casa pela lista quando o cliente nomeia a lista", () => {
    const r = casarDoc({
      doc: doc({ parent: { id: "9013219864", type: 12 } }),
      pai: paiLista("Dra. Lia Garrido"),
      chavesTokens: chavesEmTokens(LIA),
    });
    expect(r).toMatchObject({ via: "pasta" });
  });

  it("acha o cliente no TÍTULO quando o pai não o nomeia", () => {
    // O caso real: "Mapeamento Estratégico - Dr. Lia Garrido" numa lista genérica. É por isso que
    // o casamento por título deixou de ser de chave inteira e passou a ser por sequência de tokens.
    const r = casarDoc({
      doc: doc({ name: "Mapeamento Estratégico - Dr. Lia Garrido" }),
      pai: paiLista("Mapeamentos"),
      chavesTokens: chavesEmTokens(LIA),
    });
    expect(r).toMatchObject({ via: "nome" });
  });

  it("não casa dentro de palavra — a fronteira é o token", () => {
    const r = casarDoc({
      doc: doc({ name: "Claramente um documento interno" }),
      pai: paiDesconhecido,
      chavesTokens: chavesEmTokens(CLARA),
    });
    expect(r).toBeNull();
  });

  it("documento de outro cliente não casa", () => {
    const r = casarDoc({
      doc: doc(),
      pai: paiTarefa("Dra. Lia Garrido"),
      chavesTokens: chavesEmTokens(JOSE),
    });
    expect(r).toBeNull();
  });
});

describe("melhorCliente — o desempate que a versão anterior não sabia fazer", () => {
  it("entre nomes encaixados, o mais específico ganha", () => {
    // "Clarice Mendes Odonto - Plano" casa com `clarice_mendes` E com `clarice_mendes_odonto`. A primeira
    // versão avaliava um cliente por requisição e, sem poder comparar, tinha de recusar os dois.
    const r = melhorCliente({
      doc: doc({ name: "Clarice Mendes Odonto - Plano" }),
      pai: paiDesconhecido,
      clientes: CARTEIRA,
    });
    expect(r?.cliente.padrao).toBe("clarice_mendes_odonto");
  });

  it("a via mais forte ganha da chave mais específica", () => {
    // Pai = tarefa de Clarice Mendes, título citando Clarice Mendes Odonto. O registro do cliente no
    // ClickUp vale mais que a menção no título.
    const r = melhorCliente({
      doc: doc({ name: "Comparativo com Clarice Mendes Odonto" }),
      pai: paiTarefa("Clarice Mendes"),
      clientes: CARTEIRA,
    });
    expect(r).toMatchObject({ via: "tarefa" });
    expect(r?.cliente.padrao).toBe("clarice_mendes");
  });

  it("empate REAL não escolhe: devolve null", () => {
    // Dois clientes homônimos na mesma força e especificidade. Mostrar o documento no cliente
    // errado é pior do que não atribuir — a linha fica visível sem cliente.
    const gemeos = [
      { padrao: "a_b", nome: "A B", chaves: ["a_b"] },
      { padrao: "a_b_2", nome: "A B", chaves: ["a_b"] },
    ];
    expect(melhorCliente({ doc: doc({ name: "Plano A B" }), pai: paiDesconhecido, clientes: gemeos })).toBeNull();
  });

  it("documento de ninguém fica sem cliente, não no primeiro da lista", () => {
    const r = melhorCliente({
      doc: doc({ name: "Processo interno de onboarding" }),
      pai: paiLista("Processos"),
      clientes: CARTEIRA,
    });
    expect(r).toBeNull();
  });
});

describe("linhaDoDoc", () => {
  it("monta a linha com cliente, via, caminho, link e tipo", () => {
    const linha = linhaDoDoc({
      doc: doc({ name: "Mapeamento Estratégico" }),
      pai: paiTarefa("Dr. José Ramos - VascuMed"),
      clientes: CARTEIRA,
      workspaceId: "901",
    });
    expect(linha).toMatchObject({
      doc_id: "d1",
      cliente: "jose_ramos",
      atribuido_via: "tarefa",
      local: "Clientes Ativos › Carteira MktOps › Dr. José Ramos - VascuMed",
      url: "https://app.clickup.com/901/v/dc/d1",
      tipo: "mapeamento_estrategico",
      parent_type: 1,
    });
  });

  it("documento fora da allowlist entra na linha SEM tipo — é o que impede a leitura do conteúdo", () => {
    const linha = linhaDoDoc({
      doc: doc({ name: "Acessos" }),
      pai: paiTarefa("Dr. José Ramos - VascuMed"),
      clientes: CARTEIRA,
      workspaceId: "901",
    });
    // Ele é do cliente, aparece na aba e tem link. O que ele não tem é tipo — e sem tipo,
    // `precisaConteudo` nunca manda baixar.
    expect(linha.cliente).toBe("jose_ramos");
    expect(linha.tipo).toBeNull();
    expect(precisaConteudo({ linha, existente: null })).toBe(false);
  });

  it("data inválida vira null, não 'Invalid Date'", () => {
    const linha = linhaDoDoc({
      doc: doc({ date_created: 0, date_updated: null }),
      pai: paiDesconhecido,
      clientes: CARTEIRA,
      workspaceId: "901",
    });
    expect(linha.criado_em_clickup).toBeNull();
    expect(linha.atualizado_em_clickup).toBeNull();
  });
});

describe("precisaConteudo — o motor do sync incremental", () => {
  const linha = {
    tipo: "mapeamento_estrategico",
    atualizado_em_clickup: "2026-09-20T12:00:00.000Z",
  };

  it("documento novo precisa", () => {
    expect(precisaConteudo({ linha, existente: null })).toBe(true);
  });

  it("editado depois da última leitura precisa", () => {
    expect(
      precisaConteudo({ linha, existente: { conteudo_lido_em: "2026-09-01T12:00:00.000Z" } }),
    ).toBe(true);
  });

  it("não mudou desde a leitura NÃO precisa — é o que torna o sync barato", () => {
    expect(
      precisaConteudo({ linha, existente: { conteudo_lido_em: "2026-09-30T12:00:00.000Z" } }),
    ).toBe(false);
  });

  it("sem tipo nunca precisa, mesmo sendo novo", () => {
    expect(precisaConteudo({ linha: { ...linha, tipo: null }, existente: null })).toBe(false);
  });

  it("Doc lido mas com página ainda sem leitura precisa, mesmo sem edição — a autocorreção das subpáginas", () => {
    const lido = { conteudo_lido_em: "2026-09-30T12:00:00.000Z" };
    expect(precisaConteudo({ linha, existente: lido, temPaginaSemConteudo: true })).toBe(true);
    expect(precisaConteudo({ linha: { ...linha, tipo: null }, existente: lido, temPaginaSemConteudo: true })).toBe(false);
  });
});

describe("docUrl", () => {
  it("monta o link, que a API não devolve", () => {
    expect(docUrl("901", "8ckab-1")).toBe("https://app.clickup.com/901/v/dc/8ckab-1");
  });

  it("sem workspace ou sem id, não inventa link", () => {
    expect(docUrl("", "d1")).toBeNull();
    expect(docUrl("901", "")).toBeNull();
  });
});

// ================================================================================================
// PÁGINAS — a unidade de atribuição de verdade neste workspace.
// ================================================================================================

const pagina = (nome: string, caminho: string[] = []) => ({
  id: "pg",
  nome,
  pagina_pai_id: caminho.length ? "pai" : null,
  caminho,
});

describe("casarPagina", () => {
  it("o título da própria página é o sinal mais forte", () => {
    // É a convenção observada: a página do cliente se chama "Mapeamento - Dra. Lia Garrido". Não é
    // indício como o título de um Doc coletivo — é o nome que alguém deu para dizer de quem ela é.
    expect(casarPagina({ pagina: pagina("Mapeamento - Dra. Lia Garrido"), chavesTokens: chavesEmTokens(LIA) }))
      .toMatchObject({ via: "pagina" });
  });

  it("página ancestral passa o cliente para as subpáginas", () => {
    expect(
      casarPagina({ pagina: pagina("Oferta", ["Ativo", "Dra. Lia Garrido"]), chavesTokens: chavesEmTokens(LIA) }),
    ).toMatchObject({ via: "pagina_pai" });
  });

  it("o ancestral MAIS PRÓXIMO ganha: ele é o mais específico", () => {
    expect(
      casarPagina({
        pagina: pagina("Oferta", ["Clarice Mendes", "Clarice Mendes Odonto"]),
        chavesTokens: chavesEmTokens(CLARA_ODONTO),
      }),
    ).toMatchObject({ via: "pagina_pai" });
    // E a cliente de nome encaixado não é arrastada pelo ancestral externo quando o interno é da
    // outra: quem decide entre as duas é `melhorClientePagina`, por especificidade.
    expect(
      melhorClientePagina({ pagina: pagina("Oferta", ["Clarice Mendes Odonto"]), clientes: CARTEIRA })?.cliente.padrao,
    ).toBe("clarice_mendes_odonto");
  });

  it("menção solta no meio de outra palavra não casa", () => {
    // A mesma fronteira de token que protege o casamento por título de Doc.
    expect(casarPagina({ pagina: pagina("Claramente um rascunho"), chavesTokens: chavesEmTokens(CLARA) })).toBeNull();
  });

  it("página genérica não casa com ninguém", () => {
    expect(casarPagina({ pagina: pagina("Persona"), chavesTokens: chavesEmTokens(LIA) })).toBeNull();
  });
});

describe("linhasDasPaginas — Doc coletivo", () => {
  const linhaColetiva = {
    doc_id: "col",
    cliente: null,
    atribuido_via: null,
    nome: "Mapeamento do Cliente",
    tipo: "mapeamento_cliente",
    atualizado_em_clickup: "2026-09-20T12:00:00.000Z",
  };

  const paginasColetivas = [
    { id: "pAtivo", nome: "Ativo", pagina_pai_id: null, caminho: [] },
    { id: "pJose", nome: "Mapeamento - Dr. José Ramos", pagina_pai_id: "pAtivo", caminho: ["Ativo"] },
    { id: "pLara", nome: "Mapeamento - Dra. Lia Garrido", pagina_pai_id: "pAtivo", caminho: ["Ativo"] },
  ];

  it("cada página fica com o seu cliente, e o Doc é marcado como coletivo", () => {
    // O desenho anterior via "dois clientes num Doc", chamava de empate e não atribuía a ninguém —
    // recusando justamente o caso mais comum do workspace.
    const { linhas, coletivo } = linhasDasPaginas({
      doc: { name: "Mapeamento do Cliente" },
      linhaDoc: linhaColetiva,
      paginas: paginasColetivas,
      clientes: CARTEIRA,
    });
    expect(coletivo).toBe(true);
    expect(linhas.find((l) => l.page_id === "pJose")).toMatchObject({ cliente: "jose_ramos", atribuido_via: "pagina" });
    expect(linhas.find((l) => l.page_id === "pLara")).toMatchObject({ cliente: "lia_garrido", atribuido_via: "pagina" });
    expect(linhas.find((l) => l.page_id === "pAtivo")!.cliente).toBeNull();
  });

  it("guarda o caminho e a ordem: documento tem ordem de leitura", () => {
    const { linhas } = linhasDasPaginas({
      doc: { name: "Mapeamento do Cliente" },
      linhaDoc: linhaColetiva,
      paginas: paginasColetivas,
      clientes: CARTEIRA,
    });
    expect(linhas.map((l) => l.ordem)).toEqual([0, 1, 2]);
    expect(linhas.find((l) => l.page_id === "pJose")!.caminho).toEqual(["Ativo"]);
  });
});

describe("linhasDasPaginas — herança do Doc", () => {
  const linhaLara = {
    doc_id: "d1",
    cliente: "lia_garrido",
    atribuido_via: "tarefa",
    nome: "Mapeamento Estratégico - Dra. Lia Garrido",
    tipo: "mapeamento_estrategico",
    atualizado_em_clickup: "2026-09-20T12:00:00.000Z",
  };

  it("Doc de um cliente só passa o cliente às páginas genéricas, com a via DELE", () => {
    const { linhas, coletivo } = linhasDasPaginas({
      doc: { name: linhaLara.nome },
      linhaDoc: linhaLara,
      paginas: [
        { id: "pA", nome: "Persona", pagina_pai_id: null, caminho: [] },
        { id: "pB", nome: "Oferta", pagina_pai_id: null, caminho: [] },
      ],
      clientes: CARTEIRA,
    });
    expect(coletivo).toBe(false);
    expect(linhas.every((l) => l.cliente === "lia_garrido" && l.atribuido_via === "tarefa")).toBe(true);
  });

  it("página de OUTRO cliente desliga a herança — não atribuir é melhor que atribuir errado", () => {
    // Custo conhecido: o documento aparece quase vazio. Preferível ao contrário — documento que não
    // aparece é reclamação, documento do cliente errado no prompt é a falha que esta feature existe
    // para não ter.
    const { linhas, coletivo } = linhasDasPaginas({
      doc: { name: linhaLara.nome },
      linhaDoc: linhaLara,
      paginas: [
        { id: "pA", nome: "Persona", pagina_pai_id: null, caminho: [] },
        { id: "pJose", nome: "Dr. José Ramos", pagina_pai_id: null, caminho: [] },
      ],
      clientes: CARTEIRA,
    });
    expect(coletivo).toBe(true);
    expect(linhas.find((l) => l.page_id === "pJose")!.cliente).toBe("jose_ramos");
    expect(linhas.find((l) => l.page_id === "pA")!.cliente).toBeNull();
  });

  it("template não atribui nada, nem pelas páginas", () => {
    const { linhas } = linhasDasPaginas({
      doc: { name: "Template - Mapeamento Estratégico" },
      linhaDoc: { ...linhaLara, nome: "Template - Mapeamento Estratégico", tipo: null },
      paginas: [{ id: "pJose", nome: "Mapeamento - Dr. José Ramos", pagina_pai_id: null, caminho: [] }],
      clientes: CARTEIRA,
    });
    // Nem o título da página salva um molde: um formulário em branco com o nome do cliente no
    // exemplo não é o documento dele.
    expect(linhas[0].cliente).toBeNull();
  });
});

describe("precisaEstrutura", () => {
  const linha = { atualizado_em_clickup: "2026-09-20T12:00:00.000Z" };

  it("Doc nunca enumerado precisa", () => {
    expect(precisaEstrutura({ linha, existente: null })).toBe(true);
    expect(precisaEstrutura({ linha, existente: { estrutura_lida_em: null } })).toBe(true);
  });

  it("editado depois da enumeração precisa reenumerar: pode ter página nova", () => {
    expect(precisaEstrutura({ linha, existente: { estrutura_lida_em: "2026-09-01T12:00:00.000Z" } })).toBe(true);
  });

  it("não mudou desde a enumeração NÃO precisa — é uma chamada por Doc, e o workspace tem 117", () => {
    expect(precisaEstrutura({ linha, existente: { estrutura_lida_em: "2026-09-30T12:00:00.000Z" } })).toBe(false);
  });

  it("não depende da allowlist: enumerar devolve títulos, não corpo", () => {
    // Sem isto, a página de um cliente dentro de um Doc genérico ficaria invisível na aba — e
    // aparecer como link é exatamente o que a allowlist permite.
    expect(precisaEstrutura({ linha: { ...linha, tipo: null }, existente: null })).toBe(true);
  });
});


// --- Subpáginas (20/10/2026) ---------------------------------------------------------------------

import { conteudoComSubpaginas, contarSubpaginas, subpaginasDe } from "../../apps/ad-spy-worker/docs-atribuicao.js";

describe("subpáginas de uma página", () => {
  const pg = (page_id: string, pagina_pai_id: string | null, ordem: number, nome = page_id) => ({ page_id, pagina_pai_id, ordem, nome });
  const PAGINAS = [pg("a", null, 1), pg("a2", "a", 3), pg("a1", "a", 2), pg("a1x", "a1", 4), pg("b", null, 5)];

  it("em ordem de leitura: cada uma seguida das dela, na ordem do Doc, com o caminho relativo", () => {
    expect(subpaginasDe("a", PAGINAS).map((p) => [p.page_id, p.caminho_relativo.join(" › ")])).toEqual([
      ["a1", "a1"],
      ["a1x", "a1 › a1x"],
      ["a2", "a2"],
    ]);
    expect(subpaginasDe("b", PAGINAS)).toEqual([]);
  });

  it("conta as de qualquer nível", () => {
    const n = contarSubpaginas(PAGINAS);
    expect([n.get("a"), n.get("a1"), n.get("a1x"), n.get("b")]).toEqual([3, 1, 0, 0]);
  });

  it("o texto junta a página e as subpáginas com corpo, cada uma sob o próprio título", () => {
    expect(
      conteudoComSubpaginas("", [
        { caminho_relativo: ["Parte 1"], conteudo_md: "Um." },
        { caminho_relativo: ["Parte 1", "Anexo"], conteudo_md: "  " },
        { caminho_relativo: ["Parte 2"], conteudo_md: "Dois." },
      ]),
    ).toBe("## Subpágina: Parte 1\n\nUm.\n\n## Subpágina: Parte 2\n\nDois.");
    expect(conteudoComSubpaginas("", [{ caminho_relativo: ["x"], conteudo_md: null }])).toBeNull();
  });
});
