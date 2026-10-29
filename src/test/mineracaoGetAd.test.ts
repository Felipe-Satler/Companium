/**
 * `getAd` precisa trazer as colunas que as ROTAS leem.
 *
 * Ela nasceu servindo só a rota de imagem, com quatro colunas. Quando a rota de baixar vídeo passou
 * a usá-la, `media_url` vinha `undefined` e o worker respondia "este anúncio não tem vídeo
 * guardado" para anúncio que tinha — o dado estava no banco, a consulta é que não o pedia. Nada no
 * tipo denuncia isso: em JavaScript, coluna que não veio é só `undefined`.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { getAd } from "../../apps/ad-spy-worker/db.js";

afterEach(() => vi.unstubAllGlobals());

/** Captura a URL que o db.js pede ao PostgREST. */
async function urlPedida(): Promise<string> {
  let capturada = "";
  vi.stubGlobal("fetch", async (url: string) => {
    capturada = String(url);
    return { ok: true, status: 200, json: async () => [{ id: 1 }], text: async () => "[]" };
  });
  await getAd(1);
  return capturada;
}

describe("getAd", () => {
  it("pede as colunas de que as rotas dependem", async () => {
    const url = await urlPedida();
    for (const coluna of [
      "media_url", // baixar vídeo, e renovar link expirado
      "media_path", // cópia durável no bucket
      "thumb_path", // rota de imagem
      "avatar_path",
      "media_type",
      "page_name", // nome do arquivo baixado
      "external_id",
    ]) {
      expect(url, `faltou ${coluna} no select`).toContain(coluna);
    }
  });

  it("busca uma linha só, pelo id", async () => {
    const url = await urlPedida();
    expect(url).toContain("id=eq.1");
    expect(url).toContain("limit=1");
  });
});
