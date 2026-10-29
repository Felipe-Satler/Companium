/**
 * Marketing › Clientes — o card e a estrela do polling.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render as rtlRender,
  screen,
  fireEvent,
  waitFor,
  renderHook,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  ClientBriefCard,
  type ClienteCard,
  type ResumoMetricas,
} from "@/components/marketing/clientes/ClientBriefCard";
import { MineracaoHeader } from "@/components/marketing/mineracao/MineracaoHeader";
import { MemoryRouter } from "react-router-dom";
import type { ClientBrief } from "@/lib/clientBriefsApi";

const refreshMock = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: { access_token: "tok" } }),
}));

vi.mock("@/lib/clientBriefsApi", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/clientBriefsApi")>();
  return { ...real, refreshBrief: (...a: unknown[]) => refreshMock(...a) };
});

import { useRefreshBrief } from "@/hooks/useClientBriefs";

const CLIENTE: ClienteCard = {
  padrao: "jose_ramos",
  nome: "Dr. José Ramos - VascuMed",
  especialidades: ["Cirurgia Vascular"],
  plano: "Escala",
  squad: "Marina",
  mesesDeCasa: 18,
};

const METRICAS: ResumoMetricas = {
  investimento: 12000,
  leadsCRM: 150,
  consultasAgendadas: 42,
  faturamentoBruto: 96000,
  roas: 8,
};

function brief(over: Partial<ClientBrief> = {}): ClientBrief {
  return {
    cliente: "jose_ramos",
    nome_exibicao: "Dr. José Ramos - VascuMed",
    brief_md: "## Contexto Operacional\n\nCriativo novo em aprovação desde o dia 3.",
    brief: {
      contexto_operacional: "Criativo em aprovação; a fila anda uma vez por semana",
      riscos: [],
    },
    metricas: null,
    fontes: { clickup: true, supabase: true },
    status: "ok",
    error: null,
    agent_id: "briefagent",
    semana_de: "2026-09-07",
    semana_ate: "2026-09-13",
    atualizado_em: new Date().toISOString(),
    atualizado_por: null,
    ...over,
  };
}

const props = { onOpen: () => {}, onRefresh: () => {}, isRefreshing: false };

/**
 * Tudo aqui vai dentro de um Router: o card tem um link para o Composer e o cabeçalho navega.
 * Router aninhado é erro no react-router, então o wrapper é UM e fica aqui.
 */
const render = (ui: ReactNode) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

