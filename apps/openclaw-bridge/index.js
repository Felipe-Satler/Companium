// Chatbot <-> OpenClaw bridge
//
// Verifies the caller's Supabase JWT, runs one `openclaw agent` turn per request,
// and maps OpenClaw's JSON to the frontend's `BotReply` contract.
//
// Contract: openclaw-contract.md (frontend <-> bridge)
// Brief:    the implementation brief that accompanies this service.
//
// Phase 1: message-only. Returns { type: "message", content }.
// Phase 2 (this file): export flow — the agent emits a fenced ```json block
//   { action:"export", kind, filename, summary, file:"<abs path>" }; the bridge
//   validates it, uploads the generated file to a private Supabase Storage bucket,
//   records a user-owned row, and returns a service_request whose artifact.source
//   is a same-origin download route (GET /api/openclaw/files/:id). Plot is later.

// PRIMEIRO import: as credenciais do Supabase do arquivo central do servidor (ver
// shared/credenciais-supabase.js). Imports são avaliados na ordem, então isto roda antes de
// qualquer `process.env.SUPABASE_*` abaixo — uma troca de chave lá vale aqui no próximo reinício.
import "../../shared/credenciais-supabase.js";
import { spawn } from "node:child_process";
import { realpathSync, statSync, readFileSync } from "node:fs";
import { basename, resolve as pathResolve, sep as pathSep } from "node:path";
import { randomUUID, createHmac, createHash, timingSafeEqual } from "node:crypto";
import express from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  markdownReportHtml,
  renderPdf,
  chartHtml,
  chartReportHtml,
  renderPng,
} from "./render.js";
import { runAgentStream } from "./openclaw-agent-stream.js";
import { buildTenantContext, contextLabel, resolveTenantForUser } from "./tenancy.js";
import {
  CompaniumClient,
  CompaniumQueryService,
  CompaniumPermissionService,
  directiveToIntent,
  TenantPermissionError,
  IntentValidationError,
} from "./companium-service.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT || 18900);
const HOST = process.env.HOST || "127.0.0.1";

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://your-project-ref.supabase.co";
const JWT_ISSUER = `${SUPABASE_URL}/auth/v1`;
const JWT_AUDIENCE = "authenticated";
const JWKS_URL = `${JWT_ISSUER}/.well-known/jwks.json`;

// Which OpenClaw agent a user talks to is resolved PER REQUEST from the DB
// (chatbot_bots catalog + user_bot_settings), authorized in resolveAgent().

const OPENCLAW_BIN = process.env.OPENCLAW_BIN || "openclaw";
// Agent-side timeout (seconds) passed to `openclaw agent --timeout`.
const AGENT_TIMEOUT_SECONDS = Number(process.env.AGENT_TIMEOUT_SECONDS || 120);
// Hard kill for the child process, a bit beyond the agent timeout so the agent
// gets a chance to time out cleanly first.
const SPAWN_KILL_MS = Number(process.env.SPAWN_KILL_MS || (AGENT_TIMEOUT_SECONDS + 30) * 1000);
// Timeout (ms) do run no caminho de STREAMING — enviado ao Gateway no chat.send.
// O default antigo (60s) abortava runs pesados (coleta + plot). 5 min por padrão.
const RUN_TIMEOUT_MS = Number(process.env.OPENCLAW_RUN_TIMEOUT_MS || 300000);

// Cap on the user's message length (defense-in-depth; the agent has its own limits).
const MAX_MESSAGE_CHARS = Number(process.env.MAX_MESSAGE_CHARS || 8000);

// Simple in-flight guard. Each turn is several seconds and many tokens; refuse
// (retryably) rather than pile unbounded work on the gateway.
const MAX_INFLIGHT = Number(process.env.MAX_INFLIGHT || 6);
let inFlight = 0;
// Per-session serialization: the OpenClaw sessionId is deterministic per
// (user, agent, conversation), so a second `chat.send` on a sessionKey that
// already has a run in flight makes the gateway ABORT the running turn to
// start the new one. That strands the nearly-finished answer and surfaces as
// "gateway chat run aborted". Reject re-sends while a turn is active instead of
// letting them cancel it. Keyed by sessionId.
const activeSessions = new Set();

const FALLBACK_MESSAGE =
  "Não consegui finalizar a resposta desta vez — o processamento foi interrompido antes de concluir. " +
  "Tente reenviar; se o pedido envolver muitos dados (ex.: um gráfico de um período longo), " +
  "reduza o período ou o número de séries.";

// --- Export / Supabase (Phase 2) -------------------------------------------

// Service-role key (server-side ONLY — never shipped to the browser). Loaded from
// bridge.env via the systemd EnvironmentFile. Export is disabled if absent.
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const ARTIFACTS_BUCKET = process.env.ARTIFACTS_BUCKET || "chatbot-artifacts";

// --- Per-user (client) scoping ---------------------------------------------
// Publishable/anon key for the SAME project as SUPABASE_URL (companium-db). Required
// as the `apikey` header when reading as the AUTHENTICATED USER (the user's JWT
// goes in Authorization). MUST be the companium-db key, NOT the companium one.
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
// A locked-down OpenClaw agent for restricted (client) users: its workspace must
// have NO raw DB tool (no mcporter/PAT), so it can only reason over the scoped
// data the bridge injects. Client turns are refused (fail closed) until this is
// set — a client user must never be routed to the internal, PAT-backed agent.
const CLIENT_AGENT_ID = process.env.CLIENT_AGENT_ID || "";
// Default reporting window (days back from today) for the client data snapshot.
const CLIENT_SNAPSHOT_DAYS = Number(process.env.CLIENT_SNAPSHOT_DAYS || 45);
// Row cap per view when building the snapshot (defense-in-depth on payload size).
const CLIENT_SNAPSHOT_MAX_ROWS = Number(process.env.CLIENT_SNAPSHOT_MAX_ROWS || 2000);

// Directories the agent is allowed to have written an export file into. A file
// referenced by the (LLM-produced) export block must resolve INSIDE one of these
// after symlink resolution — otherwise it's rejected (no arbitrary file reads).
const EXPORT_ALLOWED_DIRS = (
  process.env.EXPORT_ALLOWED_DIRS ||
  "/home/deploy/.openclaw/workspace-grooagent:/home/deploy/.openclaw/workspace:/home/deploy/.openclaw/media"
)
  .split(":")
  .map((d) => d.trim())
  .filter(Boolean)
  .map((d) => {
    try {
      return realpathSync(d);
    } catch {
      return pathResolve(d);
    }
  });

const MAX_EXPORT_BYTES = Number(process.env.MAX_EXPORT_BYTES || 25 * 1024 * 1024);
// Anexos de entrada (o usuário manda uma imagem/PDF para o agente ler). Chegam
// como base64 no corpo JSON e são repassados no `attachments` do chat.send.
// Imagem: 6 MiB (teto da visão inline do Gateway). PDF: 10 MB (< 20 MB do Gateway).
const ATTACH_ALLOWED_MIMES = new Set(["image/png", "image/jpeg", "application/pdf"]);
const MAX_ATTACH_IMAGE_BYTES = Number(process.env.MAX_ATTACH_IMAGE_BYTES || 6 * 1024 * 1024);
const MAX_ATTACH_PDF_BYTES = Number(process.env.MAX_ATTACH_PDF_BYTES || 10 * 1024 * 1024);
// Cap on the agent-provided report content (markdown) we render server-side.
const MAX_EXPORT_CONTENT_CHARS = Number(
  process.env.MAX_EXPORT_CONTENT_CHARS || 200_000
);

// Allowed export kinds -> mime type. (png belongs to the plot path, below.)
const EXPORT_KIND_MIME = {
  pdf: "application/pdf",
  md: "text/markdown",
};

// --- Plot (Phase 2b) -------------------------------------------------------
// A plot is a saved, user-owned chart: the agent emits a structured spec (and an
// optional rendered PNG thumbnail). We persist the spec in `chatbot_plots` and,
// if a thumbnail is present, store the PNG in a separate private bucket served
// same-origin. The `/plots/:id` page (frontend, separate repo) re-renders later.
const PLOTS_BUCKET = process.env.PLOTS_BUCKET || "chatbot-plots";
const PLOT_THUMB_MIME = "image/png";
// Cap on the serialized chart spec (defense-in-depth; spec is LLM-produced JSON).
const MAX_SPEC_BYTES = Number(process.env.MAX_SPEC_BYTES || 256 * 1024);
const MAX_THUMB_BYTES = Number(process.env.MAX_THUMB_BYTES || 10 * 1024 * 1024);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Auth — verify the Supabase JWT against the project JWKS (ES256, asymmetric).
// ---------------------------------------------------------------------------

const jwks = createRemoteJWKSet(new URL(JWKS_URL));

/**
 * Returns the verified user id (sub) or throws.
 * @param {string|undefined} authHeader value of the Authorization header
 */
async function verifyUser(authHeader) {
  if (!authHeader || typeof authHeader !== "string") {
    throw new AuthError("Missing Authorization header");
  }
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) throw new AuthError("Malformed Authorization header");
  const token = m[1].trim();
  if (!token) throw new AuthError("Empty bearer token");

  let payload;
  try {
    ({ payload } = await jwtVerify(token, jwks, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }));
  } catch (err) {
    // Includes expiry, bad signature, wrong iss/aud, etc.
    throw new AuthError("Invalid or expired token");
  }
  if (!payload.sub || typeof payload.sub !== "string") {
    throw new AuthError("Token missing subject");
  }
  return payload.sub;
}

class AuthError extends Error {}

/**
 * Extract the raw bearer token from an Authorization header. Only used AFTER
 * verifyUser() has already validated the same header, so this just re-parses the
 * token to forward it (as the caller's credential) to scoped PostgREST reads.
 * @param {string|undefined} authHeader
 * @returns {string} the token, or "" if absent/malformed
 */
function extractBearer(authHeader) {
  const m = typeof authHeader === "string" && authHeader.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
}

// ---------------------------------------------------------------------------
// OpenClaw — run one agent turn, non-interactively, JSON out, no delivery.
// ---------------------------------------------------------------------------

/**
 * @param {{ agentId: string, content: string, sessionId: string }} args
 * @returns {Promise<object>} parsed OpenClaw JSON
 */
