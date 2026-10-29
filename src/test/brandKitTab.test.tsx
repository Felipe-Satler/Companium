/**
 * A aba Brand kit da Central de Clientes.
 *
 * O que ela tem de acertar: a paleta fixa e a gerada em linhas separadas, e a gerada só substituir a
 * fixa depois de uma confirmação explícita — a paleta de um cliente com artes publicadas não é
 * coisa de trocar sem querer.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { BrandKitTab } from "@/components/marketing/clientes/BrandKitTab";
import { kitVazio } from "../../shared/brand-kit.js";

const obterMock = vi.fn();
const salvarMock = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: { access_token: "tok" } }),
}));

vi.mock("@/lib/brandKitApi", async () => ({
  ...(await vi.importActual<typeof import("@/lib/brandKitApi")>("@/lib/brandKitApi")),
  obterBrandKit: (...a: unknown[]) => obterMock(...a),
  salvarBrandKit: (...a: unknown[]) => salvarMock(...a),
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const comPaleta = () => ({
  ...kitVazio("dr_fulano"),
  paleta: { primaria: "#1B3A5C", secundaria: "#E0A458", terciaria: "#F5F2EC" },
});

beforeEach(() => {
  obterMock.mockReset();
  salvarMock.mockReset();
  salvarMock.mockImplementation(async (_t: string, _c: string, kit: unknown) => ({ kit, atualizado_em: "2026-10-27T12:00:00Z" }));
});

describe("BrandKitTab", () => {
  it("mostra a paleta fixa e a gerada em linhas separadas", async () => {
    obterMock.mockResolvedValue({ kit: comPaleta(), atualizado_em: null, identificacaoDoEstudo: null });
    render(<BrandKitTab cliente="dr_fulano" />, { wrapper });
    expect(await screen.findByText("Paleta fixa")).toBeInTheDocument();
    expect(screen.getByText("Paleta gerada")).toBeInTheDocument();
    expect(screen.getByLabelText("Código da primária")).toHaveValue("#1B3A5C");
  });

  it("substituir a paleta fixa pede confirmação, e só grava ao confirmar", async () => {
    obterMock.mockResolvedValue({ kit: comPaleta(), atualizado_em: null, identificacaoDoEstudo: null });
    render(<BrandKitTab cliente="dr_fulano" />, { wrapper });
    fireEvent.click(await screen.findByRole("button", { name: /Gerar paleta nova/ }));
    fireEvent.click(screen.getByRole("button", { name: "Usar esta" }));

    const dialogo = await screen.findByRole("alertdialog");
    expect(within(dialogo).getByText("Substituir a paleta fixa?")).toBeInTheDocument();
    expect(salvarMock).not.toHaveBeenCalled();

    // Manter a atual não grava nada.
    fireEvent.click(within(dialogo).getByRole("button", { name: "Manter a atual" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(salvarMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Código da primária")).toHaveValue("#1B3A5C");

    fireEvent.click(screen.getByRole("button", { name: "Usar esta" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Substituir" }));
    await waitFor(() => expect(salvarMock).toHaveBeenCalledTimes(1));
    const kitSalvo = salvarMock.mock.calls[0][2];
    expect(kitSalvo.paleta.primaria).not.toBeNull();
    expect(Object.values(kitSalvo.paleta)).not.toEqual(["#1B3A5C", "#E0A458", "#F5F2EC"]);
  });

  it("o cadeado mantém a cor da fixa na paleta gerada", async () => {
    obterMock.mockResolvedValue({ kit: comPaleta(), atualizado_em: null, identificacaoDoEstudo: null });
    render(<BrandKitTab cliente="dr_fulano" />, { wrapper });
    fireEvent.click(await screen.findByRole("button", { name: "Manter a primária ao gerar" }));
    fireEvent.click(screen.getByRole("button", { name: /Gerar paleta nova/ }));
    fireEvent.click(screen.getByRole("button", { name: "Usar esta" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Substituir" }));
    await waitFor(() => expect(salvarMock).toHaveBeenCalled());
    expect(salvarMock.mock.calls[0][2].paleta.primaria).toBe("#1B3A5C");
  });

  it("sem paleta fixa, a gerada entra sem perguntar", async () => {
    obterMock.mockResolvedValue({ kit: kitVazio("dr_fulano"), atualizado_em: null, identificacaoDoEstudo: null });
    render(<BrandKitTab cliente="dr_fulano" />, { wrapper });
    fireEvent.click(await screen.findByRole("button", { name: /Gerar paleta nova/ }));
    fireEvent.click(screen.getByRole("button", { name: "Usar esta" }));
    await waitFor(() => expect(salvarMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("preenche o médico a partir do Estudo de Copy, separando CRM e UF", async () => {
    obterMock.mockResolvedValue({
      kit: kitVazio("dr_fulano"),
      atualizado_em: null,
      identificacaoDoEstudo: { nome: "Dr. Fulano", crm: "12345/RS", rqe: "678", de: "2026-10-20T12:00:00Z" },
    });
    render(<BrandKitTab cliente="dr_fulano" />, { wrapper });
    fireEvent.click(await screen.findByRole("button", { name: /Preencher a partir do Estudo de Copy/ }));
    expect(screen.getByLabelText("Nome completo")).toHaveValue("Dr. Fulano");
    expect(screen.getByLabelText("CRM")).toHaveValue("12345");
    expect(screen.getByLabelText("RQE")).toHaveValue("678");
  });

  it("mostra ao lado do campo o que o worker recusou", async () => {
    const { ErroDoKit } = await vi.importActual<typeof import("@/lib/brandKitApi")>("@/lib/brandKitApi");
    obterMock.mockResolvedValue({ kit: kitVazio("dr_fulano"), atualizado_em: null, identificacaoDoEstudo: null });
    salvarMock.mockRejectedValue(new ErroDoKit("Alguns campos não puderam ser salvos.", [{ campo: "contatos.email", detalhe: "e-mail inválido" }]));
    render(<BrandKitTab cliente="dr_fulano" />, { wrapper });
    fireEvent.change(await screen.findByLabelText("E-mail"), { target: { value: "sem-arroba" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText("e-mail inválido")).toBeInTheDocument();
  });
});
