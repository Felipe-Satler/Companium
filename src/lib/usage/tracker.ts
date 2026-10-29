/**
 * Coleta de uso do Companium (página /uso). Montado uma vez pelo <UsageTracker /> no App.
 *
 * Tempo ATIVO, não tempo com a aba aberta: só acumula enquanto a aba está visível, a janela está
 * em foco e houve interação (clique, tecla, scroll, mouse) nos últimos 60s. A cada 15s — e ao
 * esconder/fechar a aba — manda as visitas abertas e os cliques novos para a RPC usage_track.
 * O envio é um fetch com keepalive (sobrevive ao fechamento da aba); sendBeacon não serve
 * porque não aceita o header Authorization do Supabase.
 *
 * Agentes de IA (GrooChat): enterAgent/leaveAgent, chamados pelo useChatWidget quando o chat abre e
 * fecha, medem o tempo ativo em cada agente (tabela usage_agent_visits). Na página /assistente
 * vale a mesma regra da tela; no chat flutuante só conta se a última interação foi DENTRO do
 * chat (senão quem deixa o chat aberto trabalhando no CRM somaria tempo nos dois). Perguntas e
 * respostas não passam por aqui: o banco conta direto das conversas salvas.
 *
 * Privacidade: nunca lê o valor de campos. O nome do botão vem de data-track (preferido),
 * aria-label/title ou do texto, com e-mails e números mascarados; dentro de tabelas e listas
 * (onde o texto é dado de registro, ex. nome de lead) vira um rótulo genérico.
 */
import { EXTERNAL_SUPABASE_ANON_KEY, EXTERNAL_SUPABASE_URL } from "@/integrations/external-supabase/client";
import { resolveScreen } from "./screens";

const TICK_MS = 1_000;
const FLUSH_MS = 15_000;
const IDLE_MS = 60_000;
const SESSION_IDLE_MS = 30 * 60_000;
const MAX_CLICKS_PER_REQUEST = 150;
const MAX_QUEUED_CLICKS = 1_000;
const SESSION_STORAGE_KEY = "companium-usage-session";
// Login + rotas que só redirecionam (<Navigate> no App.tsx): nunca viram tela.
const IGNORED_PATHS = new Set([
  "/auth",
  "/reset-password",
  "/",
  "/clientes",
  "/captacao",
  "/gestao",
  "/projetos",
  "/projetos/cronograma",
  "/marketing/composer/orquestrador",
]);
/** O chat remonta ao trocar de conversa: reabrir o mesmo agente logo em seguida continua a visita. */
const AGENT_REJOIN_MS = 3_000;

/** Em `npm run dev` fica desligado (não suja os dados de produção), salvo VITE_USAGE_TRACKING_DEV. */
export const USAGE_TRACKING_ENABLED = !import.meta.env.DEV || !!import.meta.env.VITE_USAGE_TRACKING_DEV;

type Visit = {
  id: string;
  session_id: string;
  screen_key: string;
  path: string;
  prev_screen_key: string | null;
  started_at: number;
  ended_at: number;
  active_ms: number;
  dirty: boolean;
};

type Click = {
  session_id: string;
  visit_id: string;
  screen_key: string;
  seq: number;
  target_key: string;
  target_label: string;
  ts: string;
};

export type AgentSurface = "pagina" | "flutuante";

type AgentVisit = {
  id: string;
  session_id: string;
  bot_id: string;
  surface: AgentSurface;
  started_at: number;
  ended_at: number;
  active_ms: number;
  dirty: boolean;
  /** Quando o chat fechou; null = aberto. Fica pendente por AGENT_REJOIN_MS antes de fechar. */
  left_at: number | null;
};

type SessionState = { id: string; seq: number; last: number };

let token: string | null = null;
let running = false;
let current: Visit | null = null;
let closed: Visit[] = [];
let clicks: Click[] = [];
let lastInteraction = 0;
let lastTick = 0;
let session: SessionState | null = null;
let lastSessionSave = 0;
let timers: number[] = [];
let agent: AgentVisit | null = null;
let agentEl: Element | null = null;
let agentClosed: AgentVisit[] = [];
let lastAgentInteraction = 0;
/** Agente aberto antes da coleta ligar (o chat monta antes do token chegar). */
let wantedAgent: { botId: string; surface: AgentSurface; el: Element | null } | null = null;