function runAgent({ agentId, content, sessionId }) {
  return new Promise((resolve, reject) => {
    // Arg array, NO shell — the user's text is untrusted.
    const args = [
      "agent",
      "--agent", agentId,
      "-m", content,
      "--json",
      "--session-id", sessionId,
      "--timeout", String(AGENT_TIMEOUT_SECONDS),
    ];

    let child;
    try {
      child = spawn(OPENCLAW_BIN, args, {
        shell: false,
        env: process.env,
        timeout: SPAWN_KILL_MS,
        killSignal: "SIGKILL",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      return reject(new AgentError("spawn failed", err));
    }

    let stdout = "";
    let stderr = "";
    let settled = false;

    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(new AgentError("process error", err, { stderr }));
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;

      const json = tryParseJson(stdout);
      if (!json) {
        return reject(
          new AgentError(
            `non-JSON output (exit=${code} signal=${signal})`,
            null,
            { stdout: stdout.slice(0, 2000), stderr: stderr.slice(0, 2000) }
          )
        );
      }
      // Resolve even on non-zero exit so the caller can read status/summary;
      // the mapper decides whether it's an error.
      resolve(json);
    });
  });
}

class AgentError extends Error {
  constructor(message, cause, detail) {
    super(message);
    this.cause = cause;
    this.detail = detail;
  }
}

