/**
 * Baixar o vídeo do anúncio.
 *
 * O download é DOM puro (âncora temporária + object URL) porque não existe API de "salvar arquivo"
 * que funcione em todo navegador. O que vale testar aqui é o que quebra calado: o nome do arquivo
 * chegar ao `download` da âncora, e o object URL ser liberado — sem isso o blob, de dezenas de MB,
 * fica preso na memória da aba até recarregar a página.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const fetchAdVideoMock = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: { access_token: "tok" } }),
}));

vi.mock("@/lib/adSpyApi", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/adSpyApi")>();
  return { ...real, fetchAdVideo: (...a: unknown[]) => fetchAdVideoMock(...a) };
});

import { useDownloadVideo } from "@/hooks/useAdSpy";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

describe("useDownloadVideo", () => {
  let criados: string[];
  let liberados: string[];
  let cliques: { href: string; download: string }[];

  beforeEach(() => {
    criados = [];
    liberados = [];
    cliques = [];
    fetchAdVideoMock.mockReset().mockResolvedValue({
      blob: new Blob(["video"], { type: "video/mp4" }),
      filename: "Felipe-Bueno-149805926198253.mp4",
    });
    // jsdom não implementa nenhum dos dois.
    URL.createObjectURL = vi.fn(() => {
      const url = `blob:fake/${criados.length}`;
      criados.push(url);
      return url;
    });
    URL.revokeObjectURL = vi.fn((url: string) => void liberados.push(url));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      cliques.push({ href: this.href, download: this.download });
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("baixa com o nome que o worker deu e libera o object URL", async () => {
    const { result } = renderHook(() => useDownloadVideo(), { wrapper });
    result.current.mutate(3);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchAdVideoMock).toHaveBeenCalledWith("tok", 3);
    expect(cliques).toHaveLength(1);
    expect(cliques[0].download).toBe("Felipe-Bueno-149805926198253.mp4");
    expect(liberados).toEqual(criados);
    // A âncora é temporária: não pode sobrar no documento.
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("link expirado vira erro legível, sem deixar object URL vazando", async () => {
    fetchAdVideoMock.mockRejectedValue(new Error("O link do vídeo na CDN da Meta expirou"));
    const { result } = renderHook(() => useDownloadVideo(), { wrapper });
    result.current.mutate(3);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/expirou/i);
    expect(criados).toHaveLength(0);
  });
});
