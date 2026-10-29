/**
 * A aba Documentos.
 *
 * O que ela tem de acertar é a diferença entre TRÊS fatos que viram a mesma tela vazia se ninguém
 * cuidar: ainda estamos lendo, não conseguimos ler, e lemos e não há documento. O segundo e o
 * terceiro dizem coisas opostas sobre o cliente.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { DocumentosTab } from "@/components/marketing/clientes/DocumentosTab";
import type { ClientDoc, ClientDocsResposta } from "@/lib/clientDocsApi";

const listMock = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: { access_token: "tok" } }),
}));

vi.mock("@/lib/clientDocsApi", async () => ({
  // As funções puras (o rótulo das subpáginas) ficam as de verdade; só a rede é trocada.
  ...(await vi.importActual<typeof import("@/lib/clientDocsApi")>("@/lib/clientDocsApi")),
  listClientDocs: (...a: unknown[]) => listMock(...a),
}));

const doc = (over: Partial<ClientDoc> = {}): ClientDoc => ({
  id: "p1",
  nome: "Estratégia 2026",
  // O Doc que contém a página. Aqui ele tem o mesmo nome do item, que é o caso do Doc de cliente
  // único — e nesse caso a aba NÃO repete o nome num cabeçalho de grupo.
  docNome: "Estratégia 2026",
  url: "https://app.clickup.com/901/v/dc/d1/p1",
  local: "Clientes › Dr. José Ramos - VascuMed › Estratégia 2026",
  via: "tarefa",
  tipo: "mapeamento_estrategico",
  temConteudo: true,
  criadoEm: "2026-07-01T12:00:00.000Z",
  atualizadoEm: "2026-09-20T12:00:00.000Z",
  arquivado: false,
  publico: false,
  ...over,
});

const resposta = (over: Partial<ClientDocsResposta> = {}): ClientDocsResposta => ({
  documentos: [doc()],
  fontes: { clickup: true },
  lidoEm: "2026-10-01T12:00:00.000Z",
  ...over,
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const mount = () => render(<DocumentosTab cliente="jose_ramos" />, { wrapper });

/**
 * Abre a gaveta dos documentos bloqueados (credencial ou template).
 *
 * O critério é `tipo === null` — nunca `temConteudo`. `temConteudo` diz só se o corpo já foi
 * PRÉ-ingerido, e a leitura sob demanda cobre o resto: esconder por ele escondia documento
 * utilizável (com 2 páginas pré-ingeridas de 6.057, escondia quase todas).
 */
async function expandirBloqueados() {
  fireEvent.click(await screen.findByRole("button", { name: /acesso\/credencial/i }));
}