const uuid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16),
      );

function loadSession(now: number): SessionState {
  if (session && now - session.last < SESSION_IDLE_MS) return session;
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    const saved = raw ? (JSON.parse(raw) as SessionState) : null;
    if (saved?.id && now - saved.last < SESSION_IDLE_MS) {
      session = saved;
      return session;
    }
  } catch {
    /* storage indisponível — sessão só em memória */
  }
  session = { id: uuid(), seq: 0, last: now };
  saveSession();
  return session;
}

function saveSession() {
  try {
    if (session) sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* ignore */
  }
}

const isActive = (now: number) =>
  document.visibilityState === "visible" && document.hasFocus() && now - lastInteraction < IDLE_MS;

function openVisit(pathname: string, prev: string | null, now: number) {
  const screen = resolveScreen(pathname);
  current = {
    id: uuid(),
    session_id: loadSession(now).id,
    screen_key: screen.key,
    path: screen.path,
    prev_screen_key: prev,
    started_at: now,
    ended_at: now,
    active_ms: 0,
    dirty: false,
  };
}

/** Fecha a visita atual. Passagens relâmpago (redirect, 0ms ativo) são descartadas. Devolve a
 *  tela que deve virar o "anterior" da próxima visita. */
function closeVisit(now: number): string | null {
  if (!current) return null;
  const v = current;
  current = null;
  const trivial = v.active_ms === 0 && now - v.started_at < 1_500;
  if (trivial) return v.prev_screen_key;
  v.ended_at = Math.max(v.ended_at, Math.min(now, v.ended_at + TICK_MS));
  if (v.active_ms > 0) closed.push(v);
  return v.screen_key;
}

function openAgent(botId: string, surface: AgentSurface, now: number) {
  agent = {
    id: uuid(),
    session_id: loadSession(now).id,
    bot_id: botId,
    surface,
    started_at: now,
    ended_at: now,
    active_ms: 0,
    dirty: false,
    left_at: null,
  };
}

function finishAgent() {
  if (agent && agent.active_ms > 0) agentClosed.push(agent);
  agent = null;
}

function tick() {
  const now = Date.now();
  const dt = Math.min(now - lastTick, 2 * TICK_MS);
  lastTick = now;
  if (document.visibilityState !== "visible" || !isActive(now)) return;
  if (current) {
    current.active_ms += dt;
    current.ended_at = now;
    current.dirty = true;
  }
  if (agent && agent.left_at === null && (agent.surface === "pagina" || now - lastAgentInteraction < IDLE_MS)) {
    agent.active_ms += dt;
    agent.ended_at = now;
    agent.dirty = true;
  }
}

function onInteraction(e?: Event) {
  const now = Date.now();
  // Voltou depois de 30 min parado: sessão nova, mesma tela, sem "anterior".
  if (session && now - session.last >= SESSION_IDLE_MS && current) {
    const path = current.path;
    closeVisit(now);
    const reabrir = agent && agent.left_at === null ? { botId: agent.bot_id, surface: agent.surface } : null;
    finishAgent();
    session = null;
    openVisit(path, null, now);
    if (reabrir) openAgent(reabrir.botId, reabrir.surface, now);
  }
  if (agentEl && e?.target instanceof Node && agentEl.contains(e.target)) lastAgentInteraction = now;
  lastInteraction = now;
  const s = loadSession(now);
  s.last = now;
  if (now - lastSessionSave > 10_000) {
    lastSessionSave = now;
    saveSession();
  }
}

const TRACKABLE =
  '[data-track], button, a[href], summary, [role="button"], [role="tab"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="switch"], [role="checkbox"], [role="radio"]';
const RECORD_CONTAINER = 'table, [role="grid"], [role="table"], [role="listbox"], [cmdk-list]';

