import { describe, it, expect } from "vitest";
import {
  campaignMedicoRules,
  campaignMedicoOptions,
  campaignMedicoFromName,
} from "@/data/clienteAliases";

// Split por NOME de campanha da Dra. Carla Gouveia (conta única dividida em 3 frentes).
// Nomes reais colhidos da tabela "Criativos Meta Ads" em prod.
const CARLA = "Dra. Carla Gouveia - CA 1.1.1 | Groohub";

describe("split de campanhas por médico (Dra. Carla Gouveia)", () => {
  it("reconhece a conta da Carla pelo nome cru e pelo canônico", () => {
    expect(campaignMedicoRules(CARLA).length).toBe(3);
    expect(campaignMedicoRules("Carla_Gouveia").length).toBe(3);
  });

  it("oferece exatamente os 3 médicos/unidades no filtro (nomes IGUAIS aos do Kommo)", () => {
    expect(campaignMedicoOptions(CARLA)).toEqual(["Dra. Isadora Freitas", "Clín. Única", "Dra. Carla Gouveia"]);
  });

  it("não participa p/ cliente sem split nem p/ 'all'", () => {
    expect(campaignMedicoRules("Lia Garrido")).toEqual([]);
    expect(campaignMedicoRules("all")).toEqual([]);
    expect(campaignMedicoRules(undefined)).toEqual([]);
    expect(campaignMedicoOptions("Lia Garrido")).toEqual([]);
  });

  it("classifica cada campanha pelo médico correto (sem acento/maiúsculas)", () => {
    const rules = campaignMedicoRules(CARLA);
    const carla = [
      "GROOHUB 00 | DRA. CARLA - VISITAS AO PERFIL - GINEC/OBST. - FEM. - 18/06",
      "GROOHUB 02 | DRA. CARLA - CBO - FRIO - CAPTAÇÃO - WPP - GINEC/OBSTET. - 10/07",
      "GROOHUB 10 - DRA. CARLA - LOOKALIKE - (TEÓF./MALAC/PADRE./POTE) - GINEC/OBST. - 22/09",
      "X ERRO X- GROOHUB 01 | DRA. CARLA - CBO - TRÁFEGO - VISITAS AO PERFIL - OBST/GINEC. - 15/06",
    ];
    const unica = [
      "GROOHUB 00 | CLÍN. ÚNICA - WPP - PSICOLOGIA FEM. - 28/08",
      "GROOHUB 01 | CLÍNICA ÚNICA - VISITAS AO PERFIL IG - 07/09",
      "GROOHUB 08 | CLÍN. ÚNICA - VISITAS AO PERFIL IG - 18/09",
    ];
    const isadora = [
      "GROOHUB 09 - DRA. ISADORA - CAP. WPP - PSICOLOGIA - 18/09",
      "GROOHUB 11 - DRA. ISADORA - LOOKALIKE - (TEÓF./MALAC/PADRE./POTE) -PSICO - 23/09",
    ];
    for (const n of carla) expect(campaignMedicoFromName(rules, n)).toBe("Dra. Carla Gouveia");
    for (const n of unica) expect(campaignMedicoFromName(rules, n)).toBe("Clín. Única");
    for (const n of isadora) expect(campaignMedicoFromName(rules, n)).toBe("Dra. Isadora Freitas");
  });

  it("campanha genérica/ERRO/Post fica sem médico (null) → só aparece sem filtro", () => {
    const rules = campaignMedicoRules(CARLA);
    const semMedico = [
      "ERRO - GROOHUB 01 - CBO - TRÁFEGO - VISITAS AO PERFIL - OBST/GINEC. - 15/06",
      "GROOHUB 00 - VISITAS AO PERFIL - GINEC/OBST. - FEM. - 18/06",
      "GROOHUB 02 - CBO - FRIO - CAPTAÇÃO - WPP - GINEC/OBSTET. - 10/07",
      "GROOHUB 03 - CBO - REMARKETING - CAPTAÇÃO - WPP - GINEC/OBSTET. - 10/07",
      'Post: "A internet confunde mais do que orienta. Às vezes..."',
    ];
    for (const n of semMedico) expect(campaignMedicoFromName(rules, n)).toBeNull();
    expect(campaignMedicoFromName(rules, "")).toBeNull();
    expect(campaignMedicoFromName(rules, null)).toBeNull();
  });
});
