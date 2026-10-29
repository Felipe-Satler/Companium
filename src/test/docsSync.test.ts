/**
 * O sync dos documentos do ClickUp, agora em três etapas: listar Docs, enumerar as páginas de cada
 * um, baixar o corpo de quem é da allowlist.
 *
 * Quatro comportamentos valem teste, e nenhum deles é "funciona":
 *
 * 1. **Não misturar clientes.** O workspace é feito de Docs coletivos — "Mapeamento do Cliente" tem
 *    uma página por cliente —, e o corpo de uma página não pode acabar atribuído a outro. É a falha
 *    que esta feature existe para não ter: ela não aparece na tela, aparece numa peça criativa
 *    feita com a estratégia de outra conta.
 * 2. **O incremental é incremental**, nas duas chamadas caras (enumerar e baixar). Se o sync
 *    reenumerar o workspace a cada execução, a feature funciona e a conta não fecha.
 * 3. **A allowlist é respeitada no caminho da rede.** Não basta a linha sair sem tipo: o corpo não
 *    pode nem ser PEDIDO, senão a credencial de cliente já atravessou para a memória do processo.
 * 4. **A varredura não apaga a tabela quando a leitura é duvidosa.** É o modo de falha mais caro:
 *    uma listagem truncada ou vazia apagaria documentos que existem.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const lerDocs = vi.fn();
const lerEstruturaDoc = vi.fn();
const lerPaginasDoc = vi.fn();
const lerPaginasUmaAUma = vi.fn();
const resolverPai = vi.fn();
const upsertClientDocs = vi.fn();
const upsertDocPages = vi.fn();
const deleteDocsNaoVistos = vi.fn();
const deleteDocPagesNaoVistas = vi.fn();
const readDocsSyncState = vi.fn();
const readDocPagesState = vi.fn();
const readClickupParents = vi.fn();
const upsertClickupParents = vi.fn();
const readProjetosLista = vi.fn();

vi.mock("../../apps/ad-spy-worker/clickup.js", () => ({
  clickupHabilitado: () => true,
  teamId: async () => "901",
  lerDocs: (...a: unknown[]) => lerDocs(...a),
  lerEstruturaDoc: (...a: unknown[]) => lerEstruturaDoc(...a),
  lerPaginasDoc: (...a: unknown[]) => lerPaginasDoc(...a),
  lerPaginasUmaAUma: (...a: unknown[]) => lerPaginasUmaAUma(...a),
  resolverPai: (...a: unknown[]) => resolverPai(...a),
}));

vi.mock("../../apps/ad-spy-worker/db.js", () => ({
  readProjetosLista: (...a: unknown[]) => readProjetosLista(...a),
  readDocsSyncState: (...a: unknown[]) => readDocsSyncState(...a),
  readDocPagesState: (...a: unknown[]) => readDocPagesState(...a),
  readClickupParents: (...a: unknown[]) => readClickupParents(...a),
  upsertClickupParents: (...a: unknown[]) => upsertClickupParents(...a),
  upsertClientDocs: (...a: unknown[]) => upsertClientDocs(...a),
  upsertDocPages: (...a: unknown[]) => upsertDocPages(...a),
  deleteDocsNaoVistos: (...a: unknown[]) => deleteDocsNaoVistos(...a),
  deleteDocPagesNaoVistas: (...a: unknown[]) => deleteDocPagesNaoVistas(...a),
  dbEnabled: () => true,
}));

import { sincronizarDocs } from "../../apps/ad-spy-worker/docs-sync.js";

const PROJETOS = [
  { cliente: "Dr. José Ramos - VascuMed", status: "Ativo", data_inicio: "2025-01-10" },
  { cliente: "Dra. Amanda Duarte", status: "Ativo", data_inicio: "2025-01-10" },
  { cliente: "Dr. Lia Garrido", status: "Ativo", data_inicio: "2025-01-10" },
];

/**
 * A data de edição do documento da fixture, e as duas datas de leitura relativas a ela.
 *
 * Derivadas do timestamp em vez de escritas à mão: a primeira versão deste teste tinha
 * `date_updated` em setembro de 2025 e "última leitura" em agosto de 2026 — ou seja, lida DEPOIS da
 * edição —, e o caso "foi editado, rebaixe" não exercitava nada.
 */
