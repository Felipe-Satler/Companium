/**
 * Spec dos formatos de anúncio do Ad Composer.
 *
 * Os limites não são decoração: o Google RECUSA um título acima de 30 caracteres, e uma ideia que
 * chega com 34 é retrabalho disfarçado de entrega. A spec é lida pela tela e pelo prompt do agente,
 * então um erro aqui sai nos dois lugares ao mesmo tempo.
 */
import { describe, it, expect } from "vitest";
import {
  AD_FORMATS,
  formatosDisponiveis,
  getFormato,
  validarLimites,
} from "../../shared/ad-formats.js";

describe("spec dos formatos", () => {
  it("todo formato tem id único", () => {
    const ids = AD_FORMATS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("todo formato disponível declara campos, e o indisponível não é oferecido", () => {
    for (const f of formatosDisponiveis()) {
      expect(f.campos.length, `${f.id} sem campos`).toBeGreaterThan(0);
    }
    expect(formatosDisponiveis().map((f) => f.id)).not.toContain("tiktok");
    expect(AD_FORMATS.map((f) => f.id)).toContain("tiktok");
  });

  it("todo campo de lista diz quantos itens aceita", () => {
    for (const f of AD_FORMATS) {
      for (const c of f.campos.filter((c) => c.tipo === "lista")) {
        expect(c.itens, `${f.id}.${c.id} sem itens`).toBeTruthy();
        expect(c.itens.min).toBeLessThanOrEqual(c.itens.max);
      }
    }
  });

  it("todo limite diz se a plataforma rejeita ou só corta", () => {
    // A diferença decide o texto do aviso na tela: "vai ser recusado" é outra conversa.
    for (const f of AD_FORMATS) {
      for (const c of f.campos.filter((c) => c.limite)) {
        expect(typeof c.limiteRigido, `${f.id}.${c.id}`).toBe("boolean");
      }
    }
  });

  it("os limites do Google Ads são os reais e são rígidos", () => {
    const g = getFormato("google_ads");
    const headlines = g.campos.find((c) => c.id === "headlines");
    const descriptions = g.campos.find((c) => c.id === "descriptions");
    expect(headlines.limite).toBe(30);
    expect(headlines.limiteRigido).toBe(true);
    expect(headlines.itens).toEqual({ min: 3, max: 15 });
    expect(descriptions.limite).toBe(90);
    expect(descriptions.limiteRigido).toBe(true);
    expect(descriptions.itens).toEqual({ min: 2, max: 4 });
  });

  it("getFormato devolve null para id desconhecido", () => {
    expect(getFormato("orkut")).toBeNull();
  });
});

describe("validarLimites", () => {
  const ok = {
    headlines: ["Transplante capilar", "Avaliação sem custo", "Resultado natural"],
    descriptions: ["Equipe especializada e acompanhamento completo.", "Agende sua avaliação hoje."],
  };

  it("composição dentro dos limites não gera aviso", () => {
    expect(validarLimites("google_ads", ok)).toEqual([]);
  });

  it("título acima de 30 vira aviso de limite RÍGIDO", () => {
    const avisos = validarLimites("google_ads", {
      ...ok,
      headlines: [...ok.headlines, "Este título tem muito mais do que trinta caracteres"],
    });
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ campo: "headlines", indice: 3, tipo: "excede_limite_rigido" });
    expect(avisos[0].detalhe).toMatch(/\/30 caracteres/);
  });

  it("estouro de recomendação é aviso diferente de estouro rígido", () => {
    // Meta corta na exibição; Google recusa. Tratar os dois igual seria mentir sobre a consequência.
    const avisos = validarLimites("meta_ads", { headline: "x".repeat(41) });
    expect(avisos[0].tipo).toBe("excede_recomendado");
  });

  it("itens de menos que o formato exige viram aviso", () => {
    const avisos = validarLimites("google_ads", { ...ok, headlines: ["Só um"] });
    expect(avisos).toContainEqual(
      expect.objectContaining({ campo: "headlines", tipo: "itens_de_menos" }),
    );
  });

  it("itens demais também", () => {
    const avisos = validarLimites("google_ads", {
      ...ok,
      descriptions: ["a", "b", "c", "d", "e"],
    });
    expect(avisos).toContainEqual(
      expect.objectContaining({ campo: "descriptions", tipo: "itens_demais" }),
    );
  });

  it("campo ausente não explode, e conta como lista vazia", () => {
    const avisos = validarLimites("google_ads", {});
    expect(avisos.every((a) => a.tipo === "itens_de_menos")).toBe(true);
  });

  it("formato desconhecido ou composição nula não gera aviso nem erro", () => {
    expect(validarLimites("orkut", ok)).toEqual([]);
    expect(validarLimites("google_ads", null)).toEqual([]);
  });
});
