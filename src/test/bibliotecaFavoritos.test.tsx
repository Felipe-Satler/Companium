/**
 * Biblioteca de Análises: busca por nome e favoritos por usuário.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { filtrarAnalises } from "@/lib/bibliotecaFiltro";
import type { LibraryEntrySummary } from "@/lib/adSpyApi";

const setFavoriteMock = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: { access_token: "tok" } }),
}));

vi.mock("@/lib/adSpyApi", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/adSpyApi")>();
  return { ...real, setLibraryFavorite: (...a: unknown[]) => setFavoriteMock(...a) };
});

import { useToggleFavorite } from "@/hooks/useAdSpy";

function entry(over: Partial<LibraryEntrySummary>): LibraryEntrySummary {
  return {
    id: "e1",
    run_id: null,
    tema: "transplante capilar",
    titulo: null,
    especialidades: ["Tricologia"],
    saved_by: "u1",
    saved_by_name: "Thiago",
    criado_em: new Date().toISOString(),
    adCount: 5,
    coverAdIds: [],
    canDelete: true,
    favorito: false,
    ...over,
  };
}

describe("filtro da Biblioteca", () => {
  const lista = [
    entry({ id: "a", titulo: "Harmonização Facial 2026", tema: "harmonizacao", favorito: true }),
    // Sem título: o tema é o único nome que essa análise tem.
    entry({ id: "b", titulo: null, tema: "transplante capilar" }),
    entry({ id: "c", titulo: "Lentes de contato dental", tema: "odontologia", favorito: true }),
  ];

  it("busca pelo título ignorando acento e caixa", () => {
    expect(filtrarAnalises(lista, { busca: "HARMONIZACAO" }).map((e) => e.id)).toEqual(["a"]);
  });

  it("busca também pelo tema, porque salvar sem título é comum", () => {
    expect(filtrarAnalises(lista, { busca: "capilar" }).map((e) => e.id)).toEqual(["b"]);
  });

  it("recorta só os favoritos, e combina com a busca", () => {
    expect(filtrarAnalises(lista, { soFavoritos: true }).map((e) => e.id)).toEqual(["a", "c"]);
    expect(filtrarAnalises(lista, { soFavoritos: true, busca: "lentes" }).map((e) => e.id)).toEqual(["c"]);
  });

  it("sem filtro nenhum, devolve tudo; espaço em branco não filtra", () => {
    expect(filtrarAnalises(lista, {})).toHaveLength(3);
    expect(filtrarAnalises(lista, { busca: "   " })).toHaveLength(3);
  });
});

describe("estrela da Biblioteca", () => {
  let qc: QueryClient;
  const KEY = ["ad-spy-library", []];

  beforeEach(() => {
    setFavoriteMock.mockReset().mockResolvedValue({ ok: true, favorito: true });
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(KEY, { entries: [entry({ id: "e1", favorito: false })] });
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );

  it("acende na hora, sem esperar o servidor", async () => {
    const { result } = renderHook(() => useToggleFavorite(), { wrapper });
    result.current.mutate({ id: "e1", favorito: true });
    await waitFor(() => {
      expect(qc.getQueryData<{ entries: LibraryEntrySummary[] }>(KEY)?.entries[0].favorito).toBe(true);
    });
  });

  it("se a gravação falhar, a estrela volta — a tela não mente sobre o que está salvo", async () => {
    setFavoriteMock.mockRejectedValue(new Error("worker fora do ar"));
    const { result } = renderHook(() => useToggleFavorite(), { wrapper });
    result.current.mutate({ id: "e1", favorito: true });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(qc.getQueryData<{ entries: LibraryEntrySummary[] }>(KEY)?.entries[0].favorito).toBe(false);
  });
});