const EDITADO_MS = 1_759_000_000_000;
const ANTES = new Date(EDITADO_MS - 30 * 86400000).toISOString();
const DEPOIS = new Date(EDITADO_MS + 30 * 86400000).toISOString();

const doc = (over: Record<string, unknown> = {}) => ({
  id: "d1",
  name: "Mapeamento Estratégico",
  parent: { id: "86a3qeth0", type: 1 },
  date_created: 1_750_000_000_000,
  date_updated: EDITADO_MS,
  archived: false,
  public: false,
  ...over,
});

/** Uma página como `lerEstruturaDoc` a devolve. */
const pg = (id: string, nome: string, caminho: string[] = [], pai: string | null = null) => ({
  id,
  nome,
  pagina_pai_id: pai,
  caminho,
});

/** O estado "já lido" de um Doc, para os testes do incremental. */
const emDia = (over: Record<string, unknown> = {}) => ({
  doc_id: "d1",
  atualizado_em_clickup: new Date(EDITADO_MS).toISOString(),
  conteudo_lido_em: DEPOIS,
  estrutura_lida_em: DEPOIS,
  tipo: "mapeamento_estrategico",
  ...over,
});

const PAI_TAREFA = {
  kind: "task",
  nome: "Dr. José Ramos - VascuMed",
  cadeia: ["Carteira", "Clientes Ativos", "Dr. José Ramos - VascuMed"],
};

beforeEach(() => {
  for (const m of [
    lerDocs, lerEstruturaDoc, lerPaginasDoc, lerPaginasUmaAUma, resolverPai, upsertClientDocs, upsertDocPages,
    deleteDocsNaoVistos, deleteDocPagesNaoVistas, readDocsSyncState, readDocPagesState,
    readClickupParents, upsertClickupParents, readProjetosLista,
  ]) m.mockReset();

  readProjetosLista.mockResolvedValue(PROJETOS);
  readDocsSyncState.mockResolvedValue([]);
  readDocPagesState.mockResolvedValue([]);
  readClickupParents.mockResolvedValue(new Map());
  upsertClickupParents.mockResolvedValue(1);
  upsertClientDocs.mockImplementation(async (rows: unknown[]) => rows.length);
  upsertDocPages.mockImplementation(async (rows: unknown[]) => rows.length);
  deleteDocsNaoVistos.mockResolvedValue(0);
  deleteDocPagesNaoVistas.mockResolvedValue(0);
  resolverPai.mockResolvedValue(PAI_TAREFA);
  lerEstruturaDoc.mockResolvedValue([pg("p1", "Persona")]);
  lerPaginasDoc.mockResolvedValue([{ id: "p1", nome: "Persona", pagina_pai_id: null, conteudo_md: "Mulheres 35-50." }]);
});

/** As linhas de Doc que foram ao banco, por doc_id. */
const linhaDoc = (docId: string) => {
  const rows = upsertClientDocs.mock.calls[0][0] as Record<string, unknown>[];
  return rows.find((r) => r.doc_id === docId);
};

/** As linhas de página que foram ao banco. */
const paginas = () => upsertDocPages.mock.calls[0][0] as Record<string, unknown>[];
const pagina = (pageId: string) => paginas().find((r) => r.page_id === pageId);

// ================================================================================================
// 1. Não misturar clientes — o que esta mudança existe para garantir.
// ================================================================================================