describe("DocumentosTab", () => {
  beforeEach(() => listMock.mockReset());

  it("lista os documentos com caminho e link para o ClickUp", async () => {
    listMock.mockResolvedValue(resposta());
    mount();
    const link = await screen.findByRole("link", { name: /Estratégia 2026/ });
    expect(link).toHaveAttribute("href", "https://app.clickup.com/901/v/dc/d1/p1");
    // `target=_blank` sem `rel` abre o ClickUp com acesso ao `window` desta aba.
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText(/Clientes › Dr. José Ramos - VascuMed/)).toBeInTheDocument();
  });

  it("documento sem link aparece como texto — não como link quebrado", async () => {
    listMock.mockResolvedValue(resposta({ documentos: [doc({ url: null })] }));
    mount();
    await screen.findByText("Estratégia 2026");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("ClickUp fora do ar NÃO parece cliente sem documento", async () => {
    // O teste que justifica o desenho da resposta: lista vazia + `clickup: false` tem de dizer
    // "não conseguimos ler", e dizer explicitamente que isso não significa ausência de documento.
    listMock.mockResolvedValue({
      documentos: [],
      fontes: { clickup: false },
      erro: "CLICKUP_API_TOKEN ausente",
    });
    mount();
    expect(await screen.findByText(/não foi possível ler o clickup/i)).toBeInTheDocument();
    expect(screen.getByText(/CLICKUP_API_TOKEN ausente/)).toBeInTheDocument();
    expect(screen.getByText(/não quer dizer que o cliente não tenha documentos/i)).toBeInTheDocument();
    expect(screen.queryByText(/nenhum documento deste cliente/i)).not.toBeInTheDocument();
  });

  it("lemos e não há documento: diz isso, e diz como a busca casa", async () => {
    listMock.mockResolvedValue(resposta({ documentos: [] }));
    mount();
    expect(await screen.findByText(/nenhum documento deste cliente/i)).toBeInTheDocument();
    expect(screen.queryByText(/não foi possível ler o clickup/i)).not.toBeInTheDocument();
  });

  it("mostra o tipo, que é o que diz se o documento serve de insumo", async () => {
    listMock.mockResolvedValue(resposta());
    mount();
    expect(await screen.findByText("Mapeamento Estratégico")).toBeInTheDocument();
  });

  it("documento de credencial diz que o conteúdo NÃO é lido, e explica por quê", async () => {
    // Sem isto, a pessoa veria o documento aqui, não o acharia na etapa de insumos do Composer, e
    // concluiria que a ferramenta está quebrada — quando a resposta é "de propósito".
    listMock.mockResolvedValue({
      ...resposta({ documentos: [doc({ tipo: null, temConteudo: false })] }),
    });
    mount();
    await expandirBloqueados();
    // A frase aparece duas vezes de propósito: no selo da linha e na legenda, que se refere a ele.
    // Por isso `findAllByText` com âncora — `findByText` acharia os dois e falharia por ambiguidade.
    expect((await screen.findAllByText(/^conteúdo não ingerido$/i)).length).toBeGreaterThan(0);
    // A razão importa mais que a frase: quem lê precisa saber que é login e senha, não defeito.
    expect(screen.getByText(/não podem ser usados como insumo/i)).toBeInTheDocument();
    expect(screen.getByText(/login e senha de cliente/i)).toBeInTheDocument();
  });

  it("o cadeado marca, de relance, o que NÃO alimenta o Composer", async () => {
    // Com 82 dos 117 documentos sem conteúdo ingerido, quem varre a lista precisa distinguir sem
    // ler metadado. O `aria-label` carrega a razão, que é diferente nos dois casos.
    listMock.mockResolvedValue(
      resposta({
        documentos: [
          doc({ id: "a", nome: "Com corpo", temConteudo: true }),
          doc({ id: "b", nome: "Acessos", tipo: null, temConteudo: false }),
        ],
      }),
    );
    mount();
    await screen.findByText("Com corpo");
    // Fechado, o bloqueado nem está no DOM: a gaveta esconde de verdade, não só visualmente.
    expect(screen.queryByText("Acessos")).not.toBeInTheDocument();
    await expandirBloqueados();
    const cadeados = screen.getAllByLabelText(/conteúdo não ingerido|conteúdo ainda não lido/i);
    // UM cadeado: o documento ingerido não leva nenhum.
    expect(cadeados).toHaveLength(1);
    expect(cadeados[0]).toHaveAttribute("aria-label", "conteúdo não ingerido");
  });

  it("tipo reconhecido SEM corpo pré-ingerido NÃO é tratado como bloqueado", async () => {
    // A correção central: `temConteudo: false` com tipo reconhecido significa apenas "o sync ainda
    // não cacheou", e a leitura sob demanda resolve quando a pessoa abre ou compõe. Tratar isso
    // como bloqueio escondia documento que funciona.
    listMock.mockResolvedValue(
      resposta({ documentos: [doc({ nome: "Copys da Lia", tipo: "copys", temConteudo: false })] }),
    );
    mount();
    // Visível direto, sem expandir nada — e sem gaveta, porque não há nada bloqueado.
    expect(await screen.findByText("Copys da Lia")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /acesso\/credencial/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/conteúdo não ingerido/i)).not.toBeInTheDocument();
  });

  it("casamento fraco vem marcado", async () => {
    listMock.mockResolvedValue(resposta({ documentos: [doc({ via: "nome", local: null })] }));
    mount();
    expect(await screen.findByText(/casado pelo título/i)).toBeInTheDocument();
  });

  it("arquivado vem marcado", async () => {
    listMock.mockResolvedValue(resposta({ documentos: [doc({ arquivado: true })] }));
    mount();
    expect(await screen.findByText(/^arquivado$/i)).toBeInTheDocument();
  });

  it("diz de quando é a leitura — o índice é em cache no worker", async () => {
    listMock.mockResolvedValue(resposta());
    mount();
    expect(await screen.findByText(/leitura de/i)).toBeInTheDocument();
  });

  it("avisa quando a varredura foi truncada, em vez de entregar lista curta calada", async () => {
    listMock.mockResolvedValue(resposta({ truncado: true }));
    mount();
    expect(await screen.findByText(/teto de páginas/i)).toBeInTheDocument();
  });

  it("recarregar pede ao worker uma leitura nova, não a de cache", async () => {
    listMock.mockResolvedValue(resposta());
    mount();
    await screen.findByText("Estratégia 2026");
    fireEvent.click(screen.getByRole("button", { name: /recarregar/i }));
    await waitFor(() => {
      expect(listMock).toHaveBeenCalledWith("tok", "jose_ramos", true);
    });
  });
});

describe("DocumentosTab — subpáginas", () => {
  it("página com subpáginas diz quantas são — escolhê-la traz todas junto", async () => {
    listMock.mockReset().mockResolvedValue(resposta({ documentos: [doc({ nome: "Estudo de Copy: Dr. Otavio Brandt", subpaginas: 2 })] }));
    mount();
    expect(await screen.findByText("com 2 subpáginas")).toBeInTheDocument();
  });
});

describe("DocumentosTab — agrupamento por Doc", () => {
  beforeEach(() => listMock.mockReset());

  it("páginas do mesmo Doc coletivo aparecem sob o nome dele", async () => {
    // A forma real do workspace: "Mapeamento do Cliente" é um Doc com uma página por cliente. Sem o
    // cabeçalho, "Ativo › Mapeamento - Dr. José Ramos" apareceria solto, sem dizer de que documento
    // saiu — e é o nome do Doc que a pessoa reconhece do ClickUp.
    listMock.mockResolvedValue(
      resposta({
        documentos: [
          doc({ id: "pA", nome: "Mapeamento - Dr. José Ramos", docNome: "Mapeamento do Cliente", via: "pagina" }),
          doc({ id: "pB", nome: "Briefing - Dr. José Ramos", docNome: "Briefing de Conteúdo", via: "pagina" }),
        ],
      }),
    );
    mount();
    expect(await screen.findByText("Mapeamento do Cliente")).toBeInTheDocument();
    expect(screen.getByText("Briefing de Conteúdo")).toBeInTheDocument();
    expect(screen.getByText("Mapeamento - Dr. José Ramos")).toBeInTheDocument();
  });

  it("Doc de uma página só com o mesmo nome NÃO ganha cabeçalho repetido", async () => {
    // É o Doc de cliente único ("Mapeamento Estratégico - Dr. Lia Garrido"), onde Doc e documento
    // são a mesma coisa. Mostrar o título duas vezes não informa nada.
    listMock.mockResolvedValue(resposta());
    mount();
    await screen.findByRole("link", { name: /Estratégia 2026/ });
    expect(screen.getAllByText("Estratégia 2026")).toHaveLength(1);
  });
});