const clean = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[email]")
    .replace(/\d[\d.,:/-]{2,}/g, "#")
    .trim()
    .slice(0, 60);

function describe(el: Element): { key: string; label: string } {
  const explicit = el.getAttribute("data-track");
  if (explicit) return { key: explicit, label: el.getAttribute("data-track-label") || explicit };

  const kind = el.getAttribute("role") || el.tagName.toLowerCase();
  if (el.closest(RECORD_CONTAINER)) {
    const label = kind === "option" ? "Opção de lista" : "Item de tabela";
    return { key: `${kind}:${label.toLowerCase()}`, label };
  }
  let label = clean(el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "");
  if (!label) {
    // Botão só com ícone (lucide): usa o nome do ícone.
    const icon = el.querySelector("svg[class*='lucide-']")?.getAttribute("class") ?? "";
    const name = icon.match(/lucide-([a-z0-9-]+)/)?.[1];
    label = name ? `Ícone ${name}` : kind;
  }
  return { key: `${kind}:${label.toLowerCase()}`, label };
}

function onClick(e: MouseEvent) {
  if (!current) return;
  const target = e.target instanceof Element ? e.target : null;
  const el = target?.closest(TRACKABLE);
  if (!el || el.closest("[data-track-ignore]")) return;
  const now = Date.now();
  const s = loadSession(now);
  s.seq += 1;
  saveSession();
  const { key, label } = describe(el);
  clicks.push({
    session_id: s.id,
    visit_id: current.id,
    screen_key: current.screen_key,
    seq: s.seq,
    target_key: key,
    target_label: label,
    ts: new Date(now).toISOString(),
  });
  if (clicks.length > MAX_QUEUED_CLICKS) clicks = clicks.slice(-MAX_QUEUED_CLICKS);
}

const visitPayload = (v: Visit) => ({
  id: v.id,
  screen_key: v.screen_key,
  path: v.path,
  prev_screen_key: v.prev_screen_key,
  started_at: new Date(v.started_at).toISOString(),
  ended_at: new Date(v.ended_at).toISOString(),
  active_ms: Math.round(v.active_ms),
});

const agentPayload = (a: AgentVisit) => ({
  id: a.id,
  bot_id: a.bot_id,
  surface: a.surface,
  started_at: new Date(a.started_at).toISOString(),
  ended_at: new Date(a.ended_at).toISOString(),
  active_ms: Math.round(a.active_ms),
});

