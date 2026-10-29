/**
 * `conteudoDoDocumento` — a última porta antes do prompt.
 *
 * Esta função decide o que vai ao preview da tela e ao prompt do Ad Composer. O que ela tem de
 * acertar não é "achar o conteúdo": é **nunca servir o conteúdo de uma página de outro cliente**.
 * Um id trocado na seleção levaria o mapeamento estratégico de uma conta ao anúncio de outra, e
 * nenhuma revisão da peça pronta pegaria isso — a peça fica boa, só é feita com a estratégia errada.
 *
 * Os quatro estados do contrato também são testados aqui, porque a tela depende de distinguir
 * "não conseguimos ler" de "lemos e está vazio" de "não vamos ler, por decisão".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getDocPage = vi.fn();
const lerPaginas = vi.fn();
const listPaginasDoDoc = vi.fn();

vi.mock("../../apps/ad-spy-worker/db.js", () => ({
  getDocPage: (...a: unknown[]) => getDocPage(...a),
  listPaginasDoDoc: (...a: unknown[]) => listPaginasDoDoc(...a),
}));

vi.mock("../../apps/ad-spy-worker/config.js", () => ({
  CLICKUP_API_TOKEN: "tok",
  CLICKUP_TEAM_ID: "901",
  CLICKUP_CACHE_TTL_MS: 0,
  CLICKUP_MAX_DOC_PAGES: 5,
  CLICKUP_ENV_ACEITAS: ["CLICKUP_API_TOKEN"],
}));

import * as clickup from "../../apps/ad-spy-worker/clickup.js";

const linha = (over: Record<string, unknown> = {}) => ({
  page_id: "pJose",
  doc_id: "col",
  cliente: "jose_ramos",
  tipo: "mapeamento_cliente",
  conteudo_md: "Persona do José.",
  conteudo_lido_em: "2026-10-01T12:00:00.000Z",
  ...over,
});

/**
 * A leitura preguiçosa é interceptada no `fetch`, não por spy no módulo.
 *
 * `lerPaginasDoc` vive no mesmo arquivo da função testada, e em ESM a chamada interna usa o
 * binding local — um `vi.spyOn` no namespace exportado não a vê, e o teste sai pela rede de
 * verdade. Trocar o `fetch` é o único ponto que intercepta o caminho inteiro, e de quebra exercita
 * o parser da resposta junto.
 */