describe("sincronizarDocs — Doc coletivo", () => {
  /** A forma real do workspace: um Doc, uma página "Ativo", uma página por cliente dentro dela. */
  const coletivo = () => {
    lerDocs.mockResolvedValue({
      docs: [doc({ id: "col", name: "Mapeamento do Cliente", parent: { id: "w1", type: 12 } })],
      truncado: false,
    });
    resolverPai.mockResolvedValue({ kind: "desconhecido", nome: null, cadeia: [] });
    lerEstruturaDoc.mockResolvedValue([
      pg("pAtivo", "Ativo"),
      pg("pJose", "Mapeamento - Dr. José Ramos", ["Ativo"], "pAtivo"),
      pg("pAmanda", "Mapeamento - Dra. Amanda Duarte", ["Ativo"], "pAtivo"),
    ]);
    lerPaginasDoc.mockResolvedValue([
      { id: "pAtivo", nome: "Ativo", pagina_pai_id: null, conteudo_md: "" },
      { id: "pJose", nome: "Mapeamento - Dr. José Ramos", pagina_pai_id: "pAtivo", conteudo_md: "Persona do José." },
      { id: "pAmanda", nome: "Mapeamento - Dra. Amanda Duarte", pagina_pai_id: "pAtivo", conteudo_md: "Persona da Amanda." },
    ]);
  };

  it("cada página fica com o SEU cliente, e o corpo de uma não encosta na outra", async () => {
    // O caso que o desenho anterior não cobria: ele via um Doc com dois clientes, chamava de empate
    // e não atribuía a ninguém. Pior: o corpo era UM texto com os dois dentro, então "consertar" a
    // atribuição no nível do Doc entregaria a estratégia da Amanda ao anúncio do José.
    coletivo();
    await sincronizarDocs({});

    expect(pagina("pJose")).toMatchObject({
      cliente: "jose_ramos",
      atribuido_via: "pagina",
      conteudo_md: "Persona do José.",
    });
    expect(pagina("pAmanda")).toMatchObject({
      cliente: "amanda_duarte",
      atribuido_via: "pagina",
      conteudo_md: "Persona da Amanda.",
    });

    // A prova do que importa: nenhuma linha carrega o texto de um cliente com o nome do outro.
    for (const linha of paginas()) {
      if (linha.cliente === "jose_ramos") expect(String(linha.conteudo_md ?? "")).not.toContain("Amanda");
      if (linha.cliente === "amanda_duarte") expect(String(linha.conteudo_md ?? "")).not.toContain("José");
    }
  });

  it("a página-contêiner ('Ativo') não herda cliente nenhum", async () => {
    // Ela é a prateleira, não o documento. Se herdasse, herdaria de um Doc coletivo — e seria o
    // caminho de volta para o campo com 66 clientes dentro.
    coletivo();
    const r = await sincronizarDocs({});
    expect(pagina("pAtivo")!.cliente).toBeNull();
    expect(r.coletivos).toBe(1);
  });

  it("subpágina herda o cliente da página ACIMA dela", async () => {
    lerDocs.mockResolvedValue({
      docs: [doc({ id: "col", name: "Mapeamento do Cliente", parent: { id: "w1", type: 12 } })],
      truncado: false,
    });
    resolverPai.mockResolvedValue({ kind: "desconhecido", nome: null, cadeia: [] });
    lerEstruturaDoc.mockResolvedValue([
      pg("pJose", "Dr. José Ramos"),
      pg("pOferta", "Oferta", ["Dr. José Ramos"], "pJose"),
      pg("pAmanda", "Dra. Amanda Duarte"),
    ]);
    lerPaginasDoc.mockResolvedValue([]);
    await sincronizarDocs({});
    expect(pagina("pOferta")).toMatchObject({ cliente: "jose_ramos", atribuido_via: "pagina_pai" });
  });
});

