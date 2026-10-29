import { describe, it, expect } from "vitest";
import {
  campaignGroupKey,
  normCampaignKey,
  buildCampanhas,
  type CriativoRow,
} from "@/hooks/useMetaAdsCriativosData";

// Preenche uma CriativoRow com defaults neutros; cada teste sobrescreve só o que importa.
function mkRow(p: Partial<CriativoRow>): CriativoRow {
  return {
    campanha: "",
    campaignId: "",
    conjunto: "",
    adsetId: "",
    anuncioId: "",
    anuncio: "",
    ativo: true,
    gasto: 0,
    orcamento: 0,
    impressoes: 0,
    alcance: 0,
    freq: 0,
    cliques: 0,
    v3s: 0,
    v95: 0,
    mensagens: 0,
    leads: 0,
    visitas: 0,
    resultados: 0,
    tipo: "Cadastros",
    tipoStored: false,
    dia: "",
    thumbnail: null,
    media: null,
    headline: null,
    seguidores: 0,
    videoUrl: null,
    videoPermalink: null,
    adCriado: null,
    adEditado: null,
    conjCriado: null,
    conjEditado: null,
    campCriado: null,
    campEditado: null,
    ...p,
  };
}

const noCrm = { byCampaign: new Map<string, { leads: number; consultas: number }>() };

describe("normCampaignKey", () => {
  it("remove sufixos de data acumulados e normaliza caixa/espaços", () => {
    expect(normCampaignKey("GROOHUB 003 - Conversas - 09/07")).toBe("GROOHUB 003 - CONVERSAS");
    // Vários sufixos encadeados (o nome acumula um por reedição) somem todos.
    expect(normCampaignKey("GROOHUB 003 - Conversas - 09/07 - 18/08")).toBe("GROOHUB 003 - CONVERSAS");
    expect(normCampaignKey("  groohub 003   -   conversas ")).toBe("GROOHUB 003 - CONVERSAS");
  });

  it("as duas variantes de nome da MESMA campanha colapsam na mesma chave normalizada", () => {
    const a = normCampaignKey("GROOHUB 003 - Conversas - 09/07");
    const b = normCampaignKey("GROOHUB 003 - Conversas - 09/07 - 18/08");
    expect(a).toBe(b);
  });
});

describe("campaignGroupKey (a decisão de agrupamento)", () => {
  it("Campaign_ID tem prioridade: nomes diferentes, mesmo ID → mesma chave", () => {
    const r1 = mkRow({ campaignId: "123", campanha: "GROOHUB 003 - Conversas - 09/07" });
    const r2 = mkRow({ campaignId: "123", campanha: "GROOHUB 003 - Conversas - 09/07 - 18/08" });
    expect(campaignGroupKey(r1)).toBe(campaignGroupKey(r2));
    expect(campaignGroupKey(r1)).toBe("123");
  });

  it("sem Campaign_ID (linha antiga) → cai na chave normalizada, ainda colapsa as variantes", () => {
    const r1 = mkRow({ campaignId: "", campanha: "GROOHUB 003 - Conversas - 09/07" });
    const r2 = mkRow({ campaignId: "", campanha: "GROOHUB 003 - Conversas - 09/07 - 18/08" });
    expect(campaignGroupKey(r1)).toBe(campaignGroupKey(r2));
    expect(campaignGroupKey(r1)).toBe("GROOHUB 003 - CONVERSAS");
  });

  it("IDs diferentes NÃO colapsam (campanhas distintas ficam separadas)", () => {
    const r1 = mkRow({ campaignId: "123", campanha: "GROOHUB 003 - Conversas" });
    const r2 = mkRow({ campaignId: "456", campanha: "GROOHUB 003 - Conversas" });
    expect(campaignGroupKey(r1)).not.toBe(campaignGroupKey(r2));
  });
});