type PaginaFalsa = { id: string; name?: string; content?: string; pages?: PaginaFalsa[] };
const respondeComPaginas = (paginas: PaginaFalsa[]) => {
  // Como o ClickUp: `/docs/{doc}/pages/{id}` devolve UMA página; `/docs/{doc}/pages` devolve a árvore.
  const todas: PaginaFalsa[] = [];
  const andar = (nos: PaginaFalsa[]) => nos.forEach((n) => (todas.push(n), andar(n.pages ?? [])));
  andar(paginas);
  const fetch = vi.fn(async (url: URL | string) => {
    const uma = String(url).match(/\/pages\/([^/?]+)/);
    const corpo = uma ? todas.find((p) => p.id === decodeURIComponent(uma[1])) : paginas;
    return corpo
      ? { ok: true, status: 200, json: async () => corpo }
      : { ok: false, status: 404, json: async () => ({}), text: async () => "not found" };
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
};

beforeEach(() => {
  getDocPage.mockReset();
  lerPaginas.mockReset();
  listPaginasDoDoc.mockReset().mockResolvedValue([]);
  vi.unstubAllGlobals();
});

describe("conteudoDoDocumento — a guarda de cliente", () => {
  it("recusa a página que não é do cliente pedido", async () => {
    // O caso que importa: a página existe, tem corpo, está na allowlist — e é de outra conta. Sem
    // esta guarda, a garantia de não misturar clientes dependeria de a tela mandar sempre o id
    // certo, ou seja, de um acerto na camada mais fácil de errar.
    getDocPage.mockResolvedValue(linha({ cliente: "amanda_duarte", conteudo_md: "Persona da Amanda." }));
    const out = await clickup.conteudoDoDocumento("pAmanda", { cliente: "jose_ramos" });
    expect(out!.conteudo_md).toBeNull();
    expect(out!.motivo).toMatch(/não está atribuído a este cliente/i);
  });

  it("serve a página do cliente certo", async () => {
    getDocPage.mockResolvedValue(linha());
    const out = await clickup.conteudoDoDocumento("pJose", { cliente: "jose_ramos" });
    expect(out).toMatchObject({ conteudo_md: "Persona do José." });
    expect(out!.motivo).toBeUndefined();
  });

  it("página sem cliente atribuído não é servida a cliente nenhum", async () => {
    // A página-contêiner ("Ativo") e o material interno ("Groohub") caem aqui.
    getDocPage.mockResolvedValue(linha({ cliente: null }));
    const out = await clickup.conteudoDoDocumento("pAtivo", { cliente: "jose_ramos" });
    expect(out!.conteudo_md).toBeNull();
    expect(out!.motivo).toMatch(/não está atribuído/i);
  });
});

describe("conteudoDoDocumento — os quatro estados do contrato", () => {
  it("página desconhecida: NÃO conseguimos ler", async () => {
    // Sem linha não há cliente atribuído, e servir o corpo de um documento que não sabemos de quem
    // é furaria a única garantia que esta feature tem. Vale também para um `doc_id` antigo guardado
    // numa composição anterior: ele não acha linha e degrada, em vez de servir outra coisa.
    getDocPage.mockResolvedValue(null);
    expect(await clickup.conteudoDoDocumento("inexistente", { cliente: "jose_ramos" })).toBeNull();
  });

  it("fora da allowlist: não vamos ler, por DECISÃO — e isso não é 'está vazio'", async () => {
    // Responder `conteudo_md: null` sem motivo diria "o documento está vazio", que é mentira sobre
    // um documento que tem conteúdo e que a pessoa pode abrir no ClickUp.
    getDocPage.mockResolvedValue(linha({ tipo: null }));
    const out = await clickup.conteudoDoDocumento("pJose", { cliente: "jose_ramos" });
    expect(out!.conteudo_md).toBeNull();
    expect(out!.motivo).toMatch(/não é lido por decisão/i);
  });

  it("lida e sem corpo: devolve null COM a data da leitura", async () => {
    getDocPage.mockResolvedValue(linha({ conteudo_md: "" }));
    const out = await clickup.conteudoDoDocumento("pJose", { cliente: "jose_ramos" });
    expect(out).toMatchObject({ conteudo_md: null, lidoEm: "2026-10-01T12:00:00.000Z" });
  });

  it("ainda não lida: busca no ClickUp e devolve SÓ a página pedida", async () => {
    // Leitura preguiçosa, para quem acabou de escrever a página não esperar o timer. Ela lê o Doc
    // inteiro (é uma chamada) mas devolve uma página — e não grava, porque gravar exigiria atribuir,
    // que é trabalho do sync.
    getDocPage.mockResolvedValue(linha({ conteudo_md: null, conteudo_lido_em: null }));
    respondeComPaginas([
      { id: "pAmanda", name: "Amanda", content: "Persona da Amanda." },
      { id: "pJose", name: "José", content: "Persona do José." },
    ]);
    const out = await clickup.conteudoDoDocumento("pJose", { cliente: "jose_ramos" });
    expect(out!.conteudo_md).toBe("Persona do José.");
    expect(out!.conteudo_md).not.toContain("Amanda");
  });
});

// ---------------------------------------------------------------------------------------------
// Subpáginas (20/10/2026): a página escolhida traz o texto das subpáginas do MESMO cliente. O caso
// real: o Estudo de Copy do Dr. Otavio é uma página de corpo vazio com o texto numa subpágina, e
// até aqui a leitura só via o primeiro nível do Doc — a subpágina nunca tinha conteúdo.
// ---------------------------------------------------------------------------------------------

describe("conteudoDoDocumento — página com subpáginas", () => {
  const ESTUDO = linha({
    page_id: "pEstudo",
    doc_id: "dAndrei",
    cliente: "otavio",
    tipo: "outro",
    nome: "Estudo de Copy: Dr. Otavio Brandt",
    conteudo_md: "",
  });
  const SUB = {
    page_id: "pSub",
    doc_id: "dAndrei",
    pagina_pai_id: "pEstudo",
    nome: "1. Estudo de Copy – Tricologia e Transplante Capilar - Dr. Otavio Brandt",
    ordem: 1,
    cliente: "otavio",
    tipo: "outro",
    conteudo_md: null,
    // O sync nunca leu a subpágina: é o estado em que o banco está hoje.
    conteudo_lido_em: null,
  };
  const DE_OUTRO = { ...SUB, page_id: "pOutro", nome: "Rascunho de outra conta", ordem: 2, cliente: "jose_ramos" };
  const respondeComPaginasDoEstudo = () =>
    respondeComPaginas([
      {
        id: "pEstudo",
        name: "Estudo de Copy: Dr. Otavio Brandt",
        content: "",
        pages: [
          { id: "pSub", name: SUB.nome, content: "Avatares Base (Níveis de Consciência)" },
          { id: "pOutro", name: DE_OUTRO.nome, content: "Texto de outra conta." },
        ],
      },
    ]);

  it("traz o texto da subpágina, lido do ClickUp página a página, e diz quantas são", async () => {
    getDocPage.mockResolvedValue(ESTUDO);
    listPaginasDoDoc.mockResolvedValue([ESTUDO, SUB, DE_OUTRO]);

    const fetch = respondeComPaginasDoEstudo();
    const out = await clickup.conteudoDoDocumento("pEstudo", { cliente: "otavio" });
    expect(out!.conteudo_md).toBe(`## Subpágina: ${SUB.nome}\n\nAvatares Base (Níveis de Consciência)`);
    // Só a que falta, sozinha: a de cima já foi lida pelo sync (corpo vazio), e o Doc inteiro
    // (2.364 páginas no caso real) estoura o tempo do ClickUp, então ele nem é pedido.
    expect(fetch.mock.calls.map((c) => String(c[0]))).toEqual([expect.stringContaining("/docs/dAndrei/pages/pSub?")]);
    // A subpágina atribuída a outro cliente não entra — a guarda vale para as subpáginas também.
    expect(out!.conteudo_md).not.toContain("outra conta");
    expect(out!.subpaginas).toBe(1);
  });

  it("subpágina já lida pelo sync vem do banco, sem ir ao ClickUp", async () => {
    getDocPage.mockResolvedValue(ESTUDO);
    listPaginasDoDoc.mockResolvedValue([ESTUDO, { ...SUB, conteudo_md: "Do banco.", conteudo_lido_em: "2026-10-20T00:00:00Z" }]);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const out = await clickup.conteudoDoDocumento("pEstudo", { cliente: "otavio" });
    expect(out!.conteudo_md).toContain("Do banco.");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("o ClickUp falha: não conseguimos ler — e o motivo vai para o log, não some", async () => {
    getDocPage.mockResolvedValue({ ...SUB, conteudo_md: null, conteudo_lido_em: null });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ err: "Team not authorized" }), text: async () => "Team not authorized" })));
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await clickup.conteudoDoDocumento("pSub", { cliente: "otavio" })).toBeNull();
    expect(erro.mock.calls.map((c) => String(c[0])).join("\n")).toMatch(/conteúdo de pSub .*falhou/);
    erro.mockRestore();
  });
});