describe("sincronizarDocs — herança do Doc e a guarda dela", () => {
  it("Doc de um cliente só passa o cliente para as páginas que não se nomeiam", async () => {
    // É o caso que já funcionava e não pode regredir: o título do Doc nomeia o cliente, as páginas
    // dele ("Persona", "Oferta") não nomeiam ninguém, e todas são daquele cliente.
    lerDocs.mockResolvedValue({
      docs: [doc({ id: "lia", name: "Mapeamento Estratégico - Dr. Lia Garrido", parent: { id: "w1", type: 12 } })],
      truncado: false,
    });
    resolverPai.mockResolvedValue({ kind: "desconhecido", nome: null, cadeia: [] });
    lerEstruturaDoc.mockResolvedValue([pg("pA", "Persona"), pg("pB", "Oferta")]);
    lerPaginasDoc.mockResolvedValue([
      { id: "pA", nome: "Persona", pagina_pai_id: null, conteudo_md: "corpo A" },
      { id: "pB", nome: "Oferta", pagina_pai_id: null, conteudo_md: "corpo B" },
    ]);
    await sincronizarDocs({});
    expect(pagina("pA")).toMatchObject({ cliente: "lia_garrido", atribuido_via: "nome" });
    expect(pagina("pB")).toMatchObject({ cliente: "lia_garrido", atribuido_via: "nome" });
  });

  it("página de OUTRO cliente dentro do Doc desliga a herança — não atribui no lugar de errar", async () => {
    // Conservador de propósito, e o custo é conhecido: o documento aparece quase vazio. Documento
    // que não aparece é reclamação; documento do cliente errado no prompt é a falha que não pode
    // acontecer. `coletivos` no retorno é o que torna este caso visível se ele ocorrer.
    lerDocs.mockResolvedValue({
      docs: [doc({ id: "mix", name: "Mapeamento Estratégico - Dr. Lia Garrido", parent: { id: "w1", type: 12 } })],
      truncado: false,
    });
    resolverPai.mockResolvedValue({ kind: "desconhecido", nome: null, cadeia: [] });
    lerEstruturaDoc.mockResolvedValue([pg("pA", "Persona"), pg("pJose", "Dr. José Ramos")]);
    lerPaginasDoc.mockResolvedValue([]);
    const r = await sincronizarDocs({});
    expect(pagina("pJose")!.cliente).toBe("jose_ramos");
    expect(pagina("pA")!.cliente).toBeNull();
    expect(r.coletivos).toBe(1);
  });
});

describe("sincronizarDocs — templates", () => {
  it("template não tem tipo, não tem cliente e não tem corpo pedido", async () => {
    // Seis Docs do workspace são moldes em branco, e o nome deles casa com a allowlist justamente
    // por serem o molde. Alimentar o Composer com formulário vazio é pior do que não alimentar: o
    // modelo preenche os espaços com invenção e o resultado parece fundamentado.
    lerDocs.mockResolvedValue({
      docs: [doc({ id: "tpl", name: "Template - Mapeamento Estratégico" })],
      truncado: false,
    });
    await sincronizarDocs({});
    expect(lerPaginasDoc).not.toHaveBeenCalled();
    expect(linhaDoc("tpl")).toMatchObject({ tipo: null, cliente: null });
    expect(pagina("p1")).toMatchObject({ cliente: null, tipo: null });
  });
});

// ================================================================================================
// 2. O incremental, nas duas chamadas caras.
// ================================================================================================

