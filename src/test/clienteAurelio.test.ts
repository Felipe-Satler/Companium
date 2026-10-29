// O Dr. Aurelio tem três nomes: "Dr. Aurelio Oliveira - CA 1.1.1 | Groohub" na conta de anúncios,
// "Dr_Aurelio" no Kommo e "Dr. Aurelio" na planilha de projetos. Os três precisam virar a MESMA chave
// — a da planilha não virava, e a Central de Clientes e o Composer mostravam o cliente vazio.
import { describe, it, expect } from "vitest";
import { chavesCandidatas } from "@/data/squads";
import { canonicalizeAdsClient, clientCmpKey } from "@/data/clienteAliases";
import { chavesCandidatas as chavesDoWorker } from "../../apps/ad-spy-worker/client-match.js";

describe("Dr. Aurelio — um cliente, uma chave", () => {
  it("a conta de anúncios, o Kommo e a planilha casam", () => {
    const chave = clientCmpKey("Dr. Aurelio Oliveira - CA 1.1.1 | Groohub");
    expect(chave).toBe("aurelio_oliveira");
    expect(clientCmpKey("Dr_Aurelio")).toBe(chave);
    expect(clientCmpKey("Dr. Aurelio")).toBe(chave);
  });

  it("a chave da planilha (o `padrao` do Composer e da Central) é a da conta", () => {
    for (const nome of ["Dr. Aurelio", "Dr. Aurelio - Ortopedia"]) {
      const c = chavesCandidatas(nome);
      expect(c[1] ?? c[0]).toBe("aurelio_oliveira");
      // O worker deriva a mesma chave: é com ela que o resumo, o relatório e a composição gravam.
      const w = chavesDoWorker(nome);
      expect(w[1] ?? w[0]).toBe("aurelio_oliveira");
    }
  });

  it("não captura outro Aurelio", () => {
    expect(canonicalizeAdsClient("Dr. Aurelio Fulano")).toBe("Aurelio_Fulano");
  });
});
