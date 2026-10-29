import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Estado controlado pelos testes.
const estado = {
  auth: { user: { id: "u1" } as { id: string } | null, isApproved: true, loading: false },
  ackExiste: false,
  inserts: [] as Array<{ tabela: string; linha: unknown }>,
};

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => estado.auth }));

vi.mock("@/integrations/external-supabase/client", () => {
  const builder = (tabela: string) => {
    const b = {
      select: () => b,
      eq: () => b,
      order: () => b,
      maybeSingle: async () => ({ data: tabela === "usage_notice_acks" && estado.ackExiste ? { version: 1 } : null, error: null }),
      insert: async (linha: unknown) => {
        estado.inserts.push({ tabela, linha });
        return { error: null };
      },
      then: (ok: (v: unknown) => void) => ok({ data: [], error: null }),
    };
    return b;
  };
  return { supabase: { from: builder } };
});

import { AvisoUsoDialog } from "@/components/AvisoUsoDialog";
import Privacidade from "@/pages/Privacidade";
import { ThemeProvider } from "@/contexts/ThemeContext";

const montar = (ui: React.ReactNode, rota = "/clientes/crm") =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[rota]}>{ui}</MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );

describe("aviso de coleta de uso", () => {
  beforeEach(() => {
    estado.auth = { user: { id: "u1" }, isApproved: true, loading: false };
    estado.ackExiste = false;
    estado.inserts = [];
  });

  it("abre para quem ainda não viu e grava o Entendi com a versão", async () => {
    montar(<AvisoUsoDialog />);
    expect(await screen.findByText("Como medimos o uso do Companium")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Saiba mais" })).toHaveAttribute("href", "/privacidade");
    // Uso para avaliação de desempenho é avisado ANTES (LGPD: finalidade e transparência).
    expect(screen.getByText(/desempenho individual/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Entendi" }));
    await waitFor(() => expect(screen.queryByText("Como medimos o uso do Companium")).not.toBeInTheDocument());
    expect(estado.inserts).toEqual([{ tabela: "usage_notice_acks", linha: { user_id: "u1", version: 1 } }]);
  });

  it("não abre para quem já viu esta versão", async () => {
    estado.ackExiste = true;
    montar(<AvisoUsoDialog />);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText("Como medimos o uso do Companium")).not.toBeInTheDocument();
  });

  it("não abre na própria página de privacidade nem sem login", async () => {
    montar(<AvisoUsoDialog />, "/privacidade");
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText("Como medimos o uso do Companium")).not.toBeInTheDocument();

    estado.auth = { user: null, isApproved: false, loading: false };
    montar(<AvisoUsoDialog />);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText("Como medimos o uso do Companium")).not.toBeInTheDocument();
  });
});

describe("página /privacidade", () => {
  it("abre sem login, com o conteúdo e o convite para entrar", () => {
    estado.auth = { user: null, isApproved: false, loading: false };
    montar(<Privacidade />, "/privacidade");
    expect(screen.getByRole("heading", { name: "Dados de uso do Companium" })).toBeInTheDocument();
    expect(screen.getByText("O que não registramos")).toBeInTheDocument();
    expect(screen.getByText(/entre no Companium e volte a esta página/)).toBeInTheDocument();
    expect(screen.queryByText("Falar sobre meus dados")).not.toBeInTheDocument();
  });
});