describe("sincronizarDocs — o incremental", () => {
  it("documento novo tem as páginas enumeradas e o conteúdo baixado", async () => {
    lerDocs.mockResolvedValue({ docs: [doc()], truncado: false });
    const r = await sincronizarDocs({});
    expect(lerEstruturaDoc).toHaveBeenCalledTimes(1);
    expect(lerPaginasDoc).toHaveBeenCalledTimes(1);
    expect(r.conteudosLidos).toBe(1);
    expect(pagina("p1")).toMatchObject({
      conteudo_md: "Mulheres 35-50.",
      conteudo_chars: "Mulheres 35-50.".length,
    });
    // As duas datas de leitura ficam no Doc: é por elas que a próxima execução decide.
    expect(linhaDoc("d1")).toMatchObject({ estrutura_lida_em: expect.any(String), conteudo_lido_em: expect.any(String) });
  });

  it("documento que NÃO mudou desde a leitura não custa chamada nenhuma", async () => {
    // É o teste que protege a conta: em regime, quase todo documento cai aqui. Enumerar é uma
    // chamada por Doc, e o workspace tem 117.
    lerDocs.mockResolvedValue({ docs: [doc()], truncado: false });
    readDocsSyncState.mockResolvedValue([emDia()]);
    readDocPagesState.mockResolvedValue([
      { page_id: "p1", doc_id: "d1", pagina_pai_id: null, nome: "Persona", caminho: [], ordem: 0, conteudo_lido_em: DEPOIS },
    ]);
    const r = await sincronizarDocs({});
    expect(lerEstruturaDoc).not.toHaveBeenCalled();
    expect(lerPaginasDoc).not.toHaveBeenCalled();
    expect(r.conteudosLidos).toBe(0);
    // Mas a página continua gravada e reatribuída: a carteira muda, e um cliente novo precisa
    // receber seus documentos sem esperar que o ClickUp marque o Doc como editado.
    expect(pagina("p1")).toMatchObject({ cliente: "jose_ramos" });
  });

  it("editado DEPOIS da última leitura reenumera e rebaixa", async () => {
    lerDocs.mockResolvedValue({ docs: [doc()], truncado: false });
    readDocsSyncState.mockResolvedValue([emDia({ conteudo_lido_em: ANTES, estrutura_lida_em: ANTES })]);
    await sincronizarDocs({});
    expect(lerEstruturaDoc).toHaveBeenCalledTimes(1);
    expect(lerPaginasDoc).toHaveBeenCalledTimes(1);
  });

  it("quem não foi rebaixado NÃO manda as chaves de conteúdo no upsert", async () => {
    // A armadilha do PostgREST: o upsert é `merge-duplicates`, então chave AUSENTE preserva o valor
    // antigo e chave com null o APAGA. Mandar `conteudo_md: null` aqui zeraria o corpo de toda
    // página que não mudou — ou seja, o sync destruiria o insumo do Composer em silêncio.
    lerDocs.mockResolvedValue({ docs: [doc()], truncado: false });
    readDocsSyncState.mockResolvedValue([emDia()]);
    readDocPagesState.mockResolvedValue([
      { page_id: "p1", doc_id: "d1", pagina_pai_id: null, nome: "Persona", caminho: [], ordem: 0, conteudo_lido_em: DEPOIS },
    ]);
    await sincronizarDocs({});
    const linha = pagina("p1")!;
    expect("conteudo_md" in linha).toBe(false);
    expect("conteudo_lido_em" in linha).toBe(false);
  });

  it("linhas com e sem conteúdo vão no MESMO array heterogêneo — quem fatia é o db.js", async () => {
    // O PostgREST recusa com 400 um insert em lote cujos objetos não tenham todas as mesmas chaves.
    // Este teste afirma o CONTRATO com `upsertDocPages`: o sync entrega heterogêneo de propósito.
    // Se alguém "simplificar" o db.js para um POST único, o 400 volta — e é aqui que a intenção
    // fica escrita.
    lerDocs.mockResolvedValue({ docs: [doc({ id: "novo" }), doc({ id: "velho" })], truncado: false });
    readDocsSyncState.mockResolvedValue([emDia({ doc_id: "velho" })]);
    readDocPagesState.mockResolvedValue([
      { page_id: "pv", doc_id: "velho", pagina_pai_id: null, nome: "Persona", caminho: [], ordem: 0, conteudo_lido_em: DEPOIS },
    ]);
    lerEstruturaDoc.mockResolvedValue([pg("pn", "Persona")]);
    lerPaginasDoc.mockResolvedValue([{ id: "pn", nome: "Persona", pagina_pai_id: null, conteudo_md: "corpo" }]);
    await sincronizarDocs({});

    const assinaturas = new Set(paginas().map((r) => Object.keys(r).sort().join("|")));
    expect(assinaturas.size).toBe(2);
    expect(pagina("pn")).toHaveProperty("conteudo_md");
    expect("conteudo_md" in pagina("pv")!).toBe(false);
  });
});

// ================================================================================================
// 3. A allowlist no caminho da rede.
// ================================================================================================

describe("sincronizarDocs — a allowlist no caminho da rede", () => {
  it("documento fora da allowlist tem as páginas enumeradas, mas o corpo NUNCA pedido", async () => {
    // "Acessos" guarda login e senha. Enumerar é seguro — `lerEstruturaDoc` usa o endpoint de
    // listagem, que devolve títulos e não corpo — e é necessário, porque a página de um cliente
    // dentro de um Doc genérico tem de aparecer como link. Pedir o CORPO é o que não pode: se a
    // requisição acontecer, a credencial já atravessou para a memória do nosso processo.
    lerDocs.mockResolvedValue({ docs: [doc({ id: "seg", name: "Acessos" })], truncado: false });
    const r = await sincronizarDocs({});
    expect(lerEstruturaDoc).toHaveBeenCalledTimes(1);
    expect(lerPaginasDoc).not.toHaveBeenCalled();
    expect(r.semTipo).toBe(1);
    expect(pagina("p1")).toMatchObject({ tipo: null, cliente: "jose_ramos" });
    expect("conteudo_md" in pagina("p1")!).toBe(false);
    // Continua listado: a pessoa clica e vai ao ClickUp.
    expect(linhaDoc("seg")).toMatchObject({ url: "https://app.clickup.com/901/v/dc/seg" });
  });
});

