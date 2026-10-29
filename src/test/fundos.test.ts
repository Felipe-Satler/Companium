/**
 * Fundos abstratos (`shared/fundos.js`): a receita é determinística, o post só guarda o que vale, e o
 * texto continua legível por cima de qualquer forma sorteada.
 */
import { describe, it, expect } from "vitest";
import { desenharFundo, misturar, normalizarFundo, sortearFundo } from "../../shared/fundos.js";
import { contraste, gerarPaleta, textoSobre } from "../../shared/paleta.js";

function sorteio(semente = 1) {
  let s = semente;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const CTX = { base: "#1B3A5C", acento: "#E0A458", largura: 1080, altura: 1350 };
const ESTILOS = ["degrade", "ondas", "organico", "geometrico"] as const;

describe("normalizarFundo", () => {
  it("liso, desconhecido ou vazio é null (sem fundo)", () => {
    expect(normalizarFundo({ estilo: "liso", semente: 3 })).toBeNull();
    expect(normalizarFundo({ estilo: "foto-ia", semente: 3 })).toBeNull();
    expect(normalizarFundo(null)).toBeNull();
  });

  it("guarda só estilo, semente, granulado e versão", () => {
    expect(normalizarFundo({ estilo: "ondas", semente: 42, granulado: "sim", extra: 1 })).toEqual({
      estilo: "ondas",
      semente: 42,
      granulado: false,
      versao: 1,
    });
  });

  it("sortear dá sementes diferentes no mesmo estilo", () => {
    const r = sorteio(5);
    const a = sortearFundo("organico", { aleatorio: r });
    const b = sortearFundo("organico", { aleatorio: r });
    expect(a!.estilo).toBe("organico");
    expect(a!.semente).not.toBe(b!.semente);
  });
});

describe("desenharFundo", () => {
  it("mesma semente, mesmo desenho — é o que faz o preview ser o arquivo", () => {
    for (const estilo of ESTILOS) {
      const f = { estilo, semente: 777, granulado: false, versao: 1 };
      expect(desenharFundo(f, CTX)).toEqual(desenharFundo(f, CTX));
    }
  });

  it("páginas do carrossel são irmãs, não idênticas", () => {
    const f = { estilo: "organico" as const, semente: 777, granulado: false, versao: 1 };
    expect(desenharFundo(f, { ...CTX, indice: 0 })).not.toEqual(desenharFundo(f, { ...CTX, indice: 1 }));
  });

  it("liso não desenha nada", () => {
    expect(desenharFundo(null, CTX)).toBeNull();
  });

  it("nenhuma forma derruba o contraste do texto, em paletas sorteadas, nos fundos escuro e claro", () => {
    const r = sorteio(11);
    for (let i = 0; i < 40; i += 1) {
      const p = gerarPaleta({ aleatorio: r });
      for (const base of [p.primaria, p.terciaria]) {
        const texto = textoSobre(base);
        const alvo = Math.min(4.5, contraste(base, texto)!);
        for (const estilo of ESTILOS) {
          const d = desenharFundo({ estilo, semente: 1 + i * 31, granulado: false, versao: 1 }, { ...CTX, base, acento: p.secundaria })!;
          for (const forma of d.formas) {
            const cores = forma.cor.startsWith("url(")
              ? (d.gradientes.find((g) => `url(#${g.id})` === forma.cor)?.paradas ?? []).map((x) => x.cor)
              : [forma.cor];
            for (const cor of cores) {
              expect(contraste(misturar(base, cor, forma.opacidade), texto)!).toBeGreaterThanOrEqual(alvo - 0.1);
            }
          }
        }
      }
    }
  });
});
