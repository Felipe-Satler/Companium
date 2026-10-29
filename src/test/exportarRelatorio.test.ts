/**
 * A captura em PNG das tabelas do relatório.
 *
 * Os dois comportamentos testados aqui foram descobertos reproduzindo falhas num navegador de
 * verdade, e nenhum dos dois aparece como erro:
 *
 * 1. **`includeQueryParams`** — sem ele a imagem sai ERRADA, não quebrada. O cache de recursos da
 *    `html-to-image` indexa pela URL sem a query string, e toda miniatura deste app passa pelo
 *    proxy de imagem, onde tudo que distingue um criativo do outro mora justamente na query.
 * 2. **`imagePlaceholder`** — sem ele uma única miniatura inacessível derruba a captura inteira.
 *
 * O teste observa as OPÇÕES porque é só nelas que esses dois fatos existem; não há saída visível
 * em jsdom, que não desenha nada.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const toBlob = vi.fn();
vi.mock("html-to-image", () => ({ toBlob: (...a: unknown[]) => toBlob(...a) }));

import { nodeParaPng } from "@/utils/exportarRelatorio";

const node = () => {
  const d = document.createElement("div");
  document.body.appendChild(d);
  return d;
};

beforeEach(() => {
  toBlob.mockReset();
  toBlob.mockResolvedValue(new Blob(["x"], { type: "image/png" }));
  document.documentElement.className = "light";
});

const opcoes = () => toBlob.mock.calls[0][1] as Record<string, unknown>;

describe("nodeParaPng — as opções que não podem sumir", () => {
  it("manda includeQueryParams: a miniatura de cada criativo mora na query string", async () => {
    // Sem isto, a segunda captura desenha a mesma miniatura em todas as linhas — o criativo V009
    // sai com a foto do V011, numa tabela que vai para o cliente. Medido em 06/10/2026.
    await nodeParaPng(node());
    expect(opcoes().includeQueryParams).toBe(true);
  });

  it("manda um placeholder transparente, para uma miniatura morta não derrubar a captura", async () => {
    await nodeParaPng(node());
    const ph = String(opcoes().imagePlaceholder ?? "");
    expect(ph).toMatch(/^data:image\/png;base64,/);
    // Transparente, e não o "pixel 1×1" vermelho que todo mundo tem na cabeça: esticado numa
    // célula ele viraria um bloco colorido que parece erro, ou parece dado.
    const bytes = Uint8Array.from(atob(ph.split(",")[1]), (c) => c.charCodeAt(0));
    // Byte 25 do PNG é o `color type`; 6 = RGBA, ou seja, tem canal alfa.
    expect(bytes[25]).toBe(6);
  });

  it("captura com fundo opaco e sem borrar", async () => {
    await nodeParaPng(node());
    expect(opcoes().backgroundColor).toBe("#ffffff");
    expect(opcoes().pixelRatio).toBe(2);
  });
});

describe("nodeParaPng — o erro que chega a quem clicou", () => {
  it("rejeição que NÃO é Error vira uma mensagem útil", async () => {
    // A `html-to-image` rejeita com o Event de erro de uma `<img>`. `err.message` sai vazio, e a
    // tela mostrava "falha na captura" — que não ajuda ninguém a consertar nada.
    const evento = { target: { src: "https://images.weserv.nl/?url=expirada.jpg" } };
    toBlob.mockRejectedValue(evento);
    await expect(nodeParaPng(node())).rejects.toThrow(/imagem da tabela não pôde ser carregada/i);
    await expect(nodeParaPng(node())).rejects.toThrow(/weserv/);
  });

  it("Error de verdade mantém a própria mensagem", async () => {
    toBlob.mockRejectedValue(new Error("canvas contaminado"));
    await expect(nodeParaPng(node())).rejects.toThrow("canvas contaminado");
  });

  it("imagem vazia é erro, não um PNG de zero byte", async () => {
    toBlob.mockResolvedValue(null);
    await expect(nodeParaPng(node())).rejects.toThrow(/vazia/);
  });
});

describe("nodeParaPng — o tema", () => {
  it("captura no claro e devolve o escuro a quem estava no escuro", async () => {
    // Texto claro sobre fundo escuro vira um bloco preto num slide branco. E deixar o app no claro
    // depois seria trocar o tema de quem só queria copiar uma tabela.
    document.documentElement.className = "dark";
    toBlob.mockImplementation(async () => {
      expect(document.documentElement.classList.contains("dark")).toBe(false);
      return new Blob(["x"], { type: "image/png" });
    });
    await nodeParaPng(node());
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("devolve o tema escuro mesmo quando a captura falha", async () => {
    document.documentElement.className = "dark";
    toBlob.mockRejectedValue(new Error("x"));
    await expect(nodeParaPng(node())).rejects.toThrow();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