// ================================================================================================
// 4. As guardas: varredura, falhas parciais, resolução de pai.
// ================================================================================================

describe("sincronizarDocs — a guarda da varredura", () => {
  it("sync saudável varre Docs e páginas que sumiram do ClickUp", async () => {
    lerDocs.mockResolvedValue({ docs: [doc()], truncado: false });
    deleteDocsNaoVistos.mockResolvedValue(3);
    deleteDocPagesNaoVistas.mockResolvedValue(7);
    const r = await sincronizarDocs({});
    expect(r.removidas).toBe(3);
    expect(r.removidasPaginas).toBe(7);
  });

  it("listagem TRUNCADA não varre — há documentos que não vimos", async () => {
    lerDocs.mockResolvedValue({ docs: [doc()], truncado: true });
    const r = await sincronizarDocs({});
    expect(deleteDocsNaoVistos).not.toHaveBeenCalled();
    expect(deleteDocPagesNaoVistas).not.toHaveBeenCalled();
    expect(r.varreduraPulada).toBe(true);
  });

  it("listagem VAZIA não varre — leitura vazia é falha, não workspace vazio", async () => {
    // Mesma regra de `coletarFichas`, que se recusa a tratar planilha vazia como "nenhum ativo".
    lerDocs.mockResolvedValue({ docs: [], truncado: false });
    const r = await sincronizarDocs({});
    expect(deleteDocPagesNaoVistas).not.toHaveBeenCalled();
    expect(r.varreduraPulada).toBe(true);
  });

  it("sync de UM cliente não varre — ele não viu os documentos dos outros", async () => {
    lerDocs.mockResolvedValue({ docs: [doc()], truncado: false });
    await sincronizarDocs({ cliente: "jose_ramos" });
    expect(deleteDocsNaoVistos).not.toHaveBeenCalled();
    expect(deleteDocPagesNaoVistas).not.toHaveBeenCalled();
  });

  it("sync de UM cliente só paga o corpo dos Docs que têm página dele", async () => {
    lerDocs.mockResolvedValue({ docs: [doc()], truncado: false });
    await sincronizarDocs({ cliente: "amanda_duarte" });
    // A fixture é do José: nada a baixar para a Amanda.
    expect(lerPaginasDoc).not.toHaveBeenCalled();
  });
});

describe("sincronizarDocs — falhas parciais", () => {
  it("enumeração negada vira UMA linha sintética, e o corpo não é pedido", async () => {
    // 21 tarefas-pai do workspace respondem 401 OAUTH_027 e a pasta 90131707316 responde
    // ACCESS_022: permissão, a resolver no ClickUp. O Doc não pode desaparecer da aba por isso — a
    // pessoa continua vendo nome e link, que é tudo que um Doc sem corpo lido daria de qualquer
    // forma. E sem saber as páginas não há onde gravar o corpo de cada uma, então nem se pede: o
    // campo único com tudo concatenado é exatamente o que esta mudança desfez.
    lerDocs.mockResolvedValue({ docs: [doc()], truncado: false });
    lerEstruturaDoc.mockRejectedValue(new Error("ClickUp recusou (401) em docs: OAUTH_027"));
    const r = await sincronizarDocs({});
    expect(r.semAcesso).toBe(1);
    expect(r.semPaginas).toBe(1);
    expect(lerPaginasDoc).not.toHaveBeenCalled();
    expect(pagina("doc:d1")).toMatchObject({ doc_id: "d1", nome: "Mapeamento Estratégico" });
    // A data de enumeração NÃO é gravada: a próxima execução tenta de novo.
    expect("estrutura_lida_em" in linhaDoc("d1")!).toBe(false);
  });

  it("falha ao ler UM conteúdo não derruba o sync nem marca como lido", async () => {
    lerDocs.mockResolvedValue({ docs: [doc()], truncado: false });
    lerPaginasDoc.mockRejectedValue(new Error("429"));
    const r = await sincronizarDocs({});
    expect(r.conteudosLidos).toBe(0);
    expect("conteudo_lido_em" in pagina("p1")!).toBe(false);
    expect("conteudo_lido_em" in linhaDoc("d1")!).toBe(false);
  });

  it("página enumerada que o endpoint de corpo não devolve fica sem conteúdo, não 'lida e vazia'", async () => {
    lerDocs.mockResolvedValue({ docs: [doc()], truncado: false });
    lerEstruturaDoc.mockResolvedValue([pg("p1", "Persona"), pg("p2", "Oferta")]);
    lerPaginasDoc.mockResolvedValue([{ id: "p1", nome: "Persona", pagina_pai_id: null, conteudo_md: "corpo" }]);
    await sincronizarDocs({});
    expect(pagina("p1")).toHaveProperty("conteudo_md");
    expect("conteudo_md" in pagina("p2")!).toBe(false);
  });
});

