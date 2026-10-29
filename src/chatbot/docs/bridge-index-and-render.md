# The bridge: `index.js` + `render.js`

The **bridge** (`apps/openclaw-bridge/`) is the server that sits between the
browser chatbot and OpenClaw. It runs as a systemd service on `127.0.0.1:18900`
(behind nginx at `/api/openclaw/`). Two files do the heavy lifting:

- **`index.js`** — the HTTP server: authenticates each request, runs an agent
  turn, interprets what the agent produced, performs side-effects (save a plot,
  render a PDF), and returns the frontend's `BotReply` shape.
- **`render.js`** — pure, deterministic rendering: Markdown→HTML, a chart
  **spec→SVG**, and HTML→PDF/PNG via headless Chrome. No network, no state.

> Mental model: **`index.js` decides *what* to produce; `render.js` produces the
> pixels.** The agent is never trusted to write files — the bridge renders
> everything itself from the agent's *content*.

---

## Part 1 — `index.js`

### 1.1 Config & constants

Everything tunable is an env var with a sane default, so nothing secret is
hard-coded:

```js
const PORT = Number(process.env.PORT || 18900);
const SUPABASE_URL = process.env.SUPABASE_URL || "https://…supabase.co";
const OPENCLAW_BIN = process.env.OPENCLAW_BIN || "openclaw";
const AGENT_TIMEOUT_SECONDS = Number(process.env.AGENT_TIMEOUT_SECONDS || 120);
const MAX_INFLIGHT = Number(process.env.MAX_INFLIGHT || 6);   // global concurrency cap
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || ""; // server-only
```

Two concurrency guards live here:

```js
let inFlight = 0;                 // global count of turns being processed
const activeSessions = new Set(); // sessionIds with a turn currently running
```

`activeSessions` is the important one — explained in §1.9.

### 1.2 Auth — verify the Supabase JWT (never trust the body)

Every request must carry `Authorization: Bearer <supabase access_token>`. The
bridge verifies it against Supabase's **JWKS** (asymmetric ES256) and derives the
user id from the token's `sub` — the client never tells us who it is.

```js
const jwks = createRemoteJWKSet(new URL(JWKS_URL));

async function verifyUser(authHeader) {
  const m = authHeader?.match(/^Bearer\s+(.+)$/i);
  if (!m) throw new AuthError("Malformed Authorization header");
  const { payload } = await jwtVerify(m[1].trim(), jwks, {
    issuer: JWT_ISSUER, audience: JWT_AUDIENCE,
  });
  return payload.sub; // the user id, straight from the verified token
}
```

### 1.3 Running the agent — two paths

**Streaming (preferred):** `runAgentStream` (in `openclaw-agent-stream.js`) opens
a WebSocket to the OpenClaw Gateway and streams the reply. `index.js` imports it:

```js
import { runAgentStream } from "./openclaw-agent-stream.js";
```

**Non-streaming fallback:** `runAgent` spawns the CLI and reads one final JSON
blob. No shell (`shell:false`) because the user's text is untrusted:

```js
function runAgent({ agentId, content, sessionId }) {
  const args = ["agent", "--agent", agentId, "-m", content,
                "--json", "--session-id", sessionId,
                "--timeout", String(AGENT_TIMEOUT_SECONDS)];
  // spawn(OPENCLAW_BIN, args, { shell:false, … }); collect stdout; JSON.parse at EOF
}
```

The CLI path is used when the client didn't ask for streaming, or when
`OPENCLAW_STREAM=off` is set as a kill-switch.

### 1.4 Turning agent output into text

The agent's raw output can carry a leading control marker (e.g.
`[[reply_to_current]]`) and, for the CLI path, an envelope. Two helpers normalize
it:

```js
const CONTROL_MARKER = /^\s*\[\[[^\]]*\]\]\s*/;

function extractAgentContent(json) {           // CLI envelope -> joined text
  if (!json || json.status !== "ok") return { ok:false, error:… };
  const content = json.result.payloads.map(p => p.text).filter(Boolean).join("\n\n");
  return { ok:true, content };
}

function buildMessageReply(content) {          // -> the { type:"message" } BotReply
  let text = (content || "").replace(CONTROL_MARKER, "").trim();
  return { type: "message", content: text || FALLBACK_MESSAGE };
}
```

`buildCompaniumPrompt({ botId, content, history })` wraps the user message with a
`[COMPANIUM_CONTEXT]` block and the last few turns (`normalizeHistory` keeps the
last 8, trimmed), so the agent has conversational context.

