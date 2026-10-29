/**
 * A etapa opcional de testar palavras-chave, na tela.
 *
 * O que importa aqui é não deixar a pessoa gastar sem saber: o custo aparece antes do clique, e o
 * resultado leva o termo escolhido direto para o campo de busca.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const probeMock = vi.fn();
const pesquisaMock = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: { access_token: "tok" } }),
}));

vi.mock("@/lib/adSpyApi", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/adSpyApi")>();
  return {
    ...real,
    probeTerms: (...a: unknown[]) => probeMock(...a),
    pesquisarTermos: (...a: unknown[]) => pesquisaMock(...a),
  };
});

import { KeywordProbe } from "@/components/marketing/mineracao/KeywordProbe";
import type { SpySettings } from "@/lib/adSpyApi";

const settings = { minDaysRunning: 0, minCollationCount: 5 } as SpySettings;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

function montar(
  onUsarTermo = vi.fn(),
  nicho = "transplante capilar",
  fontesDaBusca?: Parameters<typeof KeywordProbe>[0]["fontesDaBusca"],
) {
  render(
    <KeywordProbe settings={settings} nicho={nicho} onUsarTermo={onUsarTermo} fontesDaBusca={fontesDaBusca} />,
    { wrapper },
  );
  return onUsarTermo;
}

const pesquisaOk = (over: Record<string, unknown> = {}) => ({
  resumoMd: "Anuncia por técnica.",
  termos: [
    { termo: "sem raspagem", porque: "como o mercado chama", confianca: "visto", onde: "anúncio X" },
    { termo: "fue", porque: "nome da técnica", confianca: "inferido", onde: "" },
  ],
  concorrentes: [],
  vocabulario: ["densidade"],
  fontes: { web: true },
  semBlocoJson: false,
  ...over,
});

describe("KeywordProbe", () => {
  beforeEach(() => {
    pesquisaMock.mockReset();
    probeMock.mockReset().mockResolvedValue({
      resultados: [
        { termo: "fue", retornados: 30, passaram: 11, anunciantes: 7, medianaDias: 148, motivos: {}, temMais: true, erro: null },
        { termo: "capilar", retornados: 30, passaram: 2, anunciantes: 1, medianaDias: 40, motivos: { "roda há pouco tempo": 20 }, temMais: true, erro: null },
      ],
      creditsUsed: 2,
      maxTermos: 5,
    });
  });

  it("sugere termos e já os joga no campo da sonda", async () => {
    pesquisaMock.mockResolvedValue(pesquisaOk());
    montar();
    fireEvent.click(screen.getByRole("button", { name: /sugerir palavras-chave/i }));

    await waitFor(() => expect(screen.getByText("sem raspagem")).toBeInTheDocument());
    expect(pesquisaMock).toHaveBeenCalledWith("tok", "transplante capilar", undefined);
    // Sugerir e medir é um fluxo só: o campo já fica pronto para testar.
    expect(screen.getByLabelText(/testar palavras-chave/i)).toHaveValue("sem raspagem, fue");
    expect(screen.getByText(/visto em anúncio/i)).toBeInTheDocument();
  });

  it("avisa quando o agente NÃO conseguiu pesquisar — os termos viram palpite", async () => {
    pesquisaMock.mockResolvedValue(pesquisaOk({ fontes: { web: false } }));
    montar();
    fireEvent.click(screen.getByRole("button", { name: /sugerir palavras-chave/i }));
    await waitFor(() =>
      expect(screen.getByText(/não conseguiu pesquisar na web/i)).toBeInTheDocument(),
    );
  });

  it("sem nicho no campo de tema, não chama o agente", () => {
    montar(vi.fn(), "   ");
    fireEvent.click(screen.getByRole("button", { name: /sugerir palavras-chave/i }));
    expect(pesquisaMock).not.toHaveBeenCalled();
  });

  it("diz o custo antes de testar, e não testa sem termo", () => {
    montar();
    expect(screen.getByRole("button", { name: /testar/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/testar palavras-chave/i), {
      target: { value: "fue, capilar" },
    });
    expect(screen.getByText(/2 créditos no total/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /testar/i })).not.toBeDisabled();
  });

  it("manda os termos separados e com os filtros atuais", async () => {
    montar();
    fireEvent.change(screen.getByLabelText(/testar palavras-chave/i), {
      target: { value: "fue, capilar, fue" },
    });
    fireEvent.click(screen.getByRole("button", { name: /testar/i }));
    await waitFor(() => expect(probeMock).toHaveBeenCalled());
    // Repetido não vira crédito a mais.
    expect(probeMock).toHaveBeenCalledWith("tok", ["fue", "capilar"], settings, ["meta"]);
  });

  it("mostra o placar e leva o termo escolhido para a busca", async () => {
    const onUsar = montar();
    fireEvent.change(screen.getByLabelText(/testar palavras-chave/i), { target: { value: "fue" } });
    fireEvent.click(screen.getByRole("button", { name: /testar/i }));

    await waitFor(() => expect(screen.getByText("fue")).toBeInTheDocument());
    expect(screen.getByText(/11/)).toBeInTheDocument();
    // O motivo da reprovação aparece, porque é ele que diz qual filtro relaxar.
    expect(screen.getByText(/roda há pouco tempo/i)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /usar/i })[0]);
    expect(onUsar).toHaveBeenCalledWith("fue");
  });

  it("não deixa pedir mais que o teto de 5 palavras", async () => {
    montar();
    fireEvent.change(screen.getByLabelText(/testar palavras-chave/i), {
      target: { value: "a1, a2, a3, a4, a5, a6, a7" },
    });
    fireEvent.click(screen.getByRole("button", { name: /testar/i }));
    await waitFor(() => expect(probeMock).toHaveBeenCalled());
    expect(probeMock.mock.calls[0][1]).toHaveLength(5);
  });

  it("começa com as fontes de palavra-chave marcadas na busca, e perfis ficam de fora", async () => {
    montar(vi.fn(), "x", ["meta", "instagram_reels", "instagram_profile", "tiktok"]);
    const grupo = screen.getByRole("group", { name: /fontes do teste/i });
    const marcadas = Array.from(grupo.querySelectorAll("button[aria-pressed='true']")).map((b) => b.textContent);
    expect(marcadas).toEqual(["Meta Ads", "Instagram reels", "TikTok Ads"]);

    fireEvent.change(screen.getByLabelText(/testar palavras-chave/i), { target: { value: "fue" } });
    fireEvent.click(screen.getByRole("button", { name: /^testar/i }));
    await waitFor(() => expect(probeMock).toHaveBeenCalled());
    expect(probeMock.mock.calls[0][3]).toEqual(["meta", "instagram_reels", "tiktok"]);
  });

  it("o custo é palavra × fonte, e passar do teto bloqueia o teste", () => {
    montar(vi.fn(), "x", ["meta", "instagram_reels", "instagram_hashtag", "tiktok"]);
    fireEvent.change(screen.getByLabelText(/testar palavras-chave/i), { target: { value: "a1, a2, a3" } });
    expect(screen.getByText(/12 créditos no total/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/testar palavras-chave/i), {
      target: { value: "a1, a2, a3, a4" },
    });
    // 4 × 4 = 16 > 15.
    expect(screen.getByText(/passa do máximo/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^testar/i })).toBeDisabled();
  });

  it("agrupa o placar por fonte, e no orgânico a mediana é de visualizações", async () => {
    probeMock.mockResolvedValue({
      resultados: [
        { termo: "fue", fonte: "meta", retornados: 30, passaram: 5, anunciantes: 4, medianaDias: 90, motivos: {}, temMais: true, erro: null },
        {
          termo: "fue", fonte: "instagram_hashtag", consulta: "#fue", retornados: 12, passaram: 9, anunciantes: 8,
          medianaDias: null, medianaViews: 15000, motivos: {}, temMais: true, erro: null,
        },
      ],
      creditsUsed: 2,
      maxTermos: 5,
    });
    montar(vi.fn(), "x", ["meta", "instagram_hashtag"]);
    fireEvent.change(screen.getByLabelText(/testar palavras-chave/i), { target: { value: "fue" } });
    fireEvent.click(screen.getByRole("button", { name: /^testar/i }));

    await waitFor(() => expect(screen.getByText("Instagram hashtag", { selector: "p" })).toBeInTheDocument());
    expect(screen.getByText("Meta Ads", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText(/visualizações \(mediana\)/i)).toBeInTheDocument();
    expect(screen.getByText("#fue")).toBeInTheDocument();
  });
});
