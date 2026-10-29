/**
 * Oficina de Artes › Nova arte, e o endereço antigo do estático.
 *
 * O que a tela tem de acertar: o caminho cliente → anúncio → arte pela URL; o Brand kit sem CRM
 * barrar ANTES da escolha do anúncio; os anúncios que não viram arte aparecerem desabilitados, com
 * o motivo; e, na pré-etapa, travar as opções de identificação que a regra do CFM não permite.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import MarketingOficina, { RedirecionarEstatico } from "@/pages/MarketingOficina";
import { kitVazio } from "../../shared/brand-kit.js";

const composicaoMock = vi.fn();
const composicoesMock = vi.fn();
const kitMock = vi.fn();
const criarMock = vi.fn();
const listarMock = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: { access_token: "tok" } }),
}));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/components/marketing/mineracao/MineracaoHeader", () => ({ MineracaoHeader: () => null }));
vi.mock("@/hooks/useClientesVisiveis", () => ({ useClientesVisiveis: () => 0 }));
vi.mock("@/hooks/useProjetosLista", () => ({
  useProjetosLista: () => ({ index: { ativos: [{ padrao: "dr_fulano", nome: "Dr. Fulano" }] }, loading: false }),
}));
vi.mock("@/hooks/useAdComposer", () => ({
  useComposition: (id: string | null) => ({ composition: id ? composicaoMock() : null, isLoading: false, error: null }),
  useCompositions: () => ({ compositions: composicoesMock(), isLoading: false, error: null }),
}));
vi.mock("@/lib/brandKitApi", async () => ({
  ...(await vi.importActual<typeof import("@/lib/brandKitApi")>("@/lib/brandKitApi")),
  obterBrandKit: () => kitMock(),
}));
vi.mock("@/lib/artesApi", async () => ({
  ...(await vi.importActual<typeof import("@/lib/artesApi")>("@/lib/artesApi")),
  listarArtes: (...a: unknown[]) => listarMock(...a),
  criarArte: (...a: unknown[]) => criarMock(...a),
}));

const anuncioFeed = {
  formato: "instagram_feed",
  angulo: "O ronco como sinal",
  status: "ok",
  formato_justificativa: null,
  composicao_md: null,
  error: null,
  avisos: [],
  composicao: { abertura: "Ronco não é só barulho.", legenda: "L", carrossel: [], direcao_foto: "" },
};

const composicao = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  cliente: "dr_fulano",
  nome_exibicao: "Dr. Fulano",
  status: "ok",
  criado_em: "2026-10-27T12:00:00Z",
  anuncios: [anuncioFeed, { ...anuncioFeed, formato: "instagram_reels", angulo: "Um reels" }],
  plano: [
    { formato: "instagram_feed", angulo: "O ronco como sinal", status: "ok" },
    { formato: "instagram_reels", angulo: "Um reels", status: "ok" },
  ],
  ...over,
});

const kitCompleto = (over: Record<string, unknown> = {}) => ({
  ...kitVazio("dr_fulano"),
  identificacao: { nome: "Dr. Fulano", crm: "12345", uf: "RS", rqe: "", pos_graduacao: "" },
  contatos: { whatsapp: "(51) 9", telefone: "", instagram: "", site: "", email: "" },
  ...over,
});

function Endereco() {
  const { pathname, search } = useLocation();
  return <span data-testid="endereco">{pathname + search}</span>;
}

function montar(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/marketing/oficina" element={<><MarketingOficina /><Endereco /></>} />
          <Route path="/marketing/composer/estatico" element={<RedirecionarEstatico />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const radio = (nome: string) => screen.getByRole("radio", { name: nome });
const ARTE = "/marketing/oficina?cliente=dr_fulano&composicao=c1&anuncio=0";

beforeEach(() => {
  for (const m of [composicaoMock, composicoesMock, kitMock, criarMock, listarMock]) m.mockReset();
  composicaoMock.mockReturnValue(composicao());
  composicoesMock.mockReturnValue([composicao()]);
  listarMock.mockResolvedValue({ artes: [] });
  criarMock.mockResolvedValue({ id: "a1", status: "running" });
});

describe("Oficina › Nova arte", () => {
  it("sem cliente, começa pela escolha do cliente", () => {
    kitMock.mockResolvedValue({ kit: kitCompleto(), atualizado_em: null });
    montar("/marketing/oficina");
    expect(screen.getByText("De qual cliente é a arte?")).toBeInTheDocument();
  });

  it("lista os anúncios da composição salva; o de vídeo vem desabilitado, com o motivo", async () => {
    kitMock.mockResolvedValue({ kit: kitCompleto(), atualizado_em: null });
    montar("/marketing/oficina?cliente=dr_fulano");
    const feed = await screen.findByRole("button", { name: /Instagram Feed/ });
    await waitFor(() => expect(feed).not.toBeDisabled());
    expect(screen.getByRole("button", { name: /Instagram Reels/ })).toBeDisabled();
    expect(screen.getByText(/vira reels, não arte estática/)).toBeInTheDocument();
    fireEvent.click(feed);
    await waitFor(() => expect(screen.getByTestId("endereco").textContent).toContain("composicao=c1&anuncio=0"));
  });

  it("Brand kit sem CRM barra já na escolha do anúncio", async () => {
    kitMock.mockResolvedValue({ kit: kitVazio("dr_fulano"), atualizado_em: null });
    montar("/marketing/oficina?cliente=dr_fulano");
    expect(await screen.findByText(/Cadastre nome, CRM e UF/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Instagram Feed/ })).toBeDisabled();
  });

  it("composição em revisão não abre a pré-etapa", async () => {
    composicaoMock.mockReturnValue(composicao({ status: "revisao" }));
    kitMock.mockResolvedValue({ kit: kitCompleto(), atualizado_em: null });
    montar(ARTE);
    expect(await screen.findByText(/composição salva/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Gerar arte/ })).not.toBeInTheDocument();
  });

  it("orgânico sem a bio conferida: só 'Na arte'", async () => {
    kitMock.mockResolvedValue({ kit: kitCompleto({ bio_conferida: false }), atualizado_em: null });
    montar(ARTE);
    await screen.findByRole("button", { name: /Gerar arte/ });
    expect(radio("Na arte")).not.toBeDisabled();
    expect(radio("Na legenda")).toBeDisabled();
    expect(radio("Não incluir")).toBeDisabled();
  });

  it("com a bio conferida libera 'Não incluir'; pago volta a travar", async () => {
    kitMock.mockResolvedValue({ kit: kitCompleto({ bio_conferida: true }), atualizado_em: null });
    montar(ARTE);
    await screen.findByRole("button", { name: /Gerar arte/ });
    expect(radio("Não incluir")).not.toBeDisabled();
    fireEvent.click(radio("Pago (anúncio)"));
    await waitFor(() => expect(radio("Não incluir")).toBeDisabled());
    expect(radio("Na legenda")).not.toBeDisabled();
  });

  it("elemento que o kit não tem fica desligado", async () => {
    kitMock.mockResolvedValue({ kit: kitCompleto(), atualizado_em: null });
    montar(ARTE);
    await screen.findByRole("button", { name: /Gerar arte/ });
    expect(screen.getByRole("switch", { name: "Incluir WhatsApp" })).not.toBeDisabled();
    expect(screen.getByRole("switch", { name: "Incluir Instagram" })).toBeDisabled();
  });

  it("gerar manda as escolhas da pré-etapa e abre a arte nova", async () => {
    kitMock.mockResolvedValue({ kit: kitCompleto({ bio_conferida: true }), atualizado_em: null });
    montar(ARTE);
    fireEvent.click(await screen.findByRole("switch", { name: "Incluir WhatsApp" }));
    fireEvent.click(radio("Não incluir"));
    fireEvent.click(screen.getByRole("button", { name: /Gerar arte/ }));
    await waitFor(() => expect(criarMock).toHaveBeenCalledTimes(1));
    const [, pedido] = criarMock.mock.calls[0];
    expect(pedido).toMatchObject({
      compositionId: "c1",
      indice: 0,
      opcoes: { uso: "organico", circula_fora: false, onde_identificar: "nenhum", fotos: [] },
    });
    expect(pedido.opcoes.elementos.whatsapp).toBe(true);
    await waitFor(() => expect(screen.getByTestId("endereco").textContent).toContain("arte=a1"));
  });

  it("o endereço antigo do estático leva à Oficina com os mesmos parâmetros", async () => {
    kitMock.mockResolvedValue({ kit: kitCompleto(), atualizado_em: null });
    montar("/marketing/composer/estatico?composicao=c1&anuncio=0");
    await waitFor(() =>
      expect(screen.getByTestId("endereco").textContent).toMatch(/^\/marketing\/oficina\?composicao=c1&anuncio=0/)
    );
  });
});