### 1.5 Directives — export & plot

The agent asks for a side-effect by emitting a fenced ```json block. The bridge
extracts it:

```js
const DIRECTIVE_ACTIONS = new Set(["export", "plot"]);
// extractDirective(content) -> the parsed { action, … } object, or null
```

**Export** (`action:"export"`) → `performExport` validates the kind (pdf/md),
renders the artifact with `render.js`, uploads it to a **private** Supabase
Storage bucket, records a user-owned row, and returns:

```js
{ type: "service_request", service: "export",
  content: summary,
  artifact: { kind, filename, source: `/api/openclaw/files/${id}?t=${signId(id)}` } }
```

**Plot** (`action:"plot"`) → `validatePlot` checks the spec (`type` ∈
{bar,line,pie}, non-empty `x`/`series`, numeric data, size caps), then
`performPlot` saves the spec row (and an optional PNG thumbnail) and returns:

```js
{ type: "service_request", service: "plot",
  content: summary,
  plot: { id, title, spec, thumbnailUrl? } }   // spec flows to render.js / PlotChart
```

Note `plot.spec` is stored and returned **verbatim**, so the new bar options
(`trend`, `stacked`, `orientation`) ride along without any validator change.

### 1.6 Agent resolution & authorization

The client sends a `botId`, but that's a **request, not authority**.
`resolveAgent(userId, requestedBotId)` reads the `chatbot_bots` catalog +
`user_bot_settings` (cached ~30s) and decides which agent this user is actually
allowed to talk to, throwing `AgentPolicyError` (400/403/500) otherwise. This is
the server-side half of the multi-agent access control (RLS is the other half).

### 1.7 Signed download tokens

Browser `<a download>` links can't send an `Authorization` header, so downloads
are authorized by a **capability token** bound to the row id (HMAC of the id):

```js
function signId(id)  { return createHmac("sha256", SECRET).update(id).digest("base64url"); }
function validDownloadToken(id, token) { /* timing-safe compare to signId(id) */ }
```

Download routes accept **either** a valid `?t=` token **or** a JWT — that's why
the chat "Baixar PDF" button can fetch with the user's JWT.

### 1.8 The chat route — `POST /api/openclaw/chat`

The flow: auth → validate body → `resolveAgent` → concurrency guards → build
prompt → stream or CLI → map to `BotReply`.

### 1.9 The two concurrency guards

```js
if (inFlight >= MAX_INFLIGHT) return res.status(503)…;         // global cap
if (activeSessions.has(sessionId))                             // per-session
  return res.status(409).json({ error: "Ainda estou processando…" });
inFlight++; activeSessions.add(sessionId);
```

The **per-session** guard is subtle but important: the OpenClaw `sessionId` is
deterministic per (user, agent, conversation). If a second `chat.send` lands on a
sessionKey that already has a run in flight, the Gateway **aborts the running
turn** to start the new one — stranding the nearly-finished answer as "gateway
chat run aborted". So a re-send while a turn is active is rejected with **409**
instead of being allowed to cancel it. The `finally` clears both counters.

### 1.10 Streaming vs non-streaming response

```js
const wantsStream = process.env.OPENCLAW_STREAM !== "off" &&
  String(req.headers.accept || "").includes("application/x-ndjson");

if (wantsStream) { await streamChatTurn({ req, res, … }); return; } // owns the response
const json = await runAgent({ agentId, content: prompt, sessionId }); // CLI path…
```

`streamChatTurn` writes **NDJSON** frames:

```js
res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
res.setHeader("X-Accel-Buffering", "no");     // stop nginx buffering the stream

