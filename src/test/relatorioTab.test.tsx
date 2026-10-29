/**
 * A escolha de período da aba Relatório.
 *
 * O que mudou: o período de COMPARAÇÃO deixou de ser um interruptor ("comparar com o anterior") e
 * passou a ser um range exato, na mesma gramática da aba CRM da tela Clientes. O que este teste
 * protege é a consequência disso — enquanto a janela vinha da regra compartilhada com o worker, o
 * tamanho dela era garantido; agora não é, e o relatório precisa DIZER quando deixou de ser.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";

const mocks = () => {
  vi.doMock("@/hooks/useClientReports", () => ({
    useClientReports: () => ({ relatorios: [], error: null }),
    useClientReport: () => ({ relatorio: null }),
    useCreateClientReport: () => ({ mutate: vi.fn(), isPending: false }),
    useDeleteClientReport: () => ({ mutate: vi.fn(), isPending: false, variables: null }),
    useRenameClientReport: () => ({ mutate: vi.fn(), isPending: false }),
  }));
  // Os hooks de número só montam junto com o botão de gerar; devolvem o bastante para não quebrar.
  const vazio = { loading: false, error: null, totals: {}, orcamentoParado: null, origemFunnel: [], resolveBasis: () => ({}), overrides: null };
  vi.doMock("@/hooks/useAdsRowsCanonicalizadas", () => ({ useAdsRowsCanonicalizadas: () => ({ adsRows: [], loading: false, error: null }) }));
  vi.doMock("@/hooks/useCRMClienteData", () => ({ useCRMClienteData: () => vazio }));
  vi.doMock("@/hooks/useClientesMetas", () => ({ useClientesMetas: () => ({ resolveMeta: () => null, loading: false }) }));
  vi.doMock("@/hooks/useMetaAdsCriativosData", () => ({ useMetaAdsCriativosData: () => ({ anuncios: [], loading: false, error: null }) }));
  vi.doMock("@/hooks/useAdAnalysis", () => ({ fetchAdAnalyses: async () => ({}) }));
};

const cliente = { padrao: "diego", nome: "Dr. Diego Rezende" } as never;

async function montar() {
  mocks();
  const { RelatorioTab } = await import("@/components/marketing/clientes/RelatorioTab");
  render(
    <TooltipProvider>
      <RelatorioTab cliente={cliente} />
    </TooltipProvider> as ReactNode,
  );
}

/** Abre um `DateRangePicker` pelo seu nome acessível e aplica um preset. */
const aplicarPreset = (gatilho: HTMLElement, preset: RegExp) => {
  fireEvent.click(gatilho);
  fireEvent.click(screen.getByRole("button", { name: preset }));
};

/**
 * Escolhe um modo no select de comparação.
 *
 * O Escape no fim não é zelo: enquanto o popover do Radix está aberto, o resto da página fica com
 * `aria-hidden`, e `getByRole` ignora subárvore escondida — o seletor de data ao lado some das
 * buscas por papel mesmo estando na tela. No navegador o popover fecha sozinho ao escolher; no
 * jsdom não fecha.
 */
const escolherModo = async (rotulo: string) => {
  fireEvent.click(screen.getByRole("combobox"));
  fireEvent.click(await screen.findByText(rotulo));
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
};

/** O caminho completo até um relatório comparativo: período, e então ligar a comparação. */
const comPeriodoEComparacao = async () => {
  aplicarPreset(screen.getByRole("button", { name: "Período a analisar" }), /^Último mês$/);
  await escolherModo("Comparar com outro período");
  await waitFor(() => expect(screen.getByText(/será comparado com/i)).toBeInTheDocument());
};

beforeEach(() => vi.resetModules());
afterEach(() => vi.resetModules());

describe("RelatorioTab — escolha dos dois períodos", () => {
  it("o PADRÃO é não comparar", async () => {
    // Comparar é a decisão mais forte desta tela — ela muda o que o agente pode afirmar — e vinha
    // ligada sozinha, então saía relatório comparativo sem ninguém ter pedido.
    await montar();
    expect(screen.getByText("Sem comparação")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Período de comparação" })).not.toBeInTheDocument();

    aplicarPreset(screen.getByRole("button", { name: "Período a analisar" }), /^Último mês$/);
    await waitFor(() => expect(screen.getByText(/período simples/i)).toBeInTheDocument());
    expect(screen.queryByText(/será comparado com/i)).not.toBeInTheDocument();
  });

  it("o interruptor virou um seletor, com o período de comparação ao lado", async () => {
    await montar();
    // O antigo "Comparar com período anterior" não existe mais: ele não deixava escolher CONTRA O
    // QUÊ comparar, que é o ponto daquela mudança.
    expect(screen.queryByLabelText(/comparar com período anterior/i)).not.toBeInTheDocument();
    await escolherModo("Comparar com outro período");
    expect(screen.getByRole("button", { name: "Período de comparação" })).toBeInTheDocument();
  });

  it("ao ligar a comparação, a janela vem da REGRA", async () => {
    // Quem liga e não mexe mais gera a comparação que a regra compartilhada define — a mesma que o
    // worker confere.
    await montar();
    await comPeriodoEComparacao();
    expect(screen.getByText(/metas são mensais/i)).toBeInTheDocument();
    expect(screen.queryByText(/escolhido à mão/i)).not.toBeInTheDocument();
  });

  it("janela escolhida à mão se declara, e oferece a volta para a sugerida", async () => {
    await montar();
    await comPeriodoEComparacao();

    aplicarPreset(screen.getByRole("button", { name: "Período de comparação" }), /^Últimos 7 dias$/);
    await waitFor(() => expect(screen.getByText(/escolhido à mão/i)).toBeInTheDocument());

    // Sete dias contra um mês: o relatório precisa dizer que contagem não se compara, senão o
    // agente conclui "caiu pela metade" de uma janela que é metade do tamanho.
    expect(screen.getByText(/não são comparáveis entre janelas de tamanhos diferentes/i)).toBeInTheDocument();
    // E a volta existe: sem ela, mexer uma vez no comparável seria um caminho sem retorno.
    expect(screen.getByRole("button", { name: /usar a janela sugerida/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /usar a janela sugerida/i }));
    await waitFor(() => expect(screen.queryByText(/escolhido à mão/i)).not.toBeInTheDocument());
  });

  it("voltar para 'Sem comparação' esconde o período e volta ao relatório simples", async () => {
    await montar();
    await comPeriodoEComparacao();

    await escolherModo("Sem comparação");

    await waitFor(() => expect(screen.getByText(/período simples/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Período de comparação" })).not.toBeInTheDocument();
  });
});
