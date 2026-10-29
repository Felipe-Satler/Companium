/**
 * Perfil do Instagram e as contagens de visualização (`require_play_counts`).
 *
 * O que estes testes prendem:
 *
 *   - a página do perfil é pedida exigindo as visualizações — sem isso, a Scrape Creators cobra a
 *     página mesmo quando parte dos reels veio sem contagem;
 *   - o 503 dessa exigência (que não cobra) cai para o pedido normal, e a trilha não falha;
 *   - qualquer outro erro continua sendo erro: não se repete um 402 ou um 400 de graça;
 *   - reel sem contagem é contagem desconhecida (null), não zero.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const scGet = vi.fn();
vi.mock("../../apps/ad-spy-worker/sources/scrapecreators.js", () => ({
  scGet: (...a: unknown[]) => scGet(...a),
  hasKey: () => true,
  requireKey: () => {},
}));

import { profileFeed } from "../../apps/ad-spy-worker/sources/instagram.js";

const erro = (status: number) => Object.assign(new Error(`Scrape Creators ${status}`), { status });
const reel = (code: string, play_count?: number) => ({
  code,
  media_type: 2,
  product_type: "clips",
  ...(play_count === undefined ? {} : { play_count }),
  user: { username: "dra.exemplo" },
});

beforeEach(() => scGet.mockReset());

describe("Instagram › perfil exige as visualizações", () => {
  it("pede a página com require_play_counts, nas duas rotas", async () => {
    scGet.mockResolvedValue({ items: [reel("AAAAA1", 0)], more_available: false });
    await profileFeed.fetchPage({ handle: "dra.exemplo" }, "c1");
    expect(scGet).toHaveBeenCalledWith(
      "/v2/instagram/user/posts",
      { handle: "dra.exemplo", next_max_id: "c1", require_play_counts: true },
      expect.anything()
    );

    scGet.mockResolvedValue({ items: [], paging_info: {} });
    await profileFeed.fetchPage({ handle: "dra.exemplo", mediaType: "video" }, "c2");
    expect(scGet).toHaveBeenLastCalledWith(
      "/v1/instagram/user/reels",
      { handle: "dra.exemplo", max_id: "c2", require_play_counts: true },
      expect.anything()
    );
  });

  it("no 503, repete sem exigir e devolve a página com a contagem desconhecida", async () => {
    scGet
      .mockRejectedValueOnce(erro(503))
      .mockResolvedValueOnce({ items: [reel("AAAAA1"), reel("BBBBB2", 0)], more_available: true, next_max_id: "n2" });
    const log = vi.fn();
    const page = await profileFeed.fetchPage({ handle: "dra.exemplo" }, null, { log });

    expect(scGet).toHaveBeenCalledTimes(2);
    expect(scGet.mock.calls[1][1]).not.toHaveProperty("require_play_counts");
    expect(page.cursor).toBe("n2");
    expect(page.ads.map((a) => a.metrics.views)).toEqual([null, 0]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("503"));
  });

  it("outro erro não é repetido", async () => {
    scGet.mockRejectedValueOnce(erro(400));
    await expect(profileFeed.fetchPage({ handle: "dra.exemplo" }, null)).rejects.toThrow("400");
    expect(scGet).toHaveBeenCalledTimes(1);
  });
});
