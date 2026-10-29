/**
 * Paridade entre o casamento de cliente do frontend (TypeScript) e o porte do worker (Node).
 *
 * O worker soma investimento por cliente para escrever o resumo de Marketing › Clientes. Se o
 * porte divergir do original, uma conta de anúncio deixa de casar, o investimento do cliente vira
 * zero e o agente afirma — com toda a confiança — que o cliente parou de investir. É um erro que
 * não levanta exceção nenhuma, então tem de ser um teste.
 *
 * Os DADOS não são comparados aqui porque não há duas cópias: os dois lados importam
 * `shared/client-aliases.js`. O que este teste cobre é a LÓGICA.
 */
import { describe, it, expect } from "vitest";
import {
  ADS_CLIENT_ALIASES,
  CLIENT_ALIASES,
  canonicalizeAdsClient as tsCanonicalize,
  clientMatchKey as tsMatchKey,
  foldMergedAdsClient as tsFold,
  normalizeClientName as tsNormalize,
} from "@/data/clienteAliases";
import { chavesCandidatas as tsChaves } from "@/data/squads";
import {
  canonicalizeAdsClient as jsCanonicalize,
  chavesCandidatas as jsChaves,
  clientMatchKey as jsMatchKey,
  foldMergedAdsClient as jsFold,
  normalizeClientName as jsNormalize,
} from "../../apps/ad-spy-worker/client-match.js";

/** Nomes reais (as chaves dos mapas) + as formas esquisitas que a heurística existe para limpar. */
const CORPUS: string[] = [
  ...Object.keys(ADS_CLIENT_ALIASES),
  ...Object.keys(CLIENT_ALIASES),
  ...Object.values(CLIENT_ALIASES),
  "CA 2.4.01",
  "CA 1.1.1 - Dr. Fábio Vascular",
  "Dr. Moacir Vitório - CA 1.1.x | Groohub",
  "Dr. José Ramos - VascuMed",
  "Dra. Marina Arantes - Clínica Sorriso",
  "GROOHUB 001 - Instituto Face Ideal",
  "(Groohub) - Centro Oftalmológico",
  "Conta de Anúncios - Grupo Capilar Nacional",
  "C.A GROOHUB - Tavernari Capilar",
  "CA01 - Clínica Sorriso Pleno",
  "Instituto Urológico de Aurora I Groohub",
  "Clínica  com   espaços   demais",
  "Sílvio Matos - LumiLaser\"",
  "",
  "   ",
];

describe("paridade do casamento de cliente (TS x worker)", () => {
  it("clientMatchKey", () => {
    for (const nome of CORPUS) expect(jsMatchKey(nome)).toBe(tsMatchKey(nome));
  });

  it("normalizeClientName", () => {
    for (const nome of CORPUS) expect(jsNormalize(nome)).toBe(tsNormalize(nome));
  });

  it("canonicalizeAdsClient — é o que decide de quem é o investimento", () => {
    for (const nome of CORPUS) {
      expect(`${nome} -> ${jsCanonicalize(nome)}`).toBe(`${nome} -> ${tsCanonicalize(nome)}`);
    }
  });

  it("foldMergedAdsClient, com e sem o canal meta", () => {
    for (const nome of CORPUS) {
      const canonical = tsCanonicalize(nome);
      expect(jsFold(canonical, undefined)).toBe(tsFold(canonical, undefined));
      expect(jsFold(canonical, "meta")).toBe(tsFold(canonical, "meta"));
      expect(jsFold(canonical, "crm")).toBe(tsFold(canonical, "crm"));
    }
  });

  it("chavesCandidatas — quebra o nome da planilha em médico e clínica", () => {
    for (const nome of CORPUS) expect(jsChaves(nome)).toEqual(tsChaves(nome));
  });

  it("os casos que a heurística existe para resolver não caem em vazio", () => {
    // Guarda contra um porte que "passa" por concordar em devolver "" para tudo.
    expect(jsCanonicalize("CA 1.1.1 - Dr. Fábio Vascular")).toBe("Fábio_Morais");
    expect(jsCanonicalize("GROOHUB 001 - Instituto Face Ideal")).toBe("Instituto_Face_Ideal");
    expect(jsCanonicalize("Dra. Marina Arantes - Clínica Sorriso")).not.toBe("");
    expect(jsChaves("Dr. José Ramos - VascuMed").length).toBeGreaterThan(1);
  });

  it("nulo e indefinido não explodem em nenhum dos lados", () => {
    for (const v of [null, undefined]) {
      expect(jsCanonicalize(v as unknown as string)).toBe(tsCanonicalize(v as unknown as string));
      expect(jsMatchKey(v as unknown as string)).toBe(tsMatchKey(v as unknown as string));
    }
  });
});