let lastText = "";
const onDelta = (snapshot) => {               // Gateway sends CUMULATIVE snapshots
  const delta = snapshot.startsWith(lastText) ? snapshot.slice(lastText.length) : snapshot;
  lastText = snapshot;
  if (delta) writeFrame({ type: "delta", text: delta });   // -> incremental frames
};
const { finalText } = await runAgentStream({ agentId, content: prompt, sessionId, onDelta, signal });
// then the SAME directive logic runs on finalText, delivered as one { type:"final", reply }
```

The final frame is authoritative — a plot/export reply streams its summary text,
then rides in on `final` with the structured `plot`/`artifact` metadata.

### 1.11 The other routes

- `GET /api/openclaw/files/:id` — download an export artifact (token or JWT).
- `GET /api/openclaw/plots/:id/thumb.png` — the saved PNG thumbnail.
- `GET /api/openclaw/plots/:id/export.pdf` — renders the plot to PDF **on demand**
  via `chartReportHtml` + `renderPdf` (values on the chart, title as caption).
- library / rename / delete — the Biblioteca CRUD, all owner-scoped.

---

## Part 2 — `render.js`

Pure functions, no state, no network. Given content, it produces bytes.

### 2.1 Safe Markdown → HTML

`markdownToHtml` handles a **small, deterministic subset** (headings, bold/italic,
lists, GFM tables, code, links) and — critically — **escapes first, then
formats**, so LLM-produced markdown can't inject HTML:

```js
export function escapeHtml(s) { /* & < > " ' -> entities */ }
function inlineMd(escaped) { /* `code`, **bold**, *italic*, [text](https://…) */ }
```

### 2.2 `chartSvg(spec, opts)` — a spec becomes an SVG

Self-contained SVG (no CDN/JS) so Chrome can render it offline. Structure:

**Flags & padding** (bar variants are all single-axis):

```js
const horizontal = type === "bar" && spec.orientation === "horizontal";
const stacked    = type === "bar" && !!spec.stacked;
const showTrend  = type === "bar" && !!spec.trend && !horizontal;
const pad = { top: title ? 56 : 28, right: 24, bottom: 64, left: horizontal ? 140 : 72 };
```

**Pie** — first series only; slices sized by value, labelled `x (value)`.

**Cartesian scale** — the axis top considers stacked totals and the trend, not
just the max single value:

```js
const totals = x.map((_, i) => series.reduce((a, s) => a + (Number(s.data?.[i])||0), 0));
let maxV = stacked ? Math.max(0, ...totals) : singleMax;
if (showTrend) maxV = Math.max(maxV, ...totals);
const niceTop = /* round maxV up to 1/2/2.5/5/10 × 10^n */;
```

**Horizontal branch** — categories down the Y axis, values along X (ranking /
long labels). Grouped bars stack vertically within a slot; stacked bars run along
X; value labels sit to the right of each bar.

**Vertical branch** — the classic layout, with three sub-cases:

- `line` — polyline + dots + per-point value labels.
- `stacked` — segments accumulate bottom-up (`cursorY`), a 2px gap between
  segments, white in-segment labels, and a total on top.
- grouped bars (default) — bars offset within the slot, value label above each.

**Trend line** — a linear least-squares regression of the **category totals**,
drawn as a dashed neutral polyline (an annotation, not a new series):

```js
if (showTrend && n > 1) {
  // slope/intercept via sums of i, y, i·y, i²
  const pts = totals.map((_, i) =>
    `${xCenter(i)},${yOf(intercept + slope * i)}`).join(" ");
  parts.push(`<polyline points="${pts}" stroke="#64748b" stroke-width="2" stroke-dasharray="6 4" fill="none"/>`);
}
```

**Legend** — one swatch per series (≥2), plus a dashed "Tendência" entry when the
trend is shown.

> This mirrors `PlotChart.tsx` exactly, so a plot looks the same on screen and in
> the exported PDF. See `plot-chart.md`.

### 2.3 Wrapping the chart

```js
chartHtml(spec, opts)        // full HTML page around the SVG (for PNG screenshot)
chartReportHtml(spec, opts)  // SVG (internal title hidden) + <figcaption> caption below (for PDF)
```

### 2.4 Headless Chrome → PDF / PNG

`renderPdf` / `renderPng` write the HTML to a temp dir and shell out to
`google-chrome` (`--headless --print-to-pdf` / `--screenshot`), no shell, with a
timeout, then read the file back:

```js
function runChrome(args, timeoutMs) { /* spawn(CHROME_BIN, args, { shell:false, timeout }) */ }
```

---

## How they fit together

```
browser ──JWT──▶ index.js
                  ├─ verifyUser (JWKS)
                  ├─ resolveAgent (which bot?)
                  ├─ guards (inFlight, activeSessions)
                  ├─ runAgentStream / runAgent  ──▶  OpenClaw
                  └─ interpret result:
                       message   → buildMessageReply
                       export    → render.js (md/pdf) → Supabase Storage → artifact
                       plot      → validate → save spec (+thumb) → plot
                  ◀── BotReply (NDJSON final frame, or JSON)

later: GET /plots/:id/export.pdf → render.js chartReportHtml → renderPdf → bytes
```

`render.js` is the only place that turns *content* into *artifacts*; `index.js`
is the only place that touches auth, the DB, and the agent. Keeping them separate
is why the chart looks identical live and in export, and why the agent never
needs filesystem access.
