/**
 * O polling da Mineração.
 *
 * A UI só descobre o progresso da análise porque faz polling, e ela decide fazer polling a partir
 * do estado que tem em cache. O worker responde 202 e segue trabalhando, então entre a resposta e
 * a run mudar de estado no banco existe uma janela: um refetch feito ali lê o estado ANTIGO e
 * desliga o polling. A análise rodava no servidor e a tela ficava parada, sem pipeline, até um F5.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const analyzeSelectedMock = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: { access_token: "tok" } }),
}));

vi.mock("@/lib/adSpyApi", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/adSpyApi")>();
  return { ...real, analyzeSelected: (...args: unknown[]) => analyzeSelectedMock(...args) };
});

import { useAnalyzeSelected } from "@/hooks/useAdSpy";
import type { SpyRun } from "@/lib/adSpyApi";

const RUN_ID = "run-1";

function makeCached(status: SpyRun["status"]) {
  return { run: { id: RUN_ID, status } as SpyRun, ads: [] };
}

describe("polling da Mineração", () => {
  let qc: QueryClient;

  beforeEach(() => {
    analyzeSelectedMock.mockReset().mockResolvedValue({ ok: true, selected: 2 });
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );

  it("pedir a análise já marca a run como rodando, sem esperar o servidor", async () => {
    // É isso que religa o polling. Sem isso a run seguia "awaiting_selection" em cache e a tela
    // nunca mais perguntava nada ao worker.
    qc.setQueryData(["ad-spy-run", RUN_ID], makeCached("awaiting_selection"));

    const { result } = renderHook(() => useAnalyzeSelected(), { wrapper });
    result.current.mutate({ runId: RUN_ID, adIds: [1, 2] });

    await waitFor(() => {
      const cached = qc.getQueryData<{ run: SpyRun }>(["ad-spy-run", RUN_ID]);
      expect(cached?.run.status).toBe("running");
    });
    expect(analyzeSelectedMock).toHaveBeenCalledWith("tok", RUN_ID, [1, 2]);
  });

  it("uma falha não mente sobre o estado da run", async () => {
    analyzeSelectedMock.mockRejectedValue(new Error("worker fora do ar"));
    qc.setQueryData(["ad-spy-run", RUN_ID], makeCached("awaiting_selection"));

    const { result } = renderHook(() => useAnalyzeSelected(), { wrapper });
    result.current.mutate({ runId: RUN_ID, adIds: [1] });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(qc.getQueryData<{ run: SpyRun }>(["ad-spy-run", RUN_ID])?.run.status).toBe(
      "awaiting_selection",
    );
  });
});
