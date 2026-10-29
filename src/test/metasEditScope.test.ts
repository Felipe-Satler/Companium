import { describe, it, expect } from "vitest";
import { podeEditarMes, type MetasEditScope } from "@/lib/metasEditScope";

const NONE: MetasEditScope = { past: false, present: false, future: false };
const MES_ATUAL = "2026-09";

describe("escopo de edição de metas (passado/presente/futuro)", () => {
  it("sem nenhum escopo não edita nada", () => {
    expect(podeEditarMes("2026-08", MES_ATUAL, NONE)).toBe(false);
    expect(podeEditarMes("2026-09", MES_ATUAL, NONE)).toBe(false);
    expect(podeEditarMes("2026-10", MES_ATUAL, NONE)).toBe(false);
  });

  it("'past' libera só meses anteriores", () => {
    const s = { ...NONE, past: true };
    expect(podeEditarMes("2026-08", MES_ATUAL, s)).toBe(true);
    expect(podeEditarMes("2026-09", MES_ATUAL, s)).toBe(false);
    expect(podeEditarMes("2026-10", MES_ATUAL, s)).toBe(false);
  });

  it("'present' libera só o mês atual", () => {
    const s = { ...NONE, present: true };
    expect(podeEditarMes("2026-08", MES_ATUAL, s)).toBe(false);
    expect(podeEditarMes("2026-09", MES_ATUAL, s)).toBe(true);
    expect(podeEditarMes("2026-10", MES_ATUAL, s)).toBe(false);
  });

  it("'future' libera só meses futuros", () => {
    const s = { ...NONE, future: true };
    expect(podeEditarMes("2026-08", MES_ATUAL, s)).toBe(false);
    expect(podeEditarMes("2026-09", MES_ATUAL, s)).toBe(false);
    expect(podeEditarMes("2026-10", MES_ATUAL, s)).toBe(true);
  });

  it("combinações somam os intervalos", () => {
    const s = { past: true, present: false, future: true };
    expect(podeEditarMes("2026-07", MES_ATUAL, s)).toBe(true);
    expect(podeEditarMes("2026-09", MES_ATUAL, s)).toBe(false);
    expect(podeEditarMes("2026-12", MES_ATUAL, s)).toBe(true);
  });

  it("vira o ano corretamente (dez vs jan)", () => {
    const s = { ...NONE, future: true };
    expect(podeEditarMes("2027-01", "2026-12", s)).toBe(true);
    const p = { ...NONE, past: true };
    expect(podeEditarMes("2026-12", "2027-01", p)).toBe(true);
  });
});
