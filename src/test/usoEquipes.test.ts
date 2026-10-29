import { describe, expect, it } from "vitest";
import {
  GRUPO_CLIENTES,
  GRUPO_SEM_EQUIPE,
  compararEquipes,
  compararMembros,
  criarMapaGrupo,
  mediaDe,
  membrosNoPeriodo,
  porMembro,
  type Pertencimento,
} from "@/lib/usage/equipes";
import type { UsoAgenteRow, UsoDiaRow, UsoUsuario } from "@/lib/usage/agregar";

const usuarios: UsoUsuario[] = [
  { id: "ana", email: "ana@g.com", tipo: "equipe" },
  { id: "bia", email: "bia@g.com", tipo: "equipe" },
  { id: "caio", email: "caio@g.com", tipo: "equipe" },
  { id: "duda", email: "duda@g.com", tipo: "equipe" },
  { id: "cli", email: "cli@x.com", tipo: "cliente" },
];
const porId = new Map(usuarios.map((u) => [u.id, u]));

// ana: Marketing desde sempre, muda p/ Gestão em 21/10. bia: Marketing desde sempre.
// caio: Gestão desde sempre (nunca usa). duda: sem equipe.
const membros: Pertencimento[] = [
  { user_id: "ana", equipe_id: "mkt", inicio_dia: null, fim_dia: "2026-10-21" },
  { user_id: "ana", equipe_id: "ges", inicio_dia: "2026-10-21", fim_dia: null },
  { user_id: "bia", equipe_id: "mkt", inicio_dia: null, fim_dia: null },
  { user_id: "caio", equipe_id: "ges", inicio_dia: null, fim_dia: null },
];
const grupoDe = criarMapaGrupo(membros, porId);
const dias = ["2026-10-20", "2026-10-21", "2026-10-22"];

const d = (dia: string, user_id: string, min: number, screen_key = "clientes.crm"): UsoDiaRow => ({
  dia,
  user_id,
  screen_key,
  active_ms: min * 60_000,
  visits: 1,
  clicks: 2,
});
const diario = [
  d("2026-10-20", "ana", 30),
  d("2026-10-21", "ana", 60, "gestao.marcos"),
  d("2026-10-20", "bia", 10),
  d("2026-10-22", "duda", 5),
  d("2026-10-22", "cli", 20),
];
const agentes: UsoAgenteRow[] = [
  { dia: "2026-10-20", user_id: "bia", bot_id: "b", active_ms: 120_000, sessoes: 1, perguntas: 4, respostas: 4 },
];

describe("equipe da época", () => {
  it("cada dia conta para a equipe em que a pessoa estava; no dia da troca vale a nova", () => {
    expect(grupoDe("ana", "2026-10-20")).toBe("mkt");
    expect(grupoDe("ana", "2026-10-21")).toBe("ges");
    expect(grupoDe("ana", "2025-01-01")).toBe("mkt"); // 1ª atribuição vale para o passado
    expect(grupoDe("duda", "2026-10-20")).toBe(GRUPO_SEM_EQUIPE);
    expect(grupoDe("cli", "2026-10-20")).toBe(GRUPO_CLIENTES);
  });

  it("membros do período incluem quem não usou e quem passou pelo grupo só alguns dias", () => {
    const m = membrosNoPeriodo(usuarios, dias, grupoDe, null);
    expect([...m.get("mkt")!].sort()).toEqual(["ana", "bia"]);
    expect([...m.get("ges")!].sort()).toEqual(["ana", "caio"]);
    expect([...m.get(GRUPO_SEM_EQUIPE)!]).toEqual(["duda"]);
    expect([...m.get(GRUPO_CLIENTES)!]).toEqual(["cli"]);
  });

  it("o filtro de usuários restringe os membros", () => {
    const m = membrosNoPeriodo(usuarios, dias, grupoDe, ["bia"]);
    expect([...m.keys()]).toEqual(["mkt"]);
  });
});

describe("comparação entre equipes", () => {
  const linhas = compararEquipes(diario, agentes, grupoDe, membrosNoPeriodo(usuarios, dias, grupoDe, null));
  const de = (g: string) => linhas.find((l) => l.grupo === g)!;

  it("soma o uso de cada dia na equipe da época e normaliza por membro", () => {
    expect(de("mkt")).toMatchObject({ membros: 2, membrosAtivos: 2, active_ms: 40 * 60_000, perguntas: 4, agente_ms: 120_000 });
    expect(de("ges")).toMatchObject({ membros: 2, membrosAtivos: 1, active_ms: 60 * 60_000 });
    expect(porMembro(de("ges"), "active_ms")).toBe(30 * 60_000);
    expect(de("ges").porSecao).toEqual({ gestao: 60 * 60_000 });
  });

  it("equipes primeiro, pela média de tempo por membro; Sem equipe e Clientes no fim", () => {
    expect(linhas.map((l) => l.grupo)).toEqual(["ges", "mkt", GRUPO_SEM_EQUIPE, GRUPO_CLIENTES]);
  });
});

describe("comparação dentro da equipe", () => {
  it("só conta os dias em que o membro estava na equipe, e inclui quem não usou", () => {
    const ges = compararMembros("ges", diario, agentes, grupoDe, new Set(["ana", "caio"]));
    expect(ges.map((l) => [l.grupo, l.active_ms])).toEqual([
      ["ana", 60 * 60_000], // os 30 min de 20/10 foram no Marketing
      ["caio", 0],
    ]);
    expect(mediaDe(ges, "active_ms")).toBe(30 * 60_000);
  });
});
