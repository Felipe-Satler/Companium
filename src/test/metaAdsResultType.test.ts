import { describe, it, expect } from "vitest";
import { canonicalResultType, formatCampaignResultType } from "@/lib/metaAdsResultTypeLabels";

// Regressão do bug do Fábio Morais: a campanha 013 (GROOHUB 013, todas as linhas gravadas
// como "Visitas ao perfil" em "Criativos Meta Ads") sumia do filtro "Visitas ao perfil"
// porque a tela sobrescrevia o tipo pelo código cru da tabela principal — que classificava
// a campanha como MENSAGEM — e depois filtrava por esse código. A 015 sobrevivia porque o
// código dela (`link_click`) era rotulado "Visitas ao Perfil", com P maiúsculo: outra opção
// do dropdown, visualmente idêntica, filtrando um conjunto disjunto.
describe("canonicalResultType", () => {
  it("colapsa as duas caixas gravadas pela ingestão num tipo só", () => {
    expect(canonicalResultType("Conversas Iniciadas")).toBe("Conversas iniciadas");
    expect(canonicalResultType("Conversas iniciadas")).toBe("Conversas iniciadas");
    expect(canonicalResultType("Visitas ao Perfil")).toBe("Visitas ao perfil");
    expect(canonicalResultType("Visitas ao perfil")).toBe("Visitas ao perfil");
  });

  it("traduz os códigos crus do Meta pro vocabulário dos criativos", () => {
    expect(canonicalResultType("onsite_conversion.messaging_conversation_started_7d")).toBe("Conversas iniciadas");
    expect(canonicalResultType("messaging_conversation_started")).toBe("Conversas iniciadas");
    expect(canonicalResultType("lead")).toBe("Cadastros");
    expect(canonicalResultType("follow")).toBe("Seguidores");
    expect(canonicalResultType("purchase")).toBe("Compras");
    expect(canonicalResultType("offsite_conversion.fb_pixel_purchase")).toBe("Compras");
  });

  it("põe profile_visit e link_click no MESMO tipo (era a colisão de uma maiúscula)", () => {
    expect(canonicalResultType("profile_visit")).toBe(canonicalResultType("link_click"));
    expect(canonicalResultType("link_click")).toBe("Visitas ao perfil");
  });

  it("as duas campanhas do Fábio Morais caem no mesmo balde", () => {
    // 013 e 015: ambas gravadas como "Visitas ao perfil" nos criativos. Antes, a 013 era
    // reclassificada como mensagem pela tabela principal e sumia do filtro.
    const campanha013 = canonicalResultType("Visitas ao perfil");
    const campanha015 = canonicalResultType("Visitas ao perfil");
    expect(campanha013).toBe(campanha015);
    // E o código cru da tabela principal da 015 cai no mesmo lugar (cards superiores).
    expect(canonicalResultType("link_click")).toBe(campanha015);
  });

  it("preserva os sentinelas de linha de Total / vazio", () => {
    expect(canonicalResultType("Total")).toBe("");
    expect(canonicalResultType("—")).toBe("");
    expect(canonicalResultType("")).toBe("");
    expect(canonicalResultType(null)).toBe("");
    expect(canonicalResultType(undefined)).toBe("");
  });

  it("deixa passar tipo desconhecido em vez de engolir", () => {
    expect(canonicalResultType("ThruPlays")).toBe("ThruPlays");
  });
});

describe("formatCampaignResultType", () => {
  it("não gera mais dois rótulos que diferem só por uma maiúscula", () => {
    expect(formatCampaignResultType("profile_visit")).toBe(formatCampaignResultType("link_click"));
  });

  it("mantém 'Total' e '—' pra linha de total da tabela", () => {
    expect(formatCampaignResultType("Total")).toBe("Total");
    expect(formatCampaignResultType("—")).toBe("—");
    expect(formatCampaignResultType(null)).toBe("—");
  });
});
