/**
 * Oficina de Artes › Artes Salvas: a grade da carteira e a arte aberta com os mockups.
 *
 * O filtro em si é testado puro (`oficinaUtil.test.ts`); aqui, que a grade mostra as artes, que
 * abrir uma vai para a URL e que os mockups mostram o que importa — o corte da legenda, o
 * "Patrocinado" do pago e o WhatsApp como primeira aba de quem vai circular fora do Instagram.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import MarketingArtes from "@/pages/MarketingArtes";
import type { Arte } from "@/lib/artesApi";

const listarMock = vi.fn();
const obterMock = vi.fn();
const apagarMock = vi.fn();
const ajustarMock = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: { access_token: "tok" } }),
}));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/components/marketing/mineracao/MineracaoHeader", () => ({ MineracaoHeader: () => null }));
vi.mock("@/hooks/useEspecialidades", () => ({
  useEspecialidades: () => ({ especialidadeOptions: ["Medicina do Sono"], getEspecialidades: () => ["Medicina do Sono"], loading: false }),
}));
vi.mock("@/lib/artesApi", async () => ({
  ...(await vi.importActual<typeof import("@/lib/artesApi")>("@/lib/artesApi")),
  listarArtes: (...a: unknown[]) => listarMock(...a),
  obterArte: (...a: unknown[]) => obterMock(...a),
  apagarArte: (...a: unknown[]) => apagarMock(...a),
  ajustarArte: (...a: unknown[]) => ajustarMock(...a),
}));

const LEGENDA_LONGA =
  "Ronco não é só barulho: ele pode ser o sinal mais visível de que o seu sono está sendo interrompido dezenas de vezes por hora, sem você perceber.";

function arte(over: Partial<Arte> = {}): Arte {
  return {
    id: "a1",
    composition_id: "c1",
    anuncio_indice: 0,
    cliente: "dr_fulano",
    nome_exibicao: "Dr. Fulano",
    formato_origem: "instagram_feed",
    opcoes: { uso: "organico", circula_fora: false, onde_identificar: "arte", elementos: {}, fotos: [], template: "editorial", proporcao: "4:5" },
    marca: {
      nome_clinica: "Clínica Sono Bom",
      paleta: { primaria: "#1B3A5C", secundaria: "#E0A458", terciaria: "#F5F2EC" },
      fontes: { titulo: "Inter", texto: "Inter" },
      contatos: { whatsapp: "", telefone: "", instagram: "clinicasonobom", site: "", email: "" },
      enderecos: [],
      imagens: { logo: null, logo_escuro: null },
    },
    post: {
      schema: "post_renderizavel@1",
      template: { id: "editorial", versao: "1.0.0" },
      proporcao: "4:5",
      slides: [
        { papel: "capa", titulo: "Seu ronco tem nome", foto: null, alt: "capa" },
        { papel: "conteudo", titulo: "Página dois", apoio: "x", foto: null, alt: "dois" },
      ],
      legenda: LEGENDA_LONGA,
      hashtags: ["sono"],
      identificacao: { nome: "Dr. Fulano", crm: "1", uf: "RS", rqe: "", linha: "Dr. Fulano | CRM/RS 1", naArte: true, naLegenda: false, naoEspecialista: false },
      elementos: {},
      uso: "organico",
      circula_fora: false,
    },
    avisos: [],
    status: "pronta",
    error: null,
    criado_por: "u",
    criado_em: "2026-10-28T12:00:00Z",
    atualizado_em: "2026-10-28T12:00:00Z",
    canDelete: true,
    ...over,
  } as Arte;
}

function montar(url = "/marketing/oficina/salvas") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <MarketingArtes />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  listarMock.mockReset();
  obterMock.mockReset();
  apagarMock.mockReset();
  ajustarMock.mockReset();
});

describe("Oficina › Artes Salvas", () => {
  it("mostra a grade da carteira e abre a arte clicada", async () => {
    const pago = arte({ id: "a2", nome_exibicao: "Dra. Ana", cliente: "dra_ana", opcoes: { ...arte().opcoes, uso: "pago" } });
    listarMock.mockResolvedValue({ artes: [arte(), pago] });
    obterMock.mockResolvedValue({ arte: arte() });
    montar();
    expect(await screen.findByText("2 de 2 artes")).toBeInTheDocument();
    expect(screen.getByText("Dra. Ana")).toBeInTheDocument();
    expect(screen.getByText("pago")).toBeInTheDocument();
    expect(screen.getAllByText("carrossel · 2")).toHaveLength(2);
    // Sem filtro de cliente, a listagem é a da carteira inteira.
    expect(listarMock).toHaveBeenCalledWith("tok", {});

    fireEvent.click(screen.getAllByRole("button", { name: /Seu ronco tem nome/ })[0]);
    expect(await screen.findByRole("tab", { name: "Instagram" })).toBeInTheDocument();
  });

  it("no Instagram, a legenda para no 'mais'; o Facebook mostra 'Compartilhar'", async () => {
    obterMock.mockResolvedValue({ arte: arte() });
    listarMock.mockResolvedValue({ artes: [arte()] });
    montar("/marketing/oficina/salvas?arte=a1");
    const mais = await screen.findByRole("button", { name: "… mais" });
    expect(screen.queryByText(/sem você perceber/)).not.toBeInTheDocument();
    fireEvent.click(mais);
    expect(screen.getByText(/sem você perceber/)).toBeInTheDocument();
    // Orgânico: sem "Patrocinado".
    expect(screen.queryByText("Patrocinado")).not.toBeInTheDocument();

    // O Radix troca de aba no mousedown, não no click.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Facebook" }), { button: 0 });
    expect(await screen.findByText("Compartilhar")).toBeInTheDocument();
  });

  it("pago aparece como Patrocinado", async () => {
    const pago = arte({ post: { ...arte().post!, uso: "pago" } });
    obterMock.mockResolvedValue({ arte: pago });
    listarMock.mockResolvedValue({ artes: [pago] });
    montar("/marketing/oficina/salvas?arte=a1");
    expect(await screen.findByText("Patrocinado")).toBeInTheDocument();
  });

  it("arte que vai circular fora do Instagram abre no WhatsApp, como álbum", async () => {
    const fora = arte({ opcoes: { ...arte().opcoes, circula_fora: true } });
    obterMock.mockResolvedValue({ arte: fora });
    listarMock.mockResolvedValue({ artes: [fora] });
    montar("/marketing/oficina/salvas?arte=a1");
    expect(await screen.findByRole("tab", { name: "WhatsApp", selected: true })).toBeInTheDocument();
    expect(screen.getByText("12:00")).toBeInTheDocument();
  });

  it("apagar pede confirmação e volta para a grade", async () => {
    obterMock.mockResolvedValue({ arte: arte() });
    listarMock.mockResolvedValue({ artes: [arte()] });
    apagarMock.mockResolvedValue({ ok: true });
    montar("/marketing/oficina/salvas?arte=a1");
    fireEvent.click(await screen.findByRole("button", { name: /Apagar/ }));
    expect(apagarMock).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Apagar" }));
    await waitFor(() => expect(apagarMock).toHaveBeenCalledWith("tok", "a1"));
  });

  it("no Arquivo, o fundo abstrato aparece no preview na hora e vai no salvar", async () => {
    obterMock.mockResolvedValue({ arte: arte() });
    listarMock.mockResolvedValue({ artes: [arte()] });
    ajustarMock.mockResolvedValue({ post: arte().post, avisos: [] });
    const { container } = montar("/marketing/oficina/salvas?arte=a1");
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Arquivo" }), { button: 0 });
    expect(await screen.findByRole("radio", { name: "Liso" })).toHaveAttribute("aria-checked", "true");
    expect(container.querySelector('svg[data-fundo]')).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "Ondas" }));
    expect(container.querySelector('svg[data-fundo="ondas"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Salvar ajustes/ }));
    await waitFor(() => expect(ajustarMock).toHaveBeenCalledTimes(1));
    expect(ajustarMock.mock.calls[0][2].fundo).toMatchObject({ estilo: "ondas", granulado: false });
  });
});