/** Parse JSON from CLI stdout, tolerating any leading/trailing noise. */
function tryParseJson(raw) {
  if (!raw) return null;
  const text = raw.trim();
  try {
    return JSON.parse(text);
  } catch {
    // Fallback: slice from the first '{' to the last '}'.
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Map OpenClaw JSON -> BotReply (Phase 1: message only)
// ---------------------------------------------------------------------------

const CONTROL_MARKER = /^\s*\[\[[^\]]*\]\]\s*/; // strip leading [[reply_to_current]] etc.

/**
 * Extract the joined assistant text from an OpenClaw agent result.
 * @returns {{ ok: true, content: string } | { ok: false, error: string }}
 */
function extractAgentContent(json) {
  if (!json || json.status !== "ok") {
    const summary =
      (json && (json.summary || (json.result && json.result.summary))) ||
      "OpenClaw error";
    return { ok: false, error: String(summary) };
  }

  const payloads =
    (json.result && Array.isArray(json.result.payloads) && json.result.payloads) ||
    [];

  const content = payloads
    .map((p) => (p && typeof p.text === "string" ? p.text : ""))
    .filter(Boolean)
    .join("\n\n")
    .trim();

  return { ok: true, content };
}

/** Build a plain { type:"message" } reply from raw agent content. */
function buildMessageReply(content) {
  let text = (content || "").replace(CONTROL_MARKER, "").trim();
  if (!text) text = FALLBACK_MESSAGE;
  return { type: "message", content: text };
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter(
      (m) =>
        m &&
        typeof m === "object" &&
        typeof m.role === "string" &&
        typeof m.content === "string"
    )
    .map((m) => ({
      role: m.role === "assistant" || m.role === "system" ? m.role : "user",
      content: m.content.trim(),
    }))
    .filter((m) => m.content)
    .slice(-8);
}

function buildCompaniumPrompt({ botId, content, history, attachment, scopeDirective, clientDataBlock }) {
  const recent = normalizeHistory(history);
  const historyBlock = recent.length
    ? [
        "HISTÓRICO RECENTE:",
        ...recent.map((m, i) => `${i + 1}. [${m.role}] ${m.content}`),
        "",
      ].join("\n")
    : "";

  // O arquivo em si vai no `attachments` do chat.send (visão para imagem, tool
  // pdf/image para PDF). Este aviso só orienta o agente a de fato considerá-lo.
  const attachmentBlock = attachment
    ? [
        "ANEXO DO USUÁRIO:",
        `- O usuário anexou um arquivo (${attachment.mimeType}, "${attachment.fileName}").`,
        "- Leia/interprete o conteúdo do anexo e use-o para responder.",
        "",
      ].join("\n")
    : "";

  return [
    "[COMPANIUM_CONTEXT]",
    "Você está respondendo no chat web da Companium.",
    `Bot solicitado pelo frontend: ${botId || "(default)"}`,
    "Canal/origem: companium-web-dashboard",
    "Modo: dashboard-analytics",
    "",
    // Hard tenant boundary decided server-side (restricted client bot vs internal
    // bot). ALWAYS present so the agent knows its scope explicitly.
    ...(scopeDirective ? [scopeDirective, ""] : []),
    // Restricted (client) turns: the server-fetched, RLS-scoped data for THIS
    // client. Injected right after the scope directive so it's the authoritative
    // source the agent must answer from (it has no DB access on this path).
    ...(clientDataBlock ? [clientDataBlock, ""] : []),
    "ESCOPO obrigatório nesta conversa:",
    "- CRM, métricas, mídia paga, relatórios, exportações e plots",
    "- NÃO agir como assistente operacional geral da Groohub",
    "- NÃO oferecer ClickUp, tarefas, pendências, prioridades ou automações fora do pedido",
    "- NÃO sugerir transformar o pedido em skill, cron ou automação, a menos que o usuário peça isso explicitamente",
    "",
    "REGRAS DE RESPOSTA:",
    "- Resposta normal: Markdown curto e escaneável",
    "- Se o usuário pedir gráfico e o gráfico couber no contrato da bridge, a resposta preferida é um bloco ```json com action:\"plot\"",
    "- NÃO usar MEDIA:, SVG/PNG avulso ou export como substituto de plot quando o usuário pediu gráfico",
    "- Se o gráfico não couber no contrato, responder em Markdown normal e não inventar schema parecido",
    "",
    "CONTRATO EXATO DE PLOT ACEITO PELA BRIDGE:",
    "{\"action\":\"plot\",\"title\":\"...\",\"summary\":\"...\",\"spec\":{\"type\":\"bar|line|pie\",\"title\":\"...\",\"x\":[\"...\"],\"series\":[{\"name\":\"...\",\"data\":[1,2,3]}]}}",
    "",
    "CAMPOS OPCIONAIS DO spec (SÓ PARA type:\"bar\", todos backward-compatible):",
    "- \"trend\": true  -> sobrepõe uma linha de tendência (regressão linear dos totais por categoria). Use quando o usuário pedir \"linha de tendência\"/\"tendência\".",
    "- \"stacked\": true -> empilha as séries por categoria.",
    "- \"orientation\": \"horizontal\" -> barras horizontais (ranking / rótulos longos).",
    "- Esses três campos só valem em type:\"bar\"; são ignorados em line/pie. Fora eles, NÃO adicionar outros campos ao spec.",
    "",
    "CAMPOS/FORMATOS PROIBIDOS EM PLOT:",
    "- {\"plot\":{...}}",
    "- {\"chart\":{...}}",
    "- xAxis, yAxis, labels, datasets, categories, values, legend, options",
    "- subtitle, meta, config, layout, theme",
    "- números formatados como texto em data, como \"R$ 1.234\", \"12,5%\", \"3,18x\"",
    "",
    "REGRAS DE DADOS PARA GRÁFICOS/MÉTRICAS:",
    "- Antes de concluir que um valor está zerado ou indisponível, verificar primeiro se há fechamento consolidado salvo no workspace",
    "- Priorizar fechamentos consolidados do workspace antes de concluir zero/sem dados",
    "- Considerar aliases e nome canônico do cliente",
    "- Se a série vier de checkpoints acumulados, deixar isso claro e não tratar como série diária bruta",
    "",
    "CONTRATO DE EXPORT (PDF/arquivo) ACEITO PELA BRIDGE:",
    "- Se o usuário pedir um PDF, arquivo, relatório para baixar, exportação, download ou \"me manda um PDF\", a resposta PREFERIDA é um bloco ```json com action:\"export\".",
    "- FORMATO EXATO:",
    "{\"action\":\"export\",\"kind\":\"pdf\",\"title\":\"Título do relatório\",\"filename\":\"nome-do-arquivo.pdf\",\"summary\":\"Resumo curto para o usuário\",\"content\":\"Conteúdo em Markdown que vira o PDF\"}",
    "- \"content\" é o corpo do relatório em Markdown (títulos, tabelas, listas); é ELE que a bridge renderiza dentro do PDF.",
    "- \"summary\" é a frase curta mostrada no chat junto do link de download.",
    "- CRÍTICO: NÃO responder \"PDF gerado\", \"segue o PDF\", \"segue o PDF agora\" ou similar em TEXTO LIVRE quando a intenção é export. Sem o bloco action:\"export\", NENHUM arquivo é criado e o usuário não recebe nada.",
    "- A bridge só anexa o arquivo se receber action:\"export\"; texto solto nunca gera anexo.",
    "- Use export apenas quando o usuário realmente quer um arquivo para baixar; para resposta normal, use Markdown comum.",
    "",
    "[/COMPANIUM_CONTEXT]",
    "",
    historyBlock,
    attachmentBlock,
    "MENSAGEM DO USUÁRIO:",
    content,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Export — parse the structured block, validate it, perform the side-effect.
// ---------------------------------------------------------------------------

class ExportError extends Error {
  /** @param {number} status HTTP status to surface (422 schema, 502 file/storage) */
  constructor(message, status, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Find a side-effect directive in the agent's text: a JSON object (typically
 * inside a fenced ```json block) whose action is "export" or "plot". Returns the
 * object or null. Requiring a known action means ordinary replies that merely
 * contain code fences never trigger a side-effect.
 */
const DIRECTIVE_ACTIONS = new Set(["export", "plot"]);
function extractDirective(content) {
  if (!content) return null;
  const candidates = [];

  // Fenced blocks (```json ... ``` or ``` ... ```).
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m;
  while ((m = fence.exec(content)) !== null) candidates.push(m[1]);

  // Bare object fallback: first '{' .. last '}'.
  const a = content.indexOf("{");
  const b = content.lastIndexOf("}");
  if (a !== -1 && b > a) candidates.push(content.slice(a, b + 1));

  for (const c of candidates) {
    let obj;
    try {
      obj = JSON.parse(c.trim());
    } catch {
      continue;
    }
    if (obj && typeof obj === "object" && DIRECTIVE_ACTIONS.has(obj.action)) {
      return obj;
    }
  }
  return null;
}

/** Sanitize a download filename to a safe basename with the right extension. */
function sanitizeFilename(name, kind, fallbackBase) {
  let n = typeof name === "string" ? basename(name).trim() : "";
  n = n.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "").slice(0, 120);
  if (!n) n = `${fallbackBase}.${kind}`;
  if (!n.toLowerCase().endsWith(`.${kind}`)) n = `${n}.${kind}`;
  return n;
}

const ATTACH_EXT_BY_MIME = { "image/png": "png", "image/jpeg": "jpg", "application/pdf": "pdf" };

/**
 * Valida e normaliza o anexo do corpo da requisição para o formato do chat.send
 * do Gateway: { mimeType, fileName, content:<base64 sem data:> }. Faz whitelist de
 * mime, cap de tamanho por tipo e checagem de assinatura (magic bytes) contra o
 * mime declarado. Ausência de anexo é válida (retorna attachment:null).
 * @returns {{ok:true, attachment:object|null} | {ok:false, status:number, error:string}}
 */
function normalizeInboundAttachment(raw) {
  if (raw == null) return { ok: true, attachment: null };
  if (typeof raw !== "object") return { ok: false, status: 400, error: "Anexo inválido." };

  const mimeType = typeof raw.mimeType === "string" ? raw.mimeType.toLowerCase().trim() : "";
  if (!ATTACH_ALLOWED_MIMES.has(mimeType)) {
    return { ok: false, status: 415, error: "Tipo de arquivo não suportado (use PNG, JPEG ou PDF)." };
  }
  // Aceita base64 puro ou data:URL; normaliza para base64 puro.
  const rawB64 = typeof raw.dataBase64 === "string" ? raw.dataBase64 : "";
  const b64 = rawB64.replace(/^data:[^;,]*;base64,/, "").trim();
  if (!b64) return { ok: false, status: 400, error: "Anexo vazio." };

  let bytes;
  try { bytes = Buffer.from(b64, "base64"); } catch { return { ok: false, status: 400, error: "Anexo inválido." }; }
  if (!bytes.length) return { ok: false, status: 400, error: "Anexo vazio." };

  const cap = mimeType === "application/pdf" ? MAX_ATTACH_PDF_BYTES : MAX_ATTACH_IMAGE_BYTES;
  if (bytes.length > cap) {
    return { ok: false, status: 413, error: `Arquivo muito grande (máx ${Math.round(cap / 1024 / 1024)}MB).` };
  }

  // Assinatura x mime declarado (defesa leve; o conteúdo vai para o modelo, não é executado).
  const okMagic =
    (mimeType === "image/png" &&
      bytes.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
    (mimeType === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8) ||
    (mimeType === "application/pdf" && bytes.slice(0, 5).toString("latin1") === "%PDF-");
  if (!okMagic) return { ok: false, status: 415, error: "O conteúdo não corresponde ao tipo do arquivo." };

  const fileName = sanitizeFilename(raw.fileName, ATTACH_EXT_BY_MIME[mimeType], "anexo");
  // content = base64 SEM prefixo data: (re-encodado a partir dos bytes já validados).
  return { ok: true, attachment: { mimeType, fileName, content: bytes.toString("base64") } };
}

/** Read bytes from an agent-produced file, with path-confinement. (Fallback path.) */
function readConfinedFile(file) {
  // Resolve symlinks, then require the real path to sit inside an allowed dir.
  let real;
  try {
    real = realpathSync(file);
  } catch {
    throw new ExportError(`file not found: ${file}`, 502);
  }
  const inside = EXPORT_ALLOWED_DIRS.some(
    (dir) => real === dir || real.startsWith(dir + pathSep)
  );
  if (!inside) {
    throw new ExportError(`file outside allowed dirs: ${real}`, 502);
  }
  let st;
  try {
    st = statSync(real);
  } catch {
    throw new ExportError(`cannot stat: ${real}`, 502);
  }
  if (!st.isFile()) throw new ExportError(`not a regular file: ${real}`, 502);
  if (st.size <= 0) throw new ExportError(`empty file: ${real}`, 502);
  if (st.size > MAX_EXPORT_BYTES) {
    throw new ExportError(`file too large: ${st.size}`, 502);
  }
  try {
    return readFileSync(real);
  } catch {
    throw new ExportError(`cannot read: ${real}`, 502);
  }
}

/**
 * Produce the export artifact bytes from a directive. Preferred path: the agent
 * supplies the report as markdown `content`, and the bridge renders it
 * deterministically (md verbatim, pdf via headless Chrome). A `file` path is
 * accepted as a fallback for agent-produced binaries.
 * @returns {Promise<{ kind, mimeType, filename, bytes: Buffer }>}
 * @throws {ExportError}
 */
async function produceExportArtifact(directive) {
  const kind = String(directive.kind || "").toLowerCase();
  const mimeType = EXPORT_KIND_MIME[kind];
  if (!mimeType) {
    throw new ExportError(`unsupported kind '${kind}'`, 422);
  }

  const filename = sanitizeFilename(directive.filename, kind, "export");
  const content = typeof directive.content === "string" ? directive.content : "";
  const title =
    (typeof directive.title === "string" && directive.title.trim()) ||
    filename.replace(/\.[^.]+$/, "");

  let bytes;
  if (content.trim()) {
    if (content.length > MAX_EXPORT_CONTENT_CHARS) {
      throw new ExportError("content too long", 422);
    }
    if (kind === "md") {
      bytes = Buffer.from(content, "utf8");
    } else {
      // kind === "pdf": render markdown -> styled HTML -> PDF.
      try {
        bytes = await renderPdf(markdownReportHtml(title, content));
      } catch (err) {
        throw new ExportError(`pdf render failed: ${err && err.message}`, 502);
      }
    }
  } else if (typeof directive.file === "string" && directive.file.trim()) {
    bytes = readConfinedFile(directive.file);
  } else {
    throw new ExportError("missing content", 422);
  }

  if (!bytes || bytes.length <= 0) {
    throw new ExportError("empty artifact", 502);
  }
  if (bytes.length > MAX_EXPORT_BYTES) {
    throw new ExportError(`artifact too large: ${bytes.length}`, 502);
  }
  return { kind, mimeType, filename, bytes };
}

// ---------------------------------------------------------------------------
// Supabase (service-role) — Storage + PostgREST via fetch (no client dep).
// ---------------------------------------------------------------------------

const exportEnabled = Boolean(SUPABASE_SERVICE_KEY);

// --- Signed download URLs ---------------------------------------------------
// The chat widget renders `<a href download>` / `<img src>` pointing at our
// download routes. A browser navigation/image fetch CANNOT attach the
// Authorization header, so those routes also accept a signed `?t=` capability
// token bound to the (unguessable) row id. Key derives from the service key, so
// no extra secret to manage. Tokens don't expire (artifacts are durable; revoke
// by deleting the row). The Authorization/JWT path stays for API clients.
const DOWNLOAD_SIGNING_SECRET =
  process.env.DOWNLOAD_SIGNING_SECRET || SUPABASE_SERVICE_KEY;

function signId(id) {
  return createHmac("sha256", DOWNLOAD_SIGNING_SECRET).update(id).digest("base64url");
}

function validDownloadToken(id, token) {
  if (!token || typeof token !== "string" || !DOWNLOAD_SIGNING_SECRET) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(signId(id));
  return a.length === b.length && timingSafeEqual(a, b);
}

function sbHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    ...extra,
  };
}

/**
 * Headers that make PostgREST run as the AUTHENTICATED USER: the anon key passes
 * the API gateway, the user's JWT sets the Postgres role + `auth.uid()`, so the
 * already-deployed RLS on the scoped views (scope_ads_ok / scope_kommo_ok via
 * user_client_scope) enforces the client boundary. No WHERE filter needed — the
 * DB refuses cross-client rows.
 */
function userScopedHeaders(userJwt) {
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${userJwt}` };
}

/**
 * Read this user's client scope row (service key).
 *   - resolves to the row      -> restricted client
 *   - resolves to null         -> CONFIRMED no row (staff / unmapped)
 *   - THROWS                    -> could not determine (caller must fail closed;
 *                                  never downgrade a possible client to staff)
 */
async function fetchUserClientScope(userId) {
  const url =
    `${SUPABASE_URL}/rest/v1/user_client_scope` +
    `?user_id=eq.${encodeURIComponent(userId)}` +
    `&select=client_id,client_slug,ads_names,cmpkeys&limit=1`;
  const res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`user_client_scope lookup ${res.status}`);
  const rows = await res.json(); // a parse failure here also throws -> fail closed
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/**
 * Is this user approved? (service key). Mirrors the frontend's approval gate
 * (user_approvals.status = 'approved'). THROWS on lookup error so the caller can
 * fail CLOSED — an unverifiable approval must never grant the broad internal agent.
 */
async function fetchIsApproved(userId) {
  const url =
    `${SUPABASE_URL}/rest/v1/user_approvals` +
    `?user_id=eq.${encodeURIComponent(userId)}` +
    `&select=status&limit=1`;
  const res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`user_approvals lookup ${res.status}`);
  const rows = await res.json(); // parse failure throws -> fail closed
  return Array.isArray(rows) && rows.length ? rows[0].status === "approved" : false;
}

/** YYYY-MM-DD for a date `days` before today (UTC). */
function isoDaysAgo(days) {
  const d = new Date(Date.now() - days * 86400000);
  return d.toISOString().slice(0, 10);
}

/**
 * Fetch the client's authoritative data, READ AS THE USER (RLS-scoped). Returns
 * a compact aggregation for injection. Any failure -> null (caller renders a
 * "no data" note; never falls back to unscoped reads).
 */
async function fetchClientSnapshot(userJwt) {
  if (!userJwt || !SUPABASE_ANON_KEY) return null;
  const from = isoDaysAgo(CLIENT_SNAPSHOT_DAYS);
  const to = isoDaysAgo(0);
  const h = userScopedHeaders(userJwt);
  const cap = CLIENT_SNAPSHOT_MAX_ROWS;

  // Ads (daily, per source) — ASCII-safe columns only to avoid encoding issues.
  const adsUrl =
    `${SUPABASE_URL}/rest/v1/v_meta_google_ads_daily` +
    `?Dia=gte.${from}&Dia=lte.${to}` +
    `&select=Dia,Client,Fonte_Ads,Valor_usado_BRL,Lead,Cliques_no_link,Alcance,Resultados` +
    `&order=Dia&limit=${cap}`;
  // CRM (aggregated events).
  const crmUrl =
    `${SUPABASE_URL}/rest/v1/v_kommo_crm_agg` +
    `?event_date=gte.${from}&event_date=lte.${to}` +
    `&select=event_type,event_date,origem,especialidade,qtd,valor` +
    `&order=event_date&limit=${cap}`;

  const getJson = async (url) => {
    const res = await fetch(url, { headers: h });
    if (!res.ok) return null; // includes 401/403 -> treat as no data, never unscoped
    return res.json().catch(() => null);
  };

  const [adsRows, crmRows] = await Promise.all([getJson(adsUrl), getJson(crmUrl)]);
  if (adsRows == null && crmRows == null) return null;

  const num = (v) => {
    const n = typeof v === "number" ? v : parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };

  // Ads totals per source (Meta / Google).
  const adsBySource = {};
  for (const r of Array.isArray(adsRows) ? adsRows : []) {
    const k = r.Fonte_Ads || "?";
    const a = (adsBySource[k] ||= { investimento: 0, leads: 0, cliques: 0, alcance: 0, resultados: 0 });
    a.investimento += num(r.Valor_usado_BRL);
    a.leads += num(r.Lead);
    a.cliques += num(r.Cliques_no_link);
    a.alcance += num(r.Alcance);
    a.resultados += num(r.Resultados);
  }
  // CRM totals per event type.
  const crmByEvent = {};
  for (const r of Array.isArray(crmRows) ? crmRows : []) {
    const k = r.event_type || "?";
    const c = (crmByEvent[k] ||= { qtd: 0, valor: 0 });
    c.qtd += num(r.qtd);
    c.valor += num(r.valor);
  }

  return {
    periodo: { de: from, ate: to },
    ads_por_fonte: adsBySource,
    crm_por_evento: crmByEvent,
    _linhas: { ads: Array.isArray(adsRows) ? adsRows.length : 0, crm: Array.isArray(crmRows) ? crmRows.length : 0 },
  };
}

/** Build the injected authoritative-data block for a restricted (client) turn. */
function buildClientDataBlock(tenantContext, snapshot) {
  const cliente = tenantContext.clientSlug || tenantContext.clientId || "(cliente)";
  if (!snapshot) {
    return [
      `[DADOS_DO_CLIENTE cliente="${cliente}" status="indisponivel"]`,
      "Não foi possível carregar os dados deste cliente agora. Informe isso ao usuário e NÃO tente buscar por outra via.",
      "[/DADOS_DO_CLIENTE]",
    ].join("\n");
  }
  return [
    `[DADOS_DO_CLIENTE cliente="${cliente}" periodo="${snapshot.periodo.de}..${snapshot.periodo.ate}"]`,
    "Estes são os ÚNICOS dados autorizados nesta conversa (já filtrados no banco para este cliente).",
    "Responda SOMENTE com base neles. Não consulte o banco nem outra fonte.",
    "ADS_POR_FONTE (JSON): " + JSON.stringify(snapshot.ads_por_fonte),
    "CRM_POR_EVENTO (JSON): " + JSON.stringify(snapshot.crm_por_evento),
    "[/DADOS_DO_CLIENTE]",
  ].join("\n");
}

/** Upload bytes to a private bucket. Throws on failure. */
async function storageUpload(bucket, objectPath, bytes, mimeType) {
  const url = `${SUPABASE_URL}/storage/v1/object/${bucket}/${objectPath}`;
  const res = await fetch(url, {
    method: "POST",
    headers: sbHeaders({ "Content-Type": mimeType, "x-upsert": "false" }),
    body: bytes,
  });
  if (!res.ok) {
    throw new ExportError(
      `storage upload ${res.status}`,
      502,
      (await res.text().catch(() => "")).slice(0, 300)
    );
  }
}

/** Best-effort removal of a stored object (used to roll back a failed insert). */
async function storageRemove(bucket, objectPath) {
  try {
    await fetch(
      `${SUPABASE_URL}/storage/v1/object/${bucket}/${objectPath}`,
      { method: "DELETE", headers: sbHeaders() }
    );
  } catch {
    /* ignore */
  }
}

/** Insert the artifact metadata row. Throws on failure. */
async function insertArtifactRow(row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/chatbot_artifacts`, {
    method: "POST",
    headers: sbHeaders({
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    }),
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    throw new ExportError(
      `row insert ${res.status}`,
      502,
      (await res.text().catch(() => "")).slice(0, 300)
    );
  }
}

/** Fetch one artifact row by id (service-role; ownership checked by caller). */
async function getArtifactRow(id) {
  const url = `${SUPABASE_URL}/rest/v1/chatbot_artifacts?id=eq.${id}&select=id,user_id,filename,mime_type,storage_path&limit=1`;
  const res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) return null;
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/** Download an object's bytes from a private bucket. */
async function storageDownload(bucket, objectPath) {
  const url = `${SUPABASE_URL}/storage/v1/object/${bucket}/${objectPath}`;
  const res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Perform the export side-effect: upload + record. Returns the BotReply.
 * @throws {ExportError}
 */
async function performExport({ userId, botId, directive }) {
  if (!exportEnabled) {
    throw new ExportError("export disabled (no service key)", 502);
  }
  const { kind, mimeType, filename, bytes } = await produceExportArtifact(directive);

  const id = randomUUID();
  const objectPath = `${userId}/${id}.${kind}`;

  await storageUpload(ARTIFACTS_BUCKET, objectPath, bytes, mimeType);
  try {
    await insertArtifactRow({
      id,
      user_id: userId,
      bot_id: botId,
      kind,
      filename,
      mime_type: mimeType,
      storage_path: objectPath,
    });
  } catch (err) {
    await storageRemove(ARTIFACTS_BUCKET, objectPath); // don't leave an orphaned object
    throw err;
  }

  const summary =
    (typeof directive.summary === "string" && directive.summary.trim()) ||
    "Pronto — seu arquivo está disponível para download.";

  return {
    type: "service_request",
    service: "export",
    content: summary,
    artifact: {
      kind,
      filename,
      mimeType,
      source: `/api/openclaw/files/${id}?t=${signId(id)}`,
    },
  };
}

// ---------------------------------------------------------------------------
// Reenvio de artifact — quando o usuário pede "me manda o PDF de novo", não
// dependemos da memória textual do modelo: localizamos o último artifact da
// conversa (via transcript) ou do usuário e devolvemos um service_request com
// ele. Ownership é sempre reconfirmado antes de reenviar.
// ---------------------------------------------------------------------------

/** É um pedido de REENVIAR/mostrar um arquivo já gerado (e não criar um novo)? */
function isResendRequest(text) {
  // Normaliza acentos (\b do JS não casa em torno de ê/á/ç) e caixa.
  const t = (text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  if (!t || t.length > 200) return false;
  // Pedido de CRIAÇÃO -> não é reenvio (deixa o agente gerar do zero).
  if (/\b(gere|gerar|gera|crie|criar|cria|faca|fazer|monte|montar|exporte|exportar|elabore|produza|quero um|preciso de um)\b/.test(t)) {
    return false;
  }
  // Precisa referenciar um arquivo existente.
  if (!/\b(pdf|arquivo|relatorio|documento|export|anexo|planilha)\b/.test(t)) {
    return false;
  }
  // E ter verbo de reenvio / cobrança.
  return /\b(envie|envia|enviar|envio|manda|mande|mandar|reenvie|reenvia|reenviar|mostra|mostre|mostrar|cade|onde esta|de novo|novamente|nao (?:me )?(?:enviou|mandou|chegou|recebi|veio|apareceu))\b/.test(t);
}

/** Último artifact do usuário (mais recente), pela tabela. */
async function latestUserArtifact(userId) {
  const url =
    `${SUPABASE_URL}/rest/v1/chatbot_artifacts?user_id=eq.${encodeURIComponent(userId)}` +
    `&select=id,kind,filename,mime_type,created_at&order=created_at.desc&limit=1`;
  const res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) return null;
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/**
 * Resolve o artifact a reenviar. Prioridade: (1) último artifact citado no
 * transcript da conversa atual (escopo da conversa); (2) último artifact recente
 * do usuário. Sempre reconfirma ownership (user_id) — mantém o contrato de segurança.
 * @returns {Promise<{id,filename,mimeType,kind}|null>}
 */
async function resolveResendArtifact({ conversationId, userId }) {
  // (1) escopo da conversa: varre o transcript de trás pra frente.
  if (UUID_RE.test(conversationId || "")) {
    try {
      const msgs = await loadTranscriptMessages(conversationId);
      for (let i = msgs.length - 1; i >= 0; i--) {
        const src = msgs[i] && msgs[i].metadata && msgs[i].metadata.artifact
          ? msgs[i].metadata.artifact.source : null;
        const m = typeof src === "string" ? /\/files\/([0-9a-fA-F-]{36})/.exec(src) : null;
        if (m) {
          const row = await getArtifactRow(m[1]); // service-role
          if (row && row.user_id === userId) {
            return {
              id: row.id, filename: row.filename, mimeType: row.mime_type,
              kind: (row.filename.split(".").pop() || "pdf").toLowerCase(),
            };
          }
        }
      }
    } catch { /* cai pro fallback do usuário */ }
  }
  // (2) escopo do usuário: último artifact recente.
  const row = await latestUserArtifact(userId);
  if (row) return { id: row.id, filename: row.filename, mimeType: row.mime_type, kind: row.kind };
  return null;
}

/** Monta um service_request reutilizando um artifact já salvo (source re-assinado). */
function buildResendReply(art) {
  return {
    type: "service_request",
    service: "export",
    content: `Aqui está o arquivo novamente: **${art.filename}**`,
    artifact: {
      kind: art.kind,
      filename: art.filename,
      mimeType: art.mimeType,
      source: `/api/openclaw/files/${art.id}?t=${signId(art.id)}`,
    },
  };
}

// ---------------------------------------------------------------------------
// Plot — validate the spec (+ optional thumbnail), insert a user-owned row.
// ---------------------------------------------------------------------------

/**
 * Validate a plot directive: the chart `spec` is the durable record; an optional
 * `file` is a rendered PNG thumbnail the agent already wrote to disk.
 * @returns {{ title: string|null, spec: object, thumbBytes: Buffer|null }}
 * @throws {ExportError}
 */
function validatePlot(directive) {
  const spec = directive.spec;
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw new ExportError("missing or invalid spec", 422);
  }
  // Shape: type ∈ {bar,line,pie}, x is a non-empty array, series is a non-empty
  // array of { name, data:number[] }. Keeps malformed/empty charts out.
  const type = String(spec.type || "").toLowerCase();
  if (!["bar", "line", "pie"].includes(type)) {
    throw new ExportError(`unsupported plot type '${spec.type}'`, 422);
  }
  if (!Array.isArray(spec.x) || spec.x.length === 0) {
    throw new ExportError("spec.x must be a non-empty array", 422);
  }
  if (!Array.isArray(spec.series) || spec.series.length === 0) {
    throw new ExportError("spec.series must be a non-empty array", 422);
  }
  for (const s of spec.series) {
    if (!s || typeof s !== "object" || !Array.isArray(s.data)) {
      throw new ExportError("each series needs a data array", 422);
    }
    if (!s.data.every((n) => typeof n === "number" && isFinite(n))) {
      throw new ExportError("series data must be finite numbers", 422);
    }
  }
  let specJson;
  try {
    specJson = JSON.stringify(spec);
  } catch {
    throw new ExportError("spec not serializable", 422);
  }
  if (Buffer.byteLength(specJson, "utf8") > MAX_SPEC_BYTES) {
    throw new ExportError("spec too large", 422);
  }

  const title =
    typeof directive.title === "string" && directive.title.trim()
      ? directive.title.trim().slice(0, 200)
      : null;

  // Optional thumbnail: same path-confinement rules as an export file.
  let thumbBytes = null;
  const file = directive.file;
  if (typeof file === "string" && file.trim()) {
    let real;
    try {
      real = realpathSync(file);
    } catch {
      throw new ExportError(`thumbnail not found: ${file}`, 502);
    }
    const inside = EXPORT_ALLOWED_DIRS.some(
      (dir) => real === dir || real.startsWith(dir + pathSep)
    );
    if (!inside) {
      throw new ExportError(`thumbnail outside allowed dirs: ${real}`, 502);
    }
    let st;
    try {
      st = statSync(real);
    } catch {
      throw new ExportError(`cannot stat thumbnail: ${real}`, 502);
    }
    if (!st.isFile() || st.size <= 0) {
      throw new ExportError(`invalid thumbnail: ${real}`, 502);
    }
    if (st.size > MAX_THUMB_BYTES) {
      throw new ExportError(`thumbnail too large: ${st.size}`, 502);
    }
    try {
      thumbBytes = readFileSync(real);
    } catch {
      throw new ExportError(`cannot read thumbnail: ${real}`, 502);
    }
  }

  return { title, spec, thumbBytes };
}

/** Insert a plot metadata row. Throws on failure. */
async function insertPlotRow(row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/chatbot_plots`, {
    method: "POST",
    headers: sbHeaders({
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    }),
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    throw new ExportError(
      `plot insert ${res.status}`,
      502,
      (await res.text().catch(() => "")).slice(0, 300)
    );
  }
}

/** Fetch one plot row by id (service-role; ownership checked by caller). */
async function getPlotRow(id) {
  const url = `${SUPABASE_URL}/rest/v1/chatbot_plots?id=eq.${id}&select=id,user_id,title,spec,thumbnail_path&limit=1`;
  const res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) return null;
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/** Delete a plot row scoped to its owner. Returns the deleted rows (may be []). */
async function deletePlotRow(id, userId) {
  const url = `${SUPABASE_URL}/rest/v1/chatbot_plots?id=eq.${id}&user_id=eq.${userId}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: sbHeaders({ Prefer: "return=representation" }),
  });
  if (!res.ok) return null;
  return res.json().catch(() => []);
}

/** List the user's plots, newest first. */
async function listPlots(userId) {
  const url =
    `${SUPABASE_URL}/rest/v1/chatbot_plots` +
    `?user_id=eq.${encodeURIComponent(userId)}` +
    `&select=id,title,spec,thumbnail_path,created_at&order=created_at.desc`;
  const res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`plots list ${res.status}`);
  return res.json();
}

/** List the user's artifacts, newest first. */
async function listArtifacts(userId) {
  const url =
    `${SUPABASE_URL}/rest/v1/chatbot_artifacts` +
    `?user_id=eq.${encodeURIComponent(userId)}` +
    `&select=id,kind,filename,mime_type,created_at&order=created_at.desc`;
  const res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`artifacts list ${res.status}`);
  return res.json();
}

/** Rename a plot (title), scoped to owner. Returns updated rows (may be []). */
async function updatePlotTitle(id, userId, title) {
  const url = `${SUPABASE_URL}/rest/v1/chatbot_plots?id=eq.${id}&user_id=eq.${encodeURIComponent(userId)}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: sbHeaders({ "Content-Type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify({ title }),
  });
  if (!res.ok) return null;
  return res.json().catch(() => []);
}

/** Rename an artifact (filename), scoped to owner. Returns updated rows (may be []). */
async function updateArtifactFilename(id, userId, filename) {
  const url = `${SUPABASE_URL}/rest/v1/chatbot_artifacts?id=eq.${id}&user_id=eq.${encodeURIComponent(userId)}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: sbHeaders({ "Content-Type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify({ filename }),
  });
  if (!res.ok) return null;
  return res.json().catch(() => []);
}

/** Delete an artifact row scoped to owner. Returns deleted rows (may be []). */
async function deleteArtifactRow(id, userId) {
  const url = `${SUPABASE_URL}/rest/v1/chatbot_artifacts?id=eq.${id}&user_id=eq.${encodeURIComponent(userId)}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: sbHeaders({ Prefer: "return=representation" }),
  });
  if (!res.ok) return null;
  return res.json().catch(() => []);
}

