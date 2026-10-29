import { describe, it, expect } from "vitest";
import { INVESTIMENTO_IMPOSTO_RATE, investimentoComImposto } from "@/utils/crmCalculations";

describe("investimento + imposto (12,5%)", () => {
  it("taxa é 12,5%", () => {
    expect(INVESTIMENTO_IMPOSTO_RATE).toBe(0.125);
  });

  it("acrescenta 12,5% ao investimento", () => {
    expect(investimentoComImposto(1000)).toBe(1125);
    expect(investimentoComImposto(0)).toBe(0);
  });

  it("preserva centavos (ex.: R$ 80 → R$ 90)", () => {
    expect(investimentoComImposto(80)).toBeCloseTo(90, 6);
  });
});