describe("buildCampanhas — colapso GROOHUB 003 (âncora real do doc §6)", () => {
  // Uma campanha, dois nomes diferindo só pelo sufixo " - 18/08", mesmo Campaign_ID.
  // Antes do fix: duas linhas (Conversas vs Visitas), investimento/impressões partidos.
  // Números reais do print do Meta manager (doc §6).
  const rowRecente = mkRow({
    campaignId: "CID_003",
    campanha: "GROOHUB 003 - Conversas - 09/07 - 18/08", // nome ATUAL (dia mais recente)
    conjunto: "Visitas", adsetId: "222", anuncioId: "AD_VIS", anuncio: "Anúncio Visitas",
    dia: "2026-08-18",
    tipo: "Visitas ao perfil", tipoStored: true,
    gasto: 37.55, impressoes: 4638, visitas: 113, resultados: 113,
  });
  const rowAntiga = mkRow({
    campaignId: "CID_003",
    campanha: "GROOHUB 003 - Conversas - 09/07",
    conjunto: "Conversas", adsetId: "111", anuncioId: "AD_CONV", anuncio: "Anúncio Conversas",
    dia: "2026-07-09",
    tipo: "Conversas iniciadas", tipoStored: true,
    gasto: 219.92, impressoes: 27884, mensagens: 727, resultados: 727,
  });
  // `scoped` chega ordenado por Dia desc → a linha mais recente vem primeiro.
  const scoped = [rowRecente, rowAntiga];

  it("colapsa em UMA campanha (não duas)", () => {
    const camps = buildCampanhas(scoped, noCrm);
    expect(camps).toHaveLength(1);
    expect(camps[0].campaignId).toBe("CID_003");
  });

  it("nome exibido = o do dia mais recente (variante - 18/08)", () => {
    const [c] = buildCampanhas(scoped, noCrm);
    expect(c.nome).toBe("GROOHUB 003 - Conversas - 09/07 - 18/08");
  });

  it("investimento e impressões são SOMADOS entre as variantes", () => {
    const [c] = buildCampanhas(scoped, noCrm);
    expect(c.agg.gasto).toBeCloseTo(257.47, 2); // 219,92 + 37,55
    expect(c.agg.impressoes).toBe(32522); // 27.884 + 4.638
  });

  it("mantém os dois conjuntos reais separados (por Adset_ID)", () => {
    const [c] = buildCampanhas(scoped, noCrm);
    expect(c.conjuntos).toHaveLength(2);
    expect(new Set(c.conjuntos.map((cj) => cj.adsetId))).toEqual(new Set(["222", "111"]));
  });
});

describe("buildCampanhas — CRM somado sobre variantes de nome", () => {
  it("leads/consultas que caíram em nomes diferentes da mesma campanha somam no nível de campanha", () => {
    const scoped = [
      mkRow({ campaignId: "CID_X", campanha: "Campanha X - 18/08", adsetId: "A1", anuncioId: "AD1", gasto: 100, impressoes: 1000, leads: 3, resultados: 3, tipo: "Cadastros", tipoStored: true }),
      mkRow({ campaignId: "CID_X", campanha: "Campanha X", adsetId: "A2", anuncioId: "AD2", gasto: 50, impressoes: 500, leads: 2, resultados: 2, tipo: "Cadastros", tipoStored: true }),
    ];
    const crm = {
      byCampaign: new Map([
        ["Campanha X - 18/08", { leads: 5, consultas: 2 }],
        ["Campanha X", { leads: 3, consultas: 1 }],
      ]),
    };
    const [c] = buildCampanhas(scoped, crm);
    expect(c.agg.leadsCrm).toBe(8); // 5 + 3, somado sobre as duas variantes
    expect(c.agg.consultas).toBe(3); // 2 + 1
  });

  it("sem lead em nenhuma variante → CRM null (UI mostra '—')", () => {
    const scoped = [mkRow({ campaignId: "CID_Y", campanha: "Campanha Y", adsetId: "A1", anuncioId: "AD1", gasto: 10, impressoes: 100 })];
    const [c] = buildCampanhas(scoped, noCrm);
    expect(c.agg.leadsCrm).toBeNull();
    expect(c.agg.consultas).toBeNull();
  });
});

describe("buildCampanhas — campanhas distintas não se misturam", () => {
  it("dois Campaign_IDs → duas campanhas", () => {
    const scoped = [
      mkRow({ campaignId: "CID_1", campanha: "Alpha", adsetId: "A1", anuncioId: "AD1", gasto: 10, impressoes: 100 }),
      mkRow({ campaignId: "CID_2", campanha: "Beta", adsetId: "A2", anuncioId: "AD2", gasto: 20, impressoes: 200 }),
    ];
    expect(buildCampanhas(scoped, noCrm)).toHaveLength(2);
  });
});