describe("sincronizarDocs — resolução de pai", () => {
  it("pai já conhecido não é resolvido de novo", async () => {
    lerDocs.mockResolvedValue({ docs: [doc()], truncado: false });
    readClickupParents.mockResolvedValue(new Map([["86a3qeth0", PAI_TAREFA]]));
    await sincronizarDocs({});
    expect(resolverPai).not.toHaveBeenCalled();
  });

  it("vários documentos do MESMO pai resolvem uma vez só", async () => {
    // Na medição, 74 de 100 documentos compartilhavam um pai. Resolver por documento repetiria a
    // mesma chamada 74 vezes, a cada sync, para sempre.
    lerDocs.mockResolvedValue({
      docs: [doc({ id: "a" }), doc({ id: "b" }), doc({ id: "c" })],
      truncado: false,
    });
    await sincronizarDocs({});
    expect(resolverPai).toHaveBeenCalledTimes(1);
  });

  it("falha ao resolver um pai não derruba o sync", async () => {
    lerDocs.mockResolvedValue({
      docs: [doc({ name: "Mapeamento Estratégico" })],
      truncado: false,
    });
    resolverPai.mockRejectedValue(new Error("rede"));
    const r = await sincronizarDocs({});
    // Sem pai, o documento ainda pode ser atribuído pelo título — e aqui nem o título do Doc nem o
    // da página citam cliente.
    expect(r.total).toBe(1);
    expect(linhaDoc("d1")!.cliente).toBeNull();
    expect(pagina("p1")!.cliente).toBeNull();
  });
});

describe("sincronizarDocs — limite de taxa", () => {
  it("429 é contado e nomeado, e não marca o Doc como lido", async () => {
    // A primeira execução depois da migração enumera as páginas dos 117 Docs do zero, somadas às
    // leituras de corpo — é a hora em que o 429 aparece. O desenho já lida (sem
    // `estrutura_lida_em` gravado, a próxima execução tenta de novo), mas um 429 contado é a
    // diferença entre "rode de novo" e meia hora procurando um bug que não existe.
    lerDocs.mockResolvedValue({ docs: [doc()], truncado: false });
    lerEstruturaDoc.mockRejectedValue(new Error("ClickUp 429 em docs: rate limit"));
    const r = await sincronizarDocs({});
    expect(r.estourouLimite).toBe(1);
    // Não entra como "sem acesso": a causa é outra e o conserto é outro.
    expect(r.semAcesso).toBe(0);
    expect("estrutura_lida_em" in linhaDoc("d1")!).toBe(false);
  });
});


// --- Doc coletivo grande (20/10/2026) ---------------------------------------------------------------
//
// A "Central de Copy" da Groohub (todos os clientes num Doc só) tem 2.364 páginas, e o `/pages` do Doc inteiro estoura o tempo do
// ClickUp ("500 context deadline exceeded"). As páginas de cliente são lidas uma a uma.