async function send(
  sessionId: string,
  visits: Visit[],
  agents: AgentVisit[],
  batch: Click[],
  keepalive: boolean,
): Promise<boolean> {
  if (!token) return false;
  try {
    const res = await fetch(`${EXTERNAL_SUPABASE_URL}/rest/v1/rpc/usage_track`, {
      method: "POST",
      keepalive,
      headers: {
        apikey: EXTERNAL_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_session: sessionId,
        p_visits: visits.map(visitPayload),
        p_agents: agents.map(agentPayload),
        p_clicks: batch.map(({ session_id: _s, ...c }) => c),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function flush(keepalive = false) {
  if (!token) return;
  if (agent && agent.left_at !== null && Date.now() - agent.left_at >= AGENT_REJOIN_MS) finishAgent();
  const visits = [...closed, ...(current?.dirty ? [current] : [])];
  closed = [];
  if (current) current.dirty = false;
  const agents = [...agentClosed, ...(agent?.dirty ? [agent] : [])];
  agentClosed = [];
  if (agent) agent.dirty = false;
  const pendingClicks = clicks;
  clicks = [];
  if (!visits.length && !agents.length && !pendingClicks.length) return;

  const sessions = new Set([
    ...visits.map((v) => v.session_id),
    ...agents.map((a) => a.session_id),
    ...pendingClicks.map((c) => c.session_id),
  ]);
  for (const sid of sessions) {
    const sv = visits.filter((v) => v.session_id === sid);
    const sa = agents.filter((a) => a.session_id === sid);
    const sc = pendingClicks.filter((c) => c.session_id === sid);
    for (let i = 0; i === 0 || i < sc.length; i += MAX_CLICKS_PER_REQUEST) {
      const batch = sc.slice(i, i + MAX_CLICKS_PER_REQUEST);
      const batchVisits = i === 0 ? sv : [];
      const batchAgents = i === 0 ? sa : [];
      void send(sid, batchVisits, batchAgents, batch, keepalive).then((ok) => {
        if (ok) return;
        // Falhou: devolve à fila. Visitas reenviadas fazem upsert; cliques têm (sessão, seq) único.
        for (const v of batchVisits) {
          if (v === current) v.dirty = true;
          else closed.push(v);
        }
        for (const a of batchAgents) {
          if (a === agent) a.dirty = true;
          else agentClosed.push(a);
        }
        clicks = [...batch, ...clicks].slice(-MAX_QUEUED_CLICKS);
      });
    }
  }
}

function onVisibility() {
  if (document.visibilityState === "hidden") flush(true);
}

function onPageHide() {
  closeVisit(Date.now());
  finishAgent();
  flush(true);
}

// Voltou do bfcache (botão Voltar do navegador): a visita foi fechada no pagehide, reabre.
function onPageShow(e: PageTransitionEvent) {
  if (e.persisted && !current && !IGNORED_PATHS.has(location.pathname)) openVisit(location.pathname, null, Date.now());
}

const INTERACTION_EVENTS = ["pointerdown", "keydown", "wheel", "scroll", "mousemove", "touchstart"] as const;

export function setUsageToken(next: string | null) {
  token = next;
}

/** Liga a coleta (idempotente). Devolve a função que desliga e manda o que falta. */
export function startUsageTracking(): () => void {
  if (!USAGE_TRACKING_ENABLED || running) return () => {};
  running = true;
  const now = Date.now();
  lastTick = now;
  lastInteraction = now;
  for (const ev of INTERACTION_EVENTS) window.addEventListener(ev, onInteraction, { capture: true, passive: true });
  document.addEventListener("click", onClick, { capture: true });
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);
  timers = [window.setInterval(tick, TICK_MS), window.setInterval(() => flush(), FLUSH_MS)];
  if (wantedAgent) enterAgent(wantedAgent.botId, wantedAgent.surface, wantedAgent.el);

  return () => {
    closeVisit(Date.now());
    finishAgent();
    flush(true);
    for (const ev of INTERACTION_EVENTS) window.removeEventListener(ev, onInteraction, { capture: true });
    document.removeEventListener("click", onClick, { capture: true });
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("pageshow", onPageShow);
    timers.forEach((t) => window.clearInterval(t));
    timers = [];
    running = false;
    closed = [];
    clicks = [];
    agentClosed = [];
    agentEl = null;
    session = null;
  };
}

/** Troca de rota: fecha a visita anterior e abre a da tela nova. */
export function enterScreen(pathname: string) {
  if (!running || IGNORED_PATHS.has(pathname)) return;
  const now = Date.now();
  const screen = resolveScreen(pathname);
  if (current && current.screen_key === screen.key) return;
  const prev = closeVisit(now);
  openVisit(pathname, prev, now);
}

/** O chat de um agente abriu (página /assistente ou flutuante). `el` = contêiner do chat. */
export function enterAgent(botId: string, surface: AgentSurface, el: Element | null) {
  wantedAgent = { botId, surface, el };
  if (!running) return;
  const now = Date.now();
  agentEl = el;
  lastAgentInteraction = now; // abrir o chat já é interação com ele
  if (agent && agent.bot_id === botId && agent.surface === surface) {
    if (agent.left_at === null) return;
    if (now - agent.left_at < AGENT_REJOIN_MS) {
      agent.left_at = null;
      return;
    }
  }
  finishAgent();
  openAgent(botId, surface, now);
}

/** O chat do agente fechou (ou desmontou). */
export function leaveAgent(botId: string) {
  if (wantedAgent?.botId === botId) wantedAgent = null;
  if (!agent || agent.bot_id !== botId || agent.left_at !== null) return;
  agent.left_at = Date.now();
  agentEl = null;
}