/**
 * Perform the plot side-effect: optional thumbnail upload + row insert. Returns
 * the BotReply.
 * @throws {ExportError}
 */
async function performPlot({ userId, botId, directive }) {
  if (!exportEnabled) {
    throw new ExportError("plot disabled (no service key)", 502);
  }
  const { title, spec, thumbBytes } = validatePlot(directive);

  const id = randomUUID();
  let thumbnailPath = null;

  // Prefer an agent-supplied PNG; otherwise render one from the spec ourselves.
  // Thumbnail generation is best-effort — the spec is the durable record, so a
  // render failure must not fail the whole plot.
  let png = thumbBytes;
  if (!png) {
    try {
      png = await renderPng(chartHtml({ ...spec, title: spec.title || title }));
    } catch (err) {
      console.error(`[plot] thumbnail render failed:`, err && err.message);
      png = null;
    }
  }
  if (png) {
    thumbnailPath = `${userId}/${id}.png`;
    await storageUpload(PLOTS_BUCKET, thumbnailPath, png, PLOT_THUMB_MIME);
  }

  try {
    await insertPlotRow({
      id,
      user_id: userId,
      bot_id: botId,
      title,
      spec,
      thumbnail_path: thumbnailPath,
    });
  } catch (err) {
    if (thumbnailPath) await storageRemove(PLOTS_BUCKET, thumbnailPath);
    throw err;
  }

  const summary =
    (typeof directive.summary === "string" && directive.summary.trim()) ||
    "Pronto — seu gráfico foi salvo.";

  const plot = { id, title: title || "", spec };
  if (thumbnailPath) {
    plot.thumbnailUrl = `/api/openclaw/plots/${id}/thumb.png?t=${signId(id)}`;
  }

  return {
    type: "service_request",
    service: "plot",
    content: summary,
    plot,
  };
}