describe("Doc grande: corpo lido página a página, só as de cliente", () => {
  const lidasUmaAUma = (ids: string[]) => ({
    conteudos: new Map(ids.map((id) => [id, `Texto de ${id}.`])),
    erros: new Map(),
    limiteDeTaxa: false,
  });
  const ESTRUTURA_GRANDE = [
    pg("pJose", "Estudo de Copy - Dr. José Ramos - VascuMed"),
    pg("pAmanda", "Estudo de Copy - Dra. Amanda Duarte"),
    ...Array.from({ length: 300 }, (_, i) => pg(`r${i}`, `Rascunho ${i}`)),
  ];

  beforeEach(() => {
    lerDocs.mockResolvedValue({ docs: [doc({ name: "Central de Copy" })], truncado: false });
    // Um Doc numa pasta da agência, não de um cliente: só as páginas com nome de cliente têm dono.
    resolverPai.mockResolvedValue({ kind: "folder", nome: "Marketing", cadeia: ["Marketing"] });
    lerEstruturaDoc.mockResolvedValue(ESTRUTURA_GRANDE);
    lerPaginasUmaAUma.mockImplementation(async (_t: string, _d: string, ids: string[]) => lidasUmaAUma(ids));
  });

  it("não pede o Doc inteiro; lê só as páginas de cliente e marca o Doc como lido", async () => {
    await sincronizarDocs({ log: () => {} });
    expect(lerPaginasDoc).not.toHaveBeenCalled();
    expect(lerPaginasUmaAUma).toHaveBeenCalledTimes(1);
    expect([...lerPaginasUmaAUma.mock.calls[0][2]].sort()).toEqual(["pAmanda", "pJose"]);
    expect(pagina("pJose")).toMatchObject({ cliente: "jose_ramos", conteudo_md: "Texto de pJose." });
    expect(pagina("r0")).not.toHaveProperty("conteudo_md");
    expect(linhaDoc("d1")).toHaveProperty("conteudo_lido_em");
  });

  it("leitura incompleta grava o que leu e NÃO marca o Doc como lido — a próxima execução continua", async () => {
    lerPaginasUmaAUma.mockImplementation(async (_t: string, _d: string, ids: string[]) => lidasUmaAUma(ids.slice(0, 1)));
    await sincronizarDocs({ log: () => {} });
    expect(paginas().filter((p) => "conteudo_md" in p)).toHaveLength(1);
    expect(linhaDoc("d1")).not.toHaveProperty("conteudo_lido_em");
  });

  it("o recarregar de UM cliente lê só as páginas dele", async () => {
    await sincronizarDocs({ cliente: "amanda_duarte", log: () => {} });
    expect(lerPaginasUmaAUma).toHaveBeenCalledTimes(1);
    expect(lerPaginasUmaAUma.mock.calls[0][2]).toEqual(["pAmanda"]);
  });

  it("Doc pequeno cujo pedido inteiro estoura o tempo cai para página a página", async () => {
    lerEstruturaDoc.mockResolvedValue(ESTRUTURA_GRANDE.slice(0, 5));
    lerPaginasDoc.mockRejectedValue(new Error("ClickUp 500 em workspaces/901/docs/d1/pages: context deadline exceeded"));
    await sincronizarDocs({ log: () => {} });
    expect(lerPaginasUmaAUma).toHaveBeenCalledTimes(1);
    expect(pagina("pAmanda")).toMatchObject({ conteudo_md: "Texto de pAmanda." });
  });

  it("página de cliente sem leitura faz o Doc voltar à fila; a sem dono, não", async () => {
    readDocsSyncState.mockResolvedValue([emDia({ tipo: "outro" })]);
    readDocPagesState.mockResolvedValue([
      { page_id: "r1", doc_id: "d1", cliente: null, tipo: "outro", conteudo_lido_em: null },
    ]);
    // A estrutura está em dia, então o worker conhece o Doc pelas páginas guardadas — e lê o corpo
    // pelo caminho que o tamanho dele pede. O que importa aqui é SE ele volta à fila.
    const leuOCorpo = () => lerPaginasDoc.mock.calls.length + lerPaginasUmaAUma.mock.calls.length;
    await sincronizarDocs({ log: () => {} });
    expect(leuOCorpo()).toBe(0);

    readDocPagesState.mockResolvedValue([
      { page_id: "pJose", doc_id: "d1", cliente: "jose_ramos", tipo: "outro", conteudo_lido_em: null },
    ]);
    upsertClientDocs.mockClear();
    upsertDocPages.mockClear();
    await sincronizarDocs({ log: () => {} });
    expect(leuOCorpo()).toBe(1);
  });
});
