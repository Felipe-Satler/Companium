import { describe, it, expect } from "vitest";
import {
  campaignMedicoRules,
  campaignMedicoFromName,
  MEDICO_VAZIO,
} from "@/data/clienteAliases";
import { mergeKommoAgg, calcTotals, AdsRow } from "@/utils/crmCalculations";

// Verifica que o split por NOME de campanha (Dra. Carla Gouveia) divide corretamente o
// "leads tráfego" e o "investimento" do CRM quando um médico é selecionado — o bug era o CRM
// NÃO reagir ao filtro de médico para a Carla (conta única, médico no nome da campanha).
//
// Reproduz o caminho do useCRMClienteData: cada linha de Ads (campanha-a-campanha) recebe o
// médico via campaignMedicoFromName(...) ?? MEDICO_VAZIO (o que o fetch de split faz), e o
// filtro de médico usa o MESMO predicado do `filteredAds`.
const CARLA = "Dra. Carla Gouveia - CA 1.1.1 | Groohub";

// Campanhas reais da Carla (prod), com um investimento/lead fictício por campanha só para
// checar a partição. Mistura campanhas com médico no nome e campanhas genéricas (sem token).
const CAMPANHAS: { nome: string; spend: number; leads: number }[] = [
  { nome: "GROOHUB 00 | DRA. CARLA - VISITAS AO PERFIL - GINEC/OBST. - FEM. - 18/06", spend: 100, leads: 10 },
  { nome: "GROOHUB 06 | DRA. CARLA - CBO - FRIO - CAPTAÇÃO - WPP - GINEC/OBSTET. - 18/09", spend: 200, leads: 20 },
  { nome: "GROOHUB 08 | CLÍN. ÚNICA - VISITAS AO PERFIL IG - 18/09", spend: 50, leads: 5 },
  { nome: "GROOHUB 00 | CLÍN. ÚNICA - WPP - PSICOLOGIA FEM. - 28/08", spend: 70, leads: 7 },
  { nome: "GROOHUB 09 - DRA. ISADORA - CAP. WPP - PSICOLOGIA - 18/09", spend: 40, leads: 4 },
  { nome: "GROOHUB 02 - CBO - FRIO - CAPTAÇÃO - WPP - GINEC/OBSTET. - 10/07", spend: 300, leads: 30 }, // genérica
  { nome: "Post: \"A internet confunde mais do que orienta...\"", spend: 15, leads: 1 }, // genérica
];

// Espelha o fetch de split: AdsRow por campanha, Fonte Meta, médico pelo nome da campanha.
function splitAdsRows(): AdsRow[] {
  const rules = campaignMedicoRules(CARLA);
  return CAMPANHAS.map((c) => ({
    Client: "Dra. Carla Gouveia",
    Dia: "2026-09-18",
    Lead: c.leads,
    Mensagens_iniciadas: 0,
    Valor_usado_BRL: c.spend,
    Fonte_Ads: "Meta",
    medico: campaignMedicoFromName(rules, c.nome) ?? MEDICO_VAZIO,
  }));
}

// Mesmo predicado do filteredAds do useCRMClienteData.
function filterByMedico(rows: AdsRow[], medicoSelected: string[]): AdsRow[] {
  if (medicoSelected.length === 0) return rows;
  return rows.filter((r) => r.medico == null || medicoSelected.includes(r.medico));
}

function totals(rows: AdsRow[]) {
  const t = calcTotals(mergeKommoAgg([], rows));
  return { investimento: t.investimentoTotal, leadsTrafego: t.leadsTrafegoMeta };
}

describe("CRM: split de leads tráfego/investimento por médico (Carla)", () => {
  const rows = splitAdsRows();

  it("sem médico selecionado = total do cliente inteiro", () => {
    const t = totals(filterByMedico(rows, []));
    expect(t.investimento).toBe(100 + 200 + 50 + 70 + 40 + 300 + 15);
    expect(t.leadsTrafego).toBe(10 + 20 + 5 + 7 + 4 + 30 + 1);
  });

  it("Dra. Carla Gouveia = só as campanhas DRA. CARLA (sem genéricas)", () => {
    const t = totals(filterByMedico(rows, ["Dra. Carla Gouveia"]));
    expect(t.investimento).toBe(100 + 200);
    expect(t.leadsTrafego).toBe(10 + 20);
  });

  it("Clín. Única = só CLÍN./CLÍNICA ÚNICA", () => {
    const t = totals(filterByMedico(rows, ["Clín. Única"]));
    expect(t.investimento).toBe(50 + 70);
    expect(t.leadsTrafego).toBe(5 + 7);
  });

  it("Dra. Isadora Freitas = só DRA. ISADORA", () => {
    const t = totals(filterByMedico(rows, ["Dra. Isadora Freitas"]));
    expect(t.investimento).toBe(40);
    expect(t.leadsTrafego).toBe(4);
  });

  it("'Sem médico' = só as campanhas genéricas (sem token de médico)", () => {
    const t = totals(filterByMedico(rows, [MEDICO_VAZIO]));
    expect(t.investimento).toBe(300 + 15);
    expect(t.leadsTrafego).toBe(30 + 1);
  });

  it("a soma das partes por médico + 'sem médico' reconstrói o total", () => {
    const partes = ["Dra. Carla Gouveia", "Clín. Única", "Dra. Isadora Freitas", MEDICO_VAZIO]
      .map((m) => totals(filterByMedico(rows, [m])));
    const somaInv = partes.reduce((s, p) => s + p.investimento, 0);
    const somaLeads = partes.reduce((s, p) => s + p.leadsTrafego, 0);
    const total = totals(filterByMedico(rows, []));
    expect(somaInv).toBe(total.investimento);
    expect(somaLeads).toBe(total.leadsTrafego);
  });
});