// ---------------------------------------------------------------------------
// Agent selection — catalog (chatbot_bots) + per-user settings (user_bot_settings).
// Writes are admin-only via RLS; the bridge reads with the service key and
// AUTHORIZES the requested agent per request (never trusts the client's botId).
// ---------------------------------------------------------------------------

class AgentPolicyError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Small in-memory cache of the (rarely-changing) bot catalog.
let botsCache = { at: 0, byId: new Map(), defaultId: null };
const BOTS_CACHE_MS = Number(process.env.BOTS_CACHE_MS || 30_000);

async function getBots() {
  if (botsCache.byId.size && Date.now() - botsCache.at < BOTS_CACHE_MS) {
    return botsCache;
  }
  // Include the tenancy columns. `access_mode`/`tenant_id`/`allowed_clinic_ids`/
  // `allowed_capabilities` may be absent on a DB that predates the tenancy
  // migration; normalizeBotRow() defaults those to internal_unrestricted, so the
  // select is forward-compatible either way (PostgREST ignores unknown cols only
  // if present — see migration; until applied, keep the base columns working).
  const cols = "id,enabled,is_default,access_mode,tenant_id,allowed_clinic_ids,allowed_capabilities";
  const url = `${SUPABASE_URL}/rest/v1/chatbot_bots?select=${cols}`;
  let res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) {
    // Fallback for a catalog without the tenancy columns yet (pre-migration).
    res = await fetch(`${SUPABASE_URL}/rest/v1/chatbot_bots?select=id,enabled,is_default`, {
      headers: sbHeaders(),
    });
  }
  if (!res.ok) throw new Error(`bots catalog ${res.status}`);
  const rows = await res.json();
  const byId = new Map(rows.map((b) => [b.id, b]));
  const def = rows.find((b) => b.is_default);
  botsCache = { at: Date.now(), byId, defaultId: def ? def.id : null };
  return botsCache;
}

async function getUserBotSettings(userId) {
  const url =
    `${SUPABASE_URL}/rest/v1/user_bot_settings` +
    `?user_id=eq.${encodeURIComponent(userId)}` +
    `&select=bot_id,can_switch,allowed_bots&limit=1`;
  const res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) return null;
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/**
 * Resolve + authorize the agent for a chat request.
 * - No user row -> fall back to the catalog's default bot, can_switch=false.
 * - Empty requestedBotId -> use the user's assignment.
 * - Allowed if requested === assignment, OR (can_switch AND requested ∈ allowed_bots).
 * - The requested bot must exist AND be enabled in the catalog.
 * @returns {Promise<{ agentId: string, botRow: Record<string, any> }>}
 * @throws {AgentPolicyError}
 */
async function resolveAgent(userId, requestedBotId) {
  const bots = await getBots();
  const settings = await getUserBotSettings(userId);

  const assigned = (settings && settings.bot_id) || bots.defaultId;
  if (!assigned) throw new AgentPolicyError(500, "No default bot configured.");

  const canSwitch = !!(settings && settings.can_switch);
  const allowed = Array.isArray(settings && settings.allowed_bots)
    ? settings.allowed_bots
    : [];

  const requested =
    (typeof requestedBotId === "string" && requestedBotId.trim()) || assigned;

  const bot = bots.byId.get(requested);
  if (!bot || !bot.enabled) {
    throw new AgentPolicyError(400, "Unknown or disabled bot.");
  }

  const permitted =
    requested === assigned || (canSwitch && allowed.includes(requested));
  if (!permitted) {
    throw new AgentPolicyError(403, "Not allowed to use this bot.");
  }

  // Return the catalog row too: the tenancy layer derives the tenantContext from
  // it server-side (access_mode / tenant_id / allowed_clinic_ids / capabilities).
  return { agentId: requested, botRow: bot };
}

// Companium service layer — instantiated once (stateless singletons). The client
// isolates the data source; the query/permission services own scoping + gating.
const companiumClient = new CompaniumClient({
  baseUrl: SUPABASE_URL,
  headers: () => sbHeaders(),
});
const companiumQuery = new CompaniumQueryService({ client: companiumClient });
const companiumPermissions = new CompaniumPermissionService();

/**
 * Validate + authorize an agent side-effect directive under a tenantContext, and
 * emit the audit line. Internal bots pass through (explicit allow); restricted
 * bots are gated by capability/tenant. Throws TenantPermissionError (403) or
 * IntentValidationError (422).
 * @param {{ directive: object, tenantContext: import('./tenancy.js').TenantContext, botId: string }} args
 */
