import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/external-supabase/client", () => ({
  EXTERNAL_SUPABASE_URL: "https://exemplo.supabase.co",
  EXTERNAL_SUPABASE_ANON_KEY: "anon",
}));

type Corpo = {
  p_session: string;
  p_agents: Array<{ bot_id: string; surface: string; active_ms: number; id: string }>;
  p_visits: Array<{ screen_key: string; active_ms: number; prev_screen_key: string | null }>;
  p_clicks: Array<{ screen_key: string; seq: number; target_key: string; target_label: string }>;
};

describe("tracker de uso", () => {
  let corpos: Corpo[];
  let parar: () => void;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubEnv("VITE_USAGE_TRACKING_DEV", "1");
    vi.resetModules();
    corpos = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        corpos.push(JSON.parse(String(init.body)));
        return { ok: true } as Response;
      }),
    );
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    sessionStorage.clear();
    const t = await import("@/lib/usage/tracker");
    t.setUsageToken("jwt");
    parar = t.startUsageTracking();
    t.enterScreen("/clientes/crm");
    (globalThis as { __tracker?: typeof t }).__tracker = t;
  });

  afterEach(() => {
    parar();
    document.body.innerHTML = "";
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const interagir = () => window.dispatchEvent(new Event("pointerdown"));
  const visitas = () => corpos.flatMap((c) => c.p_visits);
  const cliques = () => corpos.flatMap((c) => c.p_clicks);

  it("conta só tempo com interação recente e manda a cada 15s", async () => {
    interagir();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(visitas().at(-1)).toMatchObject({ screen_key: "clientes.crm", prev_screen_key: null });
    expect(visitas().at(-1)!.active_ms).toBeGreaterThanOrEqual(14_000);

    // Parado por 3 min: só os primeiros 60s após a última interação contam.
    await vi.advanceTimersByTimeAsync(180_000);
    const final = visitas().at(-1)!.active_ms;
    expect(final).toBeGreaterThanOrEqual(59_000);
    expect(final).toBeLessThanOrEqual(61_000);
  });

  it("rota que só redireciona não vira tela nem 'anterior'", async () => {
    const t = (globalThis as { __tracker?: typeof import("@/lib/usage/tracker") }).__tracker!;
    interagir();
    await vi.advanceTimersByTimeAsync(3_000);
    t.enterScreen("/clientes"); // <Navigate> p/ /clientes/meta-ads... aqui simulado
    await vi.advanceTimersByTimeAsync(1_000);
    t.enterScreen("/clientes/meta-ads");
    interagir();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(visitas().some((v) => v.screen_key.startsWith("outras."))).toBe(false);
    expect(visitas().find((v) => v.screen_key === "clientes.meta-ads")?.prev_screen_key).toBe("clientes.crm");
  });

  it("aba escondida não conta tempo", async () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    interagir();
    await vi.advanceTimersByTimeAsync(30_000);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    expect(visitas().every((v) => v.active_ms === 0)).toBe(true);
  });

  it("troca de tela registra a anterior", async () => {
    interagir();
    await vi.advanceTimersByTimeAsync(5_000);
    (globalThis as { __tracker?: typeof import("@/lib/usage/tracker") }).__tracker!.enterScreen("/clientes/metas");
    interagir();
    await vi.advanceTimersByTimeAsync(15_000);
    const metas = visitas().find((v) => v.screen_key === "clientes.metas");
    expect(metas?.prev_screen_key).toBe("clientes.crm");
    expect(visitas().some((v) => v.screen_key === "clientes.crm" && v.active_ms > 0)).toBe(true);
  });

  it("captura cliques em ordem, mascara dados e nunca usa texto de tabela", async () => {
    document.body.innerHTML = `
      <button id="a">Enviar 12345 para joao@ex.com</button>
      <button id="b" data-track="crm.filtro-periodo" data-track-label="Filtro de período"><span>x</span></button>
      <table><tr><td><button id="c">Maria Souza</button></td></tr></table>
      <div data-track-ignore><button id="d">Oculto</button></div>
      <input id="e" value="segredo" />`;
    for (const id of ["a", "b", "c", "d", "e"]) document.getElementById(id)!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document.querySelector("#b span")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    interagir();
    await vi.advanceTimersByTimeAsync(15_000);

    const c = cliques();
    expect(c.map((x) => x.target_label)).toEqual([
      "Enviar # para [email]",
      "Filtro de período",
      "Item de tabela",
      "Filtro de período",
    ]);
    expect(c.map((x) => x.seq)).toEqual([1, 2, 3, 4]);
    expect(c[1].target_key).toBe("crm.filtro-periodo");
    expect(JSON.stringify(corpos)).not.toContain("Maria");
    expect(JSON.stringify(corpos)).not.toContain("segredo");
  });

  describe("agentes de IA", () => {
    const t = () => (globalThis as { __tracker?: typeof import("@/lib/usage/tracker") }).__tracker!;
    const agentes = () => corpos.flatMap((c) => c.p_agents);

    it("na página /assistente conta todo o tempo ativo no agente", async () => {
      t().enterAgent("bot-a", "pagina", document.body);
      interagir();
      await vi.advanceTimersByTimeAsync(15_000);
      expect(agentes().at(-1)).toMatchObject({ bot_id: "bot-a", surface: "pagina" });
      expect(agentes().at(-1)!.active_ms).toBeGreaterThanOrEqual(14_000);
    });

    it("no chat flutuante só conta interação dentro do chat", async () => {
      document.body.innerHTML = `<div id="chat"><textarea id="campo"></textarea></div><div id="crm"><button id="b">x</button></div>`;
      t().enterAgent("bot-a", "flutuante", document.getElementById("chat"));
      // Mexe só fora do chat por 2 min: passado o minuto inicial, o agente para de contar.
      for (let i = 0; i < 12; i++) {
        document.getElementById("b")!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        await vi.advanceTimersByTimeAsync(10_000);
      }
      const fora = agentes().at(-1)!.active_ms;
      expect(fora).toBeLessThanOrEqual(61_000);
      // Agora digita dentro do chat: volta a contar.
      for (let i = 0; i < 3; i++) {
        document.getElementById("campo")!.dispatchEvent(new Event("keydown", { bubbles: true }));
        await vi.advanceTimersByTimeAsync(10_000);
      }
      expect(agentes().at(-1)!.active_ms).toBeGreaterThan(fora + 25_000);
    });

    it("reabrir o mesmo agente logo em seguida (troca de conversa) continua a mesma visita", async () => {
      t().enterAgent("bot-a", "pagina", document.body);
      interagir();
      await vi.advanceTimersByTimeAsync(5_000);
      t().leaveAgent("bot-a");
      t().enterAgent("bot-a", "pagina", document.body);
      interagir();
      await vi.advanceTimersByTimeAsync(15_000);
      t().leaveAgent("bot-a");
      t().enterAgent("bot-b", "pagina", document.body);
      interagir();
      await vi.advanceTimersByTimeAsync(15_000);
      const ids = new Set(agentes().filter((a) => a.bot_id === "bot-a").map((a) => a.id));
      expect(ids.size).toBe(1);
      expect(agentes().some((a) => a.bot_id === "bot-b" && a.active_ms > 0)).toBe(true);
    });
  });
});
