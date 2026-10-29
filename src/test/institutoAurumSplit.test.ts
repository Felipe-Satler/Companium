import { describe, it, expect } from "vitest";
import {
  canonicalizeAdsClient,
  clientMatchKey,
  prettyClientLabel,
  accountMedicoRules,
  accountMedicoOptions,
  campaignMedicoFromName,
  adsMedicoForClient,
} from "@/data/clienteAliases";

// Instituto Aurum reúne DUAS contas de Ads separadas (uma por médico) sob um único cliente.
// Nomes crus reais das contas (Composio / Meta), confirmados em prod em 20/10/2026.
const DAVI = "Dr. Davi Colares - CA 1.1.1 | Groohub";
const KATO = "Dr. Filipe Kato - CA 1.1.1 | Groohub";

describe("Instituto Aurum: agrupamento de 2 contas num cliente só", () => {
  it("as duas contas canonicalizam para o MESMO slug Instituto_Aurum", () => {
    expect(canonicalizeAdsClient(DAVI)).toBe("Instituto_Aurum");
    expect(canonicalizeAdsClient(KATO)).toBe("Instituto_Aurum");
    // → mesma chave de comparação ⇒ uma única opção de cliente no dropdown.
    expect(clientMatchKey(canonicalizeAdsClient(DAVI))).toBe("instituto_aurum");
    expect(clientMatchKey(canonicalizeAdsClient(KATO))).toBe("instituto_aurum");
  });

  it("exibe o rótulo oficial 'Instituto Aurum'", () => {
    expect(prettyClientLabel("Instituto_Aurum")).toBe("Instituto Aurum");
  });
});

describe("Instituto Aurum: split de médico POR CONTA", () => {
  it("reconhece o grupo pelo nome cru de qualquer conta e pelo canônico", () => {
    expect(accountMedicoRules(DAVI).length).toBe(2);
    expect(accountMedicoRules(KATO).length).toBe(2);
    expect(accountMedicoRules("Instituto_Aurum").length).toBe(2);
  });

  it("oferece os 2 médicos como opções de filtro", () => {
    expect(accountMedicoOptions("Instituto_Aurum")).toEqual([
      "Dr. Davi Colares",
      "Dr. Filipe Kato",
    ]);
  });

  it("atribui o médico pela CONTA (nome cru do Client), não pelo nome da campanha", () => {
    const rules = accountMedicoRules("Instituto_Aurum");
    // Campanha do Davi (qualquer nome) → classificada pela conta.
    expect(campaignMedicoFromName(rules, DAVI)).toBe("Dr. Davi Colares");
    // As campanhas do Kato são "Post do Instagram ..." (sem o nome do médico); mesmo assim
    // a conta define o médico — é por isso que o split tem de ser por conta, não por campanha.
    expect(campaignMedicoFromName(rules, KATO)).toBe("Dr. Filipe Kato");
  });

  it("não participa p/ cliente sem agrupamento nem p/ 'all'/vazio", () => {
    expect(accountMedicoRules("Lia Garrido")).toEqual([]);
    expect(accountMedicoRules("all")).toEqual([]);
    expect(accountMedicoRules(undefined)).toEqual([]);
    expect(accountMedicoOptions("Carla_Gouveia")).toEqual([]);
  });
});

describe("Instituto Aurum: médico do leads tráfego/investimento no CRM", () => {
  // No CRM o médico de cada linha de Ads vem de adsMedicoForClient(nome CRU) — é o que divide o
  // leads tráfego/investimento por médico e faz o dropdown aparecer mesmo sem pipeline no Kommo.
  it("resolve o médico pela CONTA (split por conta, não só o mapa fixo Lia/Moacir)", () => {
    expect(adsMedicoForClient(DAVI)).toBe("Dr. Davi Colares");
    expect(adsMedicoForClient(KATO)).toBe("Dr. Filipe Kato");
  });

  it("mantém o mapa fixo (Lia/Moacir) e o null p/ contas fora de qualquer split", () => {
    expect(adsMedicoForClient("Dra. Lia Garrido - CA 1.1.1 | Groohub")).toBe("Dra. Lia");
    expect(adsMedicoForClient("Dr. Moacir Vitório - CA 1.1.1 | Groohub")).toBe("Dr. Moacir");
    expect(adsMedicoForClient("Clínica Qualquer - CA 1.1.1 | Groohub")).toBeNull();
  });
});