describe("ClientBriefCard", () => {
  it("rotula a janela dos números: o resumo fala de outra", () => {
    // Card = últimos 30 dias, ao vivo. Resumo = semana fechada. Sem o rótulo, pareceriam o mesmo
    // número em desacordo na mesma tela.
    render(<ClientBriefCard {...props} cliente={CLIENTE} brief={brief()} metricas={METRICAS} />);
    expect(screen.getByText(/últimos 30 dias/i)).toBeInTheDocument();
  });

  it("mostra a ficha e as métricas resumidas", () => {
    render(<ClientBriefCard {...props} cliente={CLIENTE} brief={brief()} metricas={METRICAS} />);
    expect(screen.getByText("Dr. José Ramos - VascuMed")).toBeInTheDocument();
    expect(screen.getByText("Cirurgia Vascular")).toBeInTheDocument();
    expect(screen.getByText(/Escala · Marina · 18 meses de casa/)).toBeInTheDocument();
    expect(screen.getByText("150")).toBeInTheDocument(); // leads
    expect(screen.getByText("8.0")).toBeInTheDocument(); // roas
  });

  it("sem métrica, mostra travessão — não zero", () => {
    // "não temos o dado" e "deu zero" contam histórias opostas sobre um cliente.
    render(<ClientBriefCard {...props} cliente={CLIENTE} brief={brief()} />);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(5);
    expect(screen.queryByText("R$ 0")).not.toBeInTheDocument();
  });

  it("CPL não é calculado sem leads", () => {
    render(
      <ClientBriefCard
        {...props}
        cliente={CLIENTE}
        brief={brief()}
        metricas={{ ...METRICAS, leadsCRM: 0 }}
      />,
    );
    // Sem leads, dividir daria Infinity — a tela mostra travessão.
    expect(screen.queryByText(/R\$\s?Infinity/)).not.toBeInTheDocument();
  });

  it("cliente sem contexto diz isso, e o botão continua disponível", () => {
    render(<ClientBriefCard {...props} cliente={CLIENTE} metricas={METRICAS} />);
    expect(screen.getByText(/sem contexto ainda/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /atualizar o resumo/i })).not.toBeDisabled();
    expect(screen.getByText(/nunca atualizado/i)).toBeInTheDocument();
  });

  it("enquanto o agente escreve, não dá para pedir de novo", () => {
    render(
      <ClientBriefCard {...props} cliente={CLIENTE} brief={brief({ status: "running" })} metricas={METRICAS} />,
    );
    expect(screen.getByText(/escrevendo o resumo/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /atualizar o resumo/i })).toBeDisabled();
  });

  it("falha do agente aparece no card", () => {
    render(
      <ClientBriefCard
        {...props}
        cliente={CLIENTE}
        brief={brief({ status: "error", error: "agente fora do ar", brief_md: null })}
      />,
    );
    expect(screen.getByText("agente fora do ar")).toBeInTheDocument();
  });

  it("riscos viram chips", () => {
    const b = brief({
      brief: {
        contexto_operacional: "x",
        riscos: [{ titulo: "Criativo único", gravidade: "alta", detalhe: "Só um no ar" }],
      },
    });
    render(<ClientBriefCard {...props} cliente={CLIENTE} brief={b} metricas={METRICAS} />);
    expect(screen.getByText("Criativo único")).toBeInTheDocument();
  });

  it("o botão de atualizar não abre o detalhe junto", () => {
    const onOpen = vi.fn();
    const onRefresh = vi.fn();
    render(
      <ClientBriefCard
        {...props}
        cliente={CLIENTE}
        brief={brief()}
        onOpen={onOpen}
        onRefresh={onRefresh}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /atualizar o resumo/i }));
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("MineracaoHeader", () => {
  it("ganha a Central de Clientes sem perder a Mineração", () => {
    render(<MineracaoHeader activeTab="Central de Clientes" />);
    expect(screen.getByRole("button", { name: /^mineração$/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^central de clientes$/i }).className,
    ).toContain("bg-primary");
  });
});

describe("useRefreshBrief", () => {
  let qc: QueryClient;
  const KEY = ["marketing-client-briefs"];

  beforeEach(() => {
    refreshMock.mockReset().mockResolvedValue({ ok: true });
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );

  it("marca 'running' na hora — é o que religa o polling", async () => {
    qc.setQueryData(KEY, { briefs: [brief({ status: "ok" })] });
    const { result } = renderHook(() => useRefreshBrief(), { wrapper });
    result.current.mutate("jose_ramos");
    await waitFor(() => {
      const b = qc.getQueryData<{ briefs: ClientBrief[] }>(KEY)?.briefs[0];
      expect(b?.status).toBe("running");
    });
  });

  it("cliente que ainda não tem linha também mostra 'escrevendo' na hora", async () => {
    qc.setQueryData(KEY, { briefs: [] });
    const { result } = renderHook(() => useRefreshBrief(), { wrapper });
    result.current.mutate("cliente_novo");
    await waitFor(() => {
      const briefs = qc.getQueryData<{ briefs: ClientBrief[] }>(KEY)?.briefs ?? [];
      expect(briefs).toHaveLength(1);
      expect(briefs[0].status).toBe("running");
    });
  });

  it("se a requisição falhar, o estado volta — a tela não mente", async () => {
    refreshMock.mockRejectedValue(new Error("worker fora do ar"));
    qc.setQueryData(KEY, { briefs: [brief({ status: "ok" })] });
    const { result } = renderHook(() => useRefreshBrief(), { wrapper });
    result.current.mutate("jose_ramos");
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(qc.getQueryData<{ briefs: ClientBrief[] }>(KEY)?.briefs[0].status).toBe("ok");
  });
});
