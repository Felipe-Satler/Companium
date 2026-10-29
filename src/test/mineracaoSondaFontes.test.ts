/**
 * A sonda resolvendo a trilha de verdade (`probeLaneFor` -> provider da fonte), com só o HTTP da
 * Scrape Creators simulado. É o caminho que roda em produção: o teste da sonda com provider
 * injetado não passa pela resolução de fonte nem pelo normalizador.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const scGet = vi.fn();
vi.mock("../../apps/ad-spy-worker/sources/scrapecreators.js", () => ({
  scGet: (...a: unknown[]) => scGet(...a),
  hasKey: () => true,
  requireKey: () => {},
}));

import { probeTerms } from "../../apps/ad-spy-worker/probe.js";

const post = (code: string, views: number, user: string) => ({
  shortcode: code,
  caption: "legenda do post",
  is_video: true,
  video_url: "https://cdn/v.mp4",
  owner: { username: user },
  taken_at: "2026-09-01T00:00:00.000Z",
  video_play_count: views,
});

describe("sonda no Instagram", () => {
  // Corpo em bloco de propósito: `() => scGet.mockReset()` devolveria o mock, e o Vitest chama a
  // função devolvida por um beforeEach como limpeza — uma chamada fantasma ao scGet sem argumentos.
  beforeEach(() => {
    scGet.mockReset();
  });

  it("testa a hashtag DO TERMO, não a do formulário, e mede por visualizações", async () => {
    scGet.mockResolvedValue({
      posts: [post("AAAAA1", 1000, "a"), post("AAAAA2", 5000, "b"), post("AAAAA3", 90000, "b")],
      cursor: "2",
    });
    const { resultados, creditsUsed } = await probeTerms({
      termos: ["Harmonização Facial"],
      settings: { instagramHashtag: "outracoisa", minCollationCount: 5 },
      fontes: ["instagram_hashtag"],
    });

    expect(scGet).toHaveBeenCalledWith(
      "/v1/instagram/search/hashtag",
      expect.objectContaining({ hashtag: "harmonizacaofacial" }),
      expect.anything()
    );
    expect(creditsUsed).toBe(1);
    expect(resultados[0]).toMatchObject({
      fonte: "instagram_hashtag",
      consulta: "#harmonizacaofacial",
      retornados: 3,
      // A replicação ligada em 5 não reprova post orgânico.
      passaram: 3,
      anunciantes: 2,
      medianaViews: 5000,
      medianaDias: null,
      temMais: true,
    });
  });

  it("um termo em duas fontes sai agrupado por fonte", async () => {
    scGet.mockImplementation(async (path: string) =>
      path.includes("reels") ? { reels: [post("BBBBB1", 10, "x")] } : { posts: [], cursor: null }
    );
    const { resultados, creditsUsed } = await probeTerms({
      termos: ["fue", "dhi"],
      settings: {},
      fontes: ["instagram_reels", "instagram_hashtag"],
    });
    expect(resultados.map((r: { fonte: string; termo: string }) => `${r.fonte}:${r.termo}`)).toEqual([
      "instagram_reels:fue",
      "instagram_reels:dhi",
      "instagram_hashtag:fue",
      "instagram_hashtag:dhi",
    ]);
    expect(creditsUsed).toBe(4);
  });
});