function authorizeDirective({ directive, tenantContext, botId }) {
  const intent = directiveToIntent(directive);
  if (!intent) return; // not a side-effect; nothing to gate
  const mode = contextLabel(tenantContext);
  const restricted = tenantContext && tenantContext.mode === "restricted";

  // A restricted (client) turn must NEVER read an agent-produced file off disk:
  // `directive.file` is model-authored text (prompt-injectable) and EXPORT_ALLOWED_DIRS
  // is a SHARED workspace that can hold other tenants' data. Client export/plot must be
  // content-only — refuse any file-sourced artifact before perform*/validatePlot reads it.
  if (restricted && typeof directive.file === "string" && directive.file.trim()) {
    console.warn(
      `[tenancy] audit bot=${botId} user=${tenantContext.userId} mode=${mode} intent=${intent.type} validation=ok result=blocked reason=file_source_forbidden_for_restricted`,
    );
    throw new TenantPermissionError("File-based artifacts are not allowed for this account.");
  }

  try {
    companiumQuery.validateStructuredIntent(intent);
  } catch (err) {
    // Internal bots keep today's behavior: the downstream perform* validators own
    // the final say, so a shape warning here must NOT introduce a new rejection.
    // Restricted bots fail closed on invalid payloads.
    if (restricted) {
      console.warn(
        `[tenancy] audit bot=${botId} user=${tenantContext.userId} mode=${mode} intent=${intent.type} validation=invalid result=blocked reason=${err && err.message}`,
      );
      throw err;
    }
    console.warn(
      `[tenancy] audit bot=${botId} user=${tenantContext.userId} mode=${mode} intent=${intent.type} validation=warn result=deferred reason=${err && err.message}`,
    );
  }
  try {
    const decision = companiumPermissions.assertIntentAllowed({ intent, tenantContext });
    console.log(
      `[tenancy] audit bot=${botId} user=${tenantContext.userId} mode=${mode} intent=${intent.type} validation=ok result=executed cap=${decision.capability}`,
    );
  } catch (err) {
    console.warn(
      `[tenancy] audit bot=${botId} user=${tenantContext.userId} mode=${mode} intent=${intent.type} validation=ok result=blocked reason=${err && err.message}`,
    );
    throw err;
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const app = express();
app.disable("x-powered-by");
// 16mb cobre um anexo base64 (~13MB p/ um PDF de 10MB) + o resto do corpo. O
// bridge é interno (127.0.0.1) e atrás de JWT, então o limite maior é aceitável.
app.use(express.json({ limit: process.env.CHAT_JSON_LIMIT || "16mb" }));

// Health
app.get("/", (_req, res) => {
  res.status(200).json({ ok: true, service: "openclaw-bridge" });
});
app.get("/api/openclaw/health", (_req, res) => {
  res.status(200).json({ ok: true, inFlight, exportEnabled });
});

// --- Background turns: persist a reply when the browser left mid-turn ---------
// The run keeps going on the Gateway after a disconnect (it isn't cancelled), so
// when it finishes with no client attached we write the result into the same
// chatbot_transcripts blob the frontend uses. Service key bypasses RLS.

async function loadTranscriptMessages(conversationId) {
  const url = `${SUPABASE_URL}/rest/v1/chatbot_transcripts?conversation_id=eq.${conversationId}&select=messages&limit=1`;
  const res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) return [];
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && Array.isArray(rows[0]?.messages) ? rows[0].messages : [];
}

async function upsertTranscript(conversationId, userId, messages) {
  const now = new Date().toISOString();
  await fetch(`${SUPABASE_URL}/rest/v1/chatbot_transcripts`, {
    method: "POST",
    headers: sbHeaders({ "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" }),
    body: JSON.stringify({ conversation_id: conversationId, user_id: userId, messages, updated_at: now }),
  });
  await fetch(`${SUPABASE_URL}/rest/v1/chatbot_conversations?id=eq.${conversationId}`, {
    method: "PATCH",
    headers: sbHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ updated_at: now }),
  });
}

/** Append the user message (if missing) + the assistant reply to the transcript. */
async function persistBackgroundReply({ conversationId, userId, userContent, reply }) {
  if (!UUID_RE.test(conversationId || "")) return; // not a real conversation id
  const messages = await loadTranscriptMessages(conversationId);
  const last = messages[messages.length - 1];
  // The frontend saves the user message on send; append it only if it's not there
  // yet (covers the race where that write hasn't landed).
  if (!last || last.role !== "user" || last.content !== userContent) {
    messages.push({
      id: `bg-user-${Date.now()}`, role: "user", content: userContent,
      timestamp: Date.now(), status: "sent",
    });
  }
  const metadata =
    reply.type === "service_request"
      ? { intentType: "service_request", service: reply.service, artifact: reply.artifact, plot: reply.plot, actionResults: reply.actionResults }
      : undefined;
  messages.push({
    id: `bg-bot-${Date.now()}`, role: "assistant", content: reply.content,
    timestamp: Date.now(), status: "sent", ...(metadata ? { metadata } : {}),
  });
  await upsertTranscript(conversationId, userId, messages);
}

/**
 * Streaming chat turn (NDJSON over a chunked response). Emits:
 *   {"type":"delta","text":"..."}   incremental text
 *   {"type":"final","reply":{...}}  authoritative BotReply (message OR service_request)
 *   {"type":"error","error":"..."}  fatal error
 * The Gateway sends CUMULATIVE snapshots, so we diff them into increments. The
 * final text runs the SAME directive -> side-effect logic as the CLI path.
 * This function owns the response lifecycle and never throws to the caller.
 */
async function streamChatTurn({ req, res, userId, botId, agentId, prompt, sessionId, started, conversationId, userContent, attachment, tenantContext }) {
  res.status(200);
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no"); // stop nginx from buffering the stream
  res.flushHeaders?.();

  const writeFrame = (obj) => {
    if (!res.writableEnded) res.write(JSON.stringify(obj) + "\n");
  };

  // Background turns: if the browser disconnects (leaves the page / switches
  // conversation), DON'T abort — the Gateway run keeps going and we persist the
  // result on completion so it's there when the user returns.
  const ac = new AbortController();
  let clientGone = false;
  const onClose = () => {
    clientGone = true;
    // DIAGNÓSTICO: prova se o browser realmente desconecta ao trocar de conversa.
    console.log(`[chat] client left mid-turn (bg) session=${sessionId} conv=${conversationId} ms=${Date.now() - started}`);
  };
  req.on("close", onClose);

  // Cumulative snapshots -> incremental deltas for the NDJSON contract.
  let lastText = "";
  const onDelta = (snapshot) => {
    const text = typeof snapshot === "string" ? snapshot : "";
    const delta = text.startsWith(lastText) ? text.slice(lastText.length) : text;
    lastText = text;
    if (delta) writeFrame({ type: "delta", text: delta });
  };

  // DIAGNÓSTICO: início de turno — pra correlacionar com disconnect/abort.
  console.log(`[chat] turn start session=${sessionId} conv=${conversationId}`);
  try {
    const { finalText, stopReason } = await runAgentStream({
      agentId,
      content: prompt,
      sessionId,
      onDelta,
      signal: ac.signal,
      runTimeoutMs: RUN_TIMEOUT_MS,
      attachments: attachment ? [attachment] : undefined,
    });

    // Same post-processing as the non-streaming path.
    const directive = extractDirective(finalText);
    let reply;
    // Validate + authorize the classified side-effect under the tenantContext.
    // Blocked/invalid on a restricted bot -> safe message instead of the effect
    // (the stream is already committed, so we can't change the status code).
    let directiveBlocked = false;
    if (directive) {
      try {
        authorizeDirective({ directive, tenantContext, botId: agentId });
      } catch (err) {
        if (err instanceof TenantPermissionError || err instanceof IntentValidationError) {
          directiveBlocked = true;
        } else {
          throw err;
        }
      }
    }
    if (directiveBlocked) {
      reply = { type: "message", content: "Isso está fora do escopo autorizado deste assistente." };
    } else if (directive && directive.action === "export") {
      reply = await performExport({ userId, botId, directive });
      console.log(
        `[chat] stream export ok user=${userId} bot=${botId} kind=${reply.artifact.kind} ms=${Date.now() - started}`,
      );
    } else if (directive && directive.action === "plot") {
      reply = await performPlot({ userId, botId, directive });
      console.log(
        `[chat] stream plot ok user=${userId} bot=${botId} id=${reply.plot.id} ms=${Date.now() - started}`,
      );
    } else {
      const stripped = (finalText || "").replace(CONTROL_MARKER, "").trim();
      if (!stripped) {
        // Turno terminou sem texto: normalmente estouro de contexto / compactação
        // no meio de uma coleta de dados pesada, ou run abortado pelo provider.
        // Não devolver o fallback mudo sem rastro — logar o motivo real (stopReason)
        // e responder algo acionável.
        console.warn(
          `[chat] stream empty-turn user=${userId} bot=${botId} stopReason=${stopReason || "?"} ms=${Date.now() - started}`,
        );
        reply = { type: "message", content: FALLBACK_MESSAGE };
      } else {
        reply = buildMessageReply(stripped);
        console.log(`[chat] stream ok user=${userId} bot=${botId} ms=${Date.now() - started}`);
      }
    }
    // A desconexão do browser NÃO é detectável atrás do nginx (clientGone nunca
    // vira true). Então SEMPRE persistimos a resposta no transcript — é isso que
    // faz ela sobreviver à troca de conversa / fechamento de aba. O upsert grava
    // o array completo; se o cliente ainda estava conectado e o frontend também
    // gravou, é last-writer-wins com o MESMO conteúdo (sem duplicar/perder).
    await persistBackgroundReply({ conversationId, userId, userContent, reply }).catch((e) =>
      console.error(`[chat] persist failed conv=${conversationId}:`, e && e.message),
    );
    console.log(`[chat] turn persisted user=${userId} conv=${conversationId} ms=${Date.now() - started}`);
    // Caso ainda conectado, manda o frame final pra exibição ao vivo (no-op se o
    // socket já morreu).
    writeFrame({ type: "final", reply });
  } catch (err) {
    const msg =
      err instanceof ExportError
        ? "Não foi possível gerar o arquivo. Tente novamente."
        : "A resposta foi interrompida antes de terminar. Tente reenviar.";
    console.error(
      `[chat] stream failure user=${userId} session=${sessionId}:`,
      err && err.message,
    );
    // Persiste uma mensagem de erro para o turno TERMINAR de fato no transcript
    // (evita o "Gerando…" eterno quando o run é abortado) e mostra o motivo.
    await persistBackgroundReply({
      conversationId, userId, userContent,
      reply: { type: "message", content: msg },
    }).catch((e) => console.error(`[chat] persist(err) failed conv=${conversationId}:`, e && e.message));
    writeFrame({ type: "error", error: msg });
  } finally {
    req.off("close", onClose);
    if (!res.writableEnded) res.end();
  }
}

