import { describe, expect, it } from "vitest";
import { resolveScreen, screenLabel } from "@/lib/usage/screens";
import {
  calcularKpis,
  detalhar,
  agregarAgentes,
  formatarDuracao,
  gruposDaSerie,
  perguntasPorDia,
  totaisAgentes,
  listarDias,
  matchScreen,
  seriePorDia,
  type UsoDiaRow,
} from "@/lib/usage/agregar";
import { montarCsv } from "@/lib/usage/csv";

const row = (dia: string, user_id: string, screen_key: string, min: number, visits = 1, clicks = 0): UsoDiaRow => ({
  dia,
  user_id,
  screen_key,
  active_ms: min * 60_000,
  visits,
  clicks,
});

describe("registro de telas", () => {
  it("resolve rota conhecida, com barra no fim, e rota fora do registro", () => {
    expect(resolveScreen("/clientes/crm").key).toBe("clientes.crm");
    expect(resolveScreen("/clientes/crm/").key).toBe("clientes.crm");
    expect(resolveScreen("/marketing").key).toBe("marketing.mineracao");
    expect(resolveScreen("/vendas")).toMatchObject({ key: "outras.vendas", section: "outras" });
    expect(resolveScreen("/").key).toBe("outras.raiz");
  });

  it("monta o rótulo com a seção", () => {
    expect(screenLabel("clientes.meta-ads", true)).toBe("Clientes › Meta Ads");
    expect(screenLabel("_inicio")).toBe("Início da sessão");
    expect(screenLabel("outras.vendas", true)).toBe("Outras › /vendas");
  });
});

describe("escopo de telas", () => {
  it("aceita seção inteira (secao.*) ou tela exata — mesma regra do SQL", () => {
    expect(matchScreen("clientes.crm", null)).toBe(true);
    expect(matchScreen("clientes.crm", ["clientes.*"])).toBe(true);
    expect(matchScreen("clientes.metas", ["clientes.crm"])).toBe(false);
    expect(matchScreen("outras.vendas", ["outras.*"])).toBe(true);
    expect(matchScreen("captacao.metas", [])).toBe(false);
  });
});

describe("agregações", () => {
  // 2026-10-19 = segunda, 2026-10-25 = domingo.
  const rows = [
    row("2026-10-19", "ana", "clientes.crm", 30, 3, 10),
    row("2026-10-19", "ana", "clientes.metas", 10, 1, 2),
    row("2026-10-19", "bia", "clientes.crm", 20, 2, 5),
    row("2026-10-20", "ana", "clientes.crm", 20, 1, 1),
    row("2026-10-25", "bia", "marketing.composer", 60, 1, 0),
  ];

  it("KPIs: média por usuário-dia e frequência só em dias úteis", () => {
    const k = calcularKpis(rows);
    expect(k.usuariosAtivos).toBe(2);
    expect(k.tempoTotalMs).toBe(140 * 60_000);
    // ana 19, bia 19, ana 20, bia 25 = 4 usuário-dias
    expect(k.mediaPorUsuarioDiaMs).toBe(35 * 60_000);
    expect(k.visitas).toBe(8);
    expect(k.cliques).toBe(18);
    // dias úteis: 19 (2 usuários), 20 (1) → média 1,5 ÷ 2 ativos; o domingo não entra
    expect(k.frequencia).toBeCloseTo(0.75);
  });

  it("detalhamento agregado soma por tela e conta usuários", () => {
    const crm = detalhar(rows, true).find((l) => l.screen_key === "clientes.crm")!;
    expect(crm).toMatchObject({ user_id: null, active_ms: 70 * 60_000, visits: 6, usuarios: 2, ultimoDia: "2026-10-20" });
    const porUsuario = detalhar(rows, false);
    expect(porUsuario.filter((l) => l.screen_key === "clientes.crm")).toHaveLength(2);
  });

  it("uma seção só empilha por tela; várias, por seção", () => {
    const soClientes = rows.filter((r) => r.screen_key.startsWith("clientes."));
    expect(gruposDaSerie(soClientes, ["clientes.*"])).toMatchObject({ porTela: true });
    expect(gruposDaSerie(soClientes, ["clientes.*"]).grupos.map((g) => g.key)).toEqual(["clientes.crm", "clientes.metas"]);
    expect(gruposDaSerie(rows, null).grupos.map((g) => g.key)).toEqual(["clientes", "marketing"]);
  });

  it("série diária cobre todos os dias do período, mesmo sem uso", () => {
    const dias = listarDias("2026-10-19", "2026-10-21");
    expect(dias).toEqual(["2026-10-19", "2026-10-20", "2026-10-21"]);
    const s = seriePorDia(rows, dias, false);
    expect(s[0]).toEqual({ dia: "2026-10-19", clientes: 60 });
    expect(s[2]).toEqual({ dia: "2026-10-21" });
  });

  it("formata duração", () => {
    expect(formatarDuracao(0)).toBe("0 min");
    expect(formatarDuracao(10_000)).toBe("<1 min");
    expect(formatarDuracao(95 * 60_000)).toBe("1 h 35 min");
    expect(formatarDuracao(120 * 60_000)).toBe("2 h");
  });
});

describe("CSV", () => {
  it("usa ;, vírgula decimal e escapa aspas/separador", () => {
    expect(montarCsv(["a", "b"], [[1.5, 'diz "oi"; tchau'], [2, null]])).toBe('a;b\r\n1,50;"diz ""oi""; tchau"\r\n2;');
  });
});

describe("agentes de IA", () => {
  const ag = [
    { dia: "2026-10-19", user_id: "ana", bot_id: "geral", active_ms: 600_000, sessoes: 2, perguntas: 5, respostas: 5 },
    { dia: "2026-10-19", user_id: "bia", bot_id: "geral", active_ms: 0, sessoes: 0, perguntas: 2, respostas: 1 },
    { dia: "2026-10-20", user_id: "ana", bot_id: "copy", active_ms: 120_000, sessoes: 1, perguntas: 1, respostas: 1 },
  ];

  it("soma por agente e conta usuários com tempo ou pergunta", () => {
    const geral = agregarAgentes(ag, false).find((l) => l.bot_id === "geral")!;
    expect(geral).toMatchObject({ perguntas: 7, respostas: 6, active_ms: 600_000, usuarios: 2, user_id: null });
    expect(agregarAgentes(ag, true)).toHaveLength(3);
    expect(totaisAgentes(ag)).toEqual({ active_ms: 720_000, perguntas: 8, respostas: 7, usuarios: 2 });
  });

  it("série diária de perguntas por agente", () => {
    expect(perguntasPorDia(ag, ["2026-10-19", "2026-10-20"])).toEqual([
      { dia: "2026-10-19", geral: 7 },
      { dia: "2026-10-20", copy: 1 },
    ]);
  });
});