app.post("/api/openclaw/chat", async (req, res) => {
  // 1) Auth — derive userId ONLY from the verified token.
  let userId;
  try {
    userId = await verifyUser(req.headers.authorization);
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(401).json({ error: "Authentication required." });
    }
    console.error("[auth] unexpected error:", err);
    return res.status(500).json({ error: "Server error." });
  }

  // 2) Validate body.
  const body = req.body || {};
  const botId = typeof body.botId === "string" ? body.botId.trim() : ""; // "" -> assignment
  const message = body.message;
  const history = body.history;

  if (
    !message ||
    typeof message !== "object" ||
    message.role !== "user" ||
    typeof message.content !== "string"
  ) {
    return res.status(400).json({ error: "Invalid message." });
  }
  const userText = message.content.trim();

  // Anexo opcional (imagem/PDF): valida e normaliza para o chat.send.
  const attRes = normalizeInboundAttachment(body.attachment);
  if (!attRes.ok) {
    return res.status(attRes.status).json({ error: attRes.error });
  }
  const attachment = attRes.attachment;

  // Precisa de texto OU anexo. Se só veio anexo, dá uma instrução default.
  if (!userText && !attachment) {
    return res.status(400).json({ error: "Empty message." });
  }
  if (userText.length > MAX_MESSAGE_CHARS) {
    return res.status(400).json({ error: "Message too long." });
  }
  const content = userText || "Leia e interprete o arquivo anexado.";

  // Resolve + authorize the agent for this user (assignment / allowed switch set).
  // The client's botId is a REQUEST, not authority — resolveAgent enforces it.
  let agentId;
  let botRow;
  try {
    ({ agentId, botRow } = await resolveAgent(userId, botId));
  } catch (err) {
    if (err instanceof AgentPolicyError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error(`[chat] resolveAgent error user=${userId}:`, err && err.message);
    return res.status(502).json({ error: "Could not resolve the assistant." });
  }

  // Resolve the tenantContext from the AUTHENTICATED USER (not the bot). A user
  // mapped in user_client_scope is a restricted CLIENT; everyone else is staff
  // (internal_unrestricted = today's behavior, unchanged). botRow is kept for the
  // internal path but no longer decides tenancy.
  const userJwt = extractBearer(req.headers.authorization);
  let tenantContext;
  try {
    tenantContext = await resolveTenantForUser({ userId, fetchScope: fetchUserClientScope });
  } catch (err) {
    // Could not determine the user's scope -> fail CLOSED. Refusing the turn is
    // safer than risking a client being served as staff (unscoped).
    console.error(`[tenancy] scope lookup failed user=${userId}:`, err && err.message);
    return res.status(503).json({ error: "Não foi possível validar seu acesso agora. Tente novamente." });
  }

  // Fail-closed staff gate: internal_unrestricted grants the broad PAT-backed agent
  // (reads with a service-level token, bypassing the caller's RLS). Only an APPROVED
  // user may reach it — an unapproved/unknown user with no scope row is refused here
  // instead of silently inheriting staff access. Clients skip this (own locked path).
  if (!tenantContext.isClient) {
    let approved;
    try {
      approved = await fetchIsApproved(userId);
    } catch (err) {
      console.error(`[tenancy] approval lookup failed user=${userId}:`, err && err.message);
      return res.status(503).json({ error: "Não foi possível validar seu acesso agora. Tente novamente." });
    }
    if (!approved) {
      console.warn(`[tenancy] internal turn refused (not approved) user=${userId}`);
      return res.status(403).json({ error: "Acesso não autorizado." });
    }
  }

  // A client turn MUST run on the locked-down, no-DB agent (data comes only from
  // the injected, RLS-scoped snapshot) and NEVER on the internal PAT-backed agent.
  // Fail closed until that agent is configured.
  let clientDataBlock = "";
  if (tenantContext.isClient) {
    if (!CLIENT_AGENT_ID) {
      console.warn(
        `[tenancy] client turn refused (CLIENT_AGENT_ID unset) user=${userId} client=${tenantContext.clientSlug || tenantContext.clientId}`,
      );
      return res.status(403).json({ error: "Assistente de cliente ainda não configurado." });
    }
    agentId = CLIENT_AGENT_ID;
    const snapshot = await fetchClientSnapshot(userJwt).catch(() => null);
    clientDataBlock = buildClientDataBlock(tenantContext, snapshot);
  }

  const scopeDirective = companiumQuery.buildScopeDirective(tenantContext);
  console.log(
    `[tenancy] turn bot=${agentId} user=${userId} mode=${contextLabel(tenantContext)}` +
      (tenantContext.isClient ? ` client=${tenantContext.clientSlug || tenantContext.clientId}` : ""),
  );

  // Sessão do OpenClaw = usuário + conversa. Trocar o conversationId (no reset)
  // inicia um contexto novo, igual ao /new. Sanitiza (vai pro nome do arquivo de sessão).
  const rawConv = typeof body.conversationId === "string" ? body.conversationId : "";
  const conv = rawConv.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "default";
  // O sessionId vira o `prompt_cache_key` do Codex, que tem limite de 64 chars.
  // userId (UUID, 36) + conversationId (UUID, 36) estourava (77). Encurtamos a
  // conversa para um hash de 16 chars: `web-` + 36 + `-` + 16 = 57 (<= 64).
  // Ainda é estável por conversa e rotaciona junto com o conversationId (reset).
  // Inclui o agentId no hash -> sessão (memória) por (usuário, agente, conversa).
  // Reset/troca de agente => sessão diferente, sem misturar contexto.
  const shortConv = createHash("sha256").update(`${agentId}\n${conv}`).digest("hex").slice(0, 16);
  const sessionId = `web-${userId}-${shortConv}`;
  const started = Date.now();

  // 3) Concurrency guards.
  // Global cap first, then per-session serialization. The per-session guard must
  // run BEFORE we touch the gateway: re-sending on a sessionId that already has a
  // run in flight would make the gateway abort the active turn (see activeSessions).
  if (inFlight >= MAX_INFLIGHT) {
    return res.status(503).json({ error: "Busy, please retry in a moment." });
  }
  if (activeSessions.has(sessionId)) {
    console.log(`[chat] rejected concurrent turn user=${userId} session=${sessionId}`);
    return res
      .status(409)
      .json({ error: "Ainda estou processando sua mensagem anterior. Aguarde a resposta." });
  }
  inFlight++;
  activeSessions.add(sessionId);

  // Stream when the client asks for NDJSON (and streaming isn't force-disabled).
  const wantsStream =
    process.env.OPENCLAW_STREAM !== "off" &&
    String(req.headers.accept || "").includes("application/x-ndjson");

  try {
    // Reenvio de arquivo já gerado: intercepta ANTES do agente (não depende da
    // memória textual do modelo). Só dispara em pedidos claros de reenvio; se não
    // achar artifact, responde curto sem chamar o agente. Ownership reconfirmado
    // dentro de resolveResendArtifact. Responde JSON — o transport do frontend
    // aceita application/json mesmo tendo pedido NDJSON.
    if (!attachment && isResendRequest(content)) {
      const art = await resolveResendArtifact({ conversationId: rawConv, userId }).catch(() => null);
      if (art) {
        console.log(`[chat] resend artifact user=${userId} id=${art.id} file=${art.filename} ms=${Date.now() - started}`);
        return res.status(200).json(buildResendReply(art));
      }
      console.log(`[chat] resend no-artifact user=${userId} ms=${Date.now() - started}`);
      return res.status(200).json(buildMessageReply(
        "Não encontrei nenhum arquivo recente para reenviar. Se quiser, posso gerar um novo — é só pedir.",
      ));
    }

    const prompt = buildCompaniumPrompt({ botId, content, history, attachment, scopeDirective, clientDataBlock });

    if (wantsStream) {
      await streamChatTurn({ req, res, userId, botId, agentId, prompt, sessionId, started, conversationId: rawConv, userContent: content, attachment, tenantContext });
      return; // streamChatTurn owns the response
    }

    const json = await runAgent({ agentId, content: prompt, sessionId });
    const extracted = extractAgentContent(json);
    if (!extracted.ok) {
      console.error(
        `[chat] OpenClaw not ok user=${userId} session=${sessionId} reason=${extracted.error}`
      );
      return res.status(502).json({ error: "The assistant is unavailable. Please retry." });
    }

    // Did the agent classify this turn as a side-effect (export or plot)?
    const directive = extractDirective(extracted.content);
    // Validate + authorize the classified side-effect under the tenantContext
    // BEFORE executing it (the skill decides; the server validates + executes).
    if (directive) {
      try {
        authorizeDirective({ directive, tenantContext, botId: agentId });
      } catch (err) {
        if (err instanceof TenantPermissionError || err instanceof IntentValidationError) {
          return res.status(err.status).json({ error: "Ação não permitida para este assistente." });
        }
        throw err;
      }
    }
    if (directive && directive.action === "export") {
      try {
        const reply = await performExport({ userId, botId, directive });
        console.log(
          `[chat] export ok user=${userId} bot=${botId} kind=${reply.artifact.kind} file=${reply.artifact.filename} ms=${Date.now() - started}`
        );
        return res.status(200).json(reply);
      } catch (err) {
        const status = err instanceof ExportError ? err.status : 502;
        console.error(
          `[chat] export failure user=${userId} session=${sessionId} status=${status}:`,
          err && err.message,
          err && err.detail ? String(err.detail) : ""
        );
        return res
          .status(status)
          .json({ error: "Não foi possível gerar o arquivo. Tente novamente." });
      }
    }
    if (directive && directive.action === "plot") {
      try {
        const reply = await performPlot({ userId, botId, directive });
        console.log(
          `[chat] plot ok user=${userId} bot=${botId} id=${reply.plot.id} thumb=${reply.plot.thumbnailUrl ? "yes" : "no"} ms=${Date.now() - started}`
        );
        return res.status(200).json(reply);
      } catch (err) {
        const status = err instanceof ExportError ? err.status : 502;
        console.error(
          `[chat] plot failure user=${userId} session=${sessionId} status=${status}:`,
          err && err.message,
          err && err.detail ? String(err.detail) : ""
        );
        return res
          .status(status)
          .json({ error: "Não foi possível gerar o gráfico. Tente novamente." });
      }
    }

    // Plain message.
    console.log(
      `[chat] ok user=${userId} bot=${botId} ms=${Date.now() - started}`
    );
    return res.status(200).json(buildMessageReply(extracted.content));
  } catch (err) {
    console.error(
      `[chat] agent failure user=${userId} session=${sessionId}:`,
      err && err.message,
      err && err.detail ? JSON.stringify(err.detail) : ""
    );
    return res.status(502).json({ error: "The assistant is unavailable. Please retry." });
  } finally {
    inFlight--;
    activeSessions.delete(sessionId);
  }
});

// Same-origin authorized download for an export artifact.
// Authorized by a signed `?t=` capability token (so a browser <a download> works
// without headers) OR by a Bearer JWT (API clients); the JWT path is owner-scoped.
app.get("/api/openclaw/files/:id", async (req, res) => {
  const id = req.params.id;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: "Invalid id." });
  }
  if (!exportEnabled) {
    return res.status(502).json({ error: "Downloads unavailable." });
  }

  let userId = null;
  if (!validDownloadToken(id, req.query.t)) {
    try {
      userId = await verifyUser(req.headers.authorization);
    } catch {
      return res.status(401).json({ error: "Authentication required." });
    }
  }

  try {
    const row = await getArtifactRow(id);
    if (!row) return res.status(404).json({ error: "Not found." });
    // JWT path is owner-scoped; the signed token is itself the capability.
    if (userId && row.user_id !== userId) {
      // Don't reveal existence to non-owners.
      return res.status(404).json({ error: "Not found." });
    }

    const bytes = await storageDownload(ARTIFACTS_BUCKET, row.storage_path);
    if (!bytes) return res.status(502).json({ error: "File unavailable." });

    const safeName = (row.filename || "download").replace(/["\\\r\n]/g, "_");
    res.setHeader("Content-Type", row.mime_type || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeName}"`
    );
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).end(bytes);
  } catch (err) {
    console.error(`[files] error id=${id}:`, err && err.message);
    return res.status(502).json({ error: "Download failed." });
  }
});

// Same-origin authorized thumbnail for a saved plot. Same auth model as /files/:id
// (signed `?t=` token so a browser <img src> works, or owner-scoped Bearer JWT).
app.get("/api/openclaw/plots/:id/thumb.png", async (req, res) => {
  const id = req.params.id;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: "Invalid id." });
  }
  if (!exportEnabled) {
    return res.status(502).json({ error: "Downloads unavailable." });
  }

  let userId = null;
  if (!validDownloadToken(id, req.query.t)) {
    try {
      userId = await verifyUser(req.headers.authorization);
    } catch {
      return res.status(401).json({ error: "Authentication required." });
    }
  }

  try {
    const row = await getPlotRow(id);
    // JWT path is owner-scoped; the signed token is itself the capability.
    if (!row || (userId && row.user_id !== userId)) {
      return res.status(404).json({ error: "Not found." });
    }
    if (!row.thumbnail_path) {
      return res.status(404).json({ error: "No thumbnail." });
    }

    const bytes = await storageDownload(PLOTS_BUCKET, row.thumbnail_path);
    if (!bytes) return res.status(502).json({ error: "Thumbnail unavailable." });

    res.setHeader("Content-Type", PLOT_THUMB_MIME);
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).end(bytes);
  } catch (err) {
    console.error(`[plots] thumb error id=${id}:`, err && err.message);
    return res.status(502).json({ error: "Thumbnail failed." });
  }
});

// Export PDF of a plot, rendered from its spec. Same auth model as thumb.png
// (signed ?t= token so a browser <a download> works, or owner-scoped Bearer JWT).
app.get("/api/openclaw/plots/:id/export.pdf", async (req, res) => {
  const id = req.params.id;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: "Invalid id." });
  }
  if (!exportEnabled) {
    return res.status(502).json({ error: "Downloads unavailable." });
  }

  let userId = null;
  if (!validDownloadToken(id, req.query.t)) {
    try {
      userId = await verifyUser(req.headers.authorization);
    } catch {
      return res.status(401).json({ error: "Authentication required." });
    }
  }

  try {
    const row = await getPlotRow(id);
    if (!row || (userId && row.user_id !== userId)) {
      return res.status(404).json({ error: "Not found." });
    }
    if (!row.spec) {
      return res.status(404).json({ error: "No spec." });
    }

    // 680x420 fits an A4/Letter portrait page. Values are drawn on the chart,
    // and the plot title is shown as a caption below (chartReportHtml).
    const pdf = await renderPdf(
      chartReportHtml(row.spec, { width: 680, height: 420, caption: row.title }),
    );
    const filename = sanitizeFilename(row.title || "grafico", "pdf", "grafico");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).end(pdf);
  } catch (err) {
    console.error(`[plots] pdf export error id=${id}:`, err && err.message);
    return res.status(502).json({ error: "Export failed." });
  }
});

// Delete a plot owned by the caller (also removes its stored thumbnail).
app.delete("/api/openclaw/plots/:id", async (req, res) => {
  let userId;
  try {
    userId = await verifyUser(req.headers.authorization);
  } catch {
    return res.status(401).json({ error: "Authentication required." });
  }

  const id = req.params.id;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: "Invalid id." });
  }
  if (!exportEnabled) {
    return res.status(502).json({ error: "Unavailable." });
  }

  try {
    const deleted = await deletePlotRow(id, userId);
    if (!Array.isArray(deleted) || deleted.length === 0) {
      // Either it doesn't exist or it isn't the caller's — same response.
      return res.status(404).json({ error: "Not found." });
    }
    const path = deleted[0] && deleted[0].thumbnail_path;
    if (path) await storageRemove(PLOTS_BUCKET, path);
    return res.status(200).json({ ok: true, id });
  } catch (err) {
    console.error(`[plots] delete error id=${id}:`, err && err.message);
    return res.status(502).json({ error: "Delete failed." });
  }
});

// List the caller's plots + artifacts (newest first) with signed URLs so the
// library page can render thumbnails / downloads without an auth header.
app.get("/api/openclaw/library", async (req, res) => {
  let userId;
  try {
    userId = await verifyUser(req.headers.authorization);
  } catch {
    return res.status(401).json({ error: "Authentication required." });
  }
  if (!exportEnabled) {
    return res.status(200).json({ plots: [], artifacts: [] }); // nothing persisted
  }
  try {
    const [plots, artifacts] = await Promise.all([listPlots(userId), listArtifacts(userId)]);
    return res.status(200).json({
      plots: plots.map((p) => ({
        id: p.id,
        name: p.title || "",
        createdAt: p.created_at,
        spec: p.spec ?? null,
        pdfUrl: p.spec ? `/api/openclaw/plots/${p.id}/export.pdf?t=${signId(p.id)}` : null,
        thumbnailUrl: p.thumbnail_path
          ? `/api/openclaw/plots/${p.id}/thumb.png?t=${signId(p.id)}`
          : null,
      })),
      artifacts: artifacts.map((a) => ({
        id: a.id,
        name: a.filename,
        kind: a.kind,
        mimeType: a.mime_type,
        createdAt: a.created_at,
        downloadUrl: `/api/openclaw/files/${a.id}?t=${signId(a.id)}`,
      })),
    });
  } catch (err) {
    console.error(`[library] error user=${userId}:`, err && err.message);
    return res.status(502).json({ error: "Could not load your library." });
  }
});

// Rename a plot (title), owner-scoped.
app.patch("/api/openclaw/plots/:id", async (req, res) => {
  let userId;
  try {
    userId = await verifyUser(req.headers.authorization);
  } catch {
    return res.status(401).json({ error: "Authentication required." });
  }
  const id = req.params.id;
  if (!UUID_RE.test(id)) return res.status(400).json({ error: "Invalid id." });
  if (!exportEnabled) return res.status(502).json({ error: "Unavailable." });

  const title =
    typeof req.body?.title === "string" ? req.body.title.trim().slice(0, 200) : "";
  if (!title) return res.status(400).json({ error: "Missing title." });

  try {
    const updated = await updatePlotTitle(id, userId, title);
    if (!Array.isArray(updated) || updated.length === 0) {
      return res.status(404).json({ error: "Not found." });
    }
    return res.status(200).json({ ok: true, id, name: title });
  } catch (err) {
    console.error(`[plots] rename error id=${id}:`, err && err.message);
    return res.status(502).json({ error: "Rename failed." });
  }
});

// Rename an artifact (filename), owner-scoped. Keeps the real extension.
app.patch("/api/openclaw/artifacts/:id", async (req, res) => {
  let userId;
  try {
    userId = await verifyUser(req.headers.authorization);
  } catch {
    return res.status(401).json({ error: "Authentication required." });
  }
  const id = req.params.id;
  if (!UUID_RE.test(id)) return res.status(400).json({ error: "Invalid id." });
  if (!exportEnabled) return res.status(502).json({ error: "Unavailable." });

  const raw = typeof req.body?.filename === "string" ? req.body.filename : "";
  if (!raw.trim()) return res.status(400).json({ error: "Missing filename." });

  // Read the row to (a) confirm ownership and (b) get the true kind/extension.
  let existing;
  try {
    existing = await getArtifactRow(id);
  } catch {
    existing = null;
  }
  if (!existing || existing.user_id !== userId) {
    return res.status(404).json({ error: "Not found." });
  }
  const kind = (existing.storage_path.split(".").pop() || "bin").toLowerCase();
  const filename = sanitizeFilename(raw, kind, "download");

  try {
    const updated = await updateArtifactFilename(id, userId, filename);
    if (!Array.isArray(updated) || updated.length === 0) {
      return res.status(404).json({ error: "Not found." });
    }
    return res.status(200).json({ ok: true, id, name: filename });
  } catch (err) {
    console.error(`[artifacts] rename error id=${id}:`, err && err.message);
    return res.status(502).json({ error: "Rename failed." });
  }
});

// Delete an artifact owned by the caller (also removes its stored file).
app.delete("/api/openclaw/artifacts/:id", async (req, res) => {
  let userId;
  try {
    userId = await verifyUser(req.headers.authorization);
  } catch {
    return res.status(401).json({ error: "Authentication required." });
  }
  const id = req.params.id;
  if (!UUID_RE.test(id)) return res.status(400).json({ error: "Invalid id." });
  if (!exportEnabled) return res.status(502).json({ error: "Unavailable." });

  try {
    const deleted = await deleteArtifactRow(id, userId);
    if (!Array.isArray(deleted) || deleted.length === 0) {
      return res.status(404).json({ error: "Not found." });
    }
    const path = deleted[0] && deleted[0].storage_path;
    if (path) await storageRemove(ARTIFACTS_BUCKET, path);
    return res.status(200).json({ ok: true, id });
  } catch (err) {
    console.error(`[artifacts] delete error id=${id}:`, err && err.message);
    return res.status(502).json({ error: "Delete failed." });
  }
});


// JSON body parse errors -> 400 (not a 500).
app.use((err, _req, res, _next) => {
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON body." });
  }
  console.error("[http] unhandled error:", err);
  res.status(500).json({ error: "Server error." });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`openclaw-bridge listening on http://${HOST}:${PORT}`);
  console.log(`  supabase=${SUPABASE_URL} agentTimeout=${AGENT_TIMEOUT_SECONDS}s runTimeout=${Math.round(RUN_TIMEOUT_MS / 1000)}s maxInflight=${MAX_INFLIGHT}`);
  console.log(`  export=${exportEnabled ? "enabled" : "DISABLED (no service key)"} artifactsBucket=${ARTIFACTS_BUCKET} plotsBucket=${PLOTS_BUCKET} allowedDirs=[${EXPORT_ALLOWED_DIRS.join(", ")}]`);
  // Deploy marker: this exact string only exists in the background-turns build.
  // If `journalctl -u openclaw-bridge` shows it after a restart, the new code is
  // live; if it's absent, the server is still running the old bundle.
  console.log(`  build=sec-v7 features=[always-persist,run-timeout,export-contract,resend-artifact,attachments,tenant-file-block,staff-approval-gate]`);
});

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    console.log(`[shutdown] ${sig} received`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
