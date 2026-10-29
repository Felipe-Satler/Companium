# OpenClaw chat endpoint — implementation contract

The contract between the chatbot widget and the **OpenClaw backend**. This is the
**single source of truth**: build OpenClaw to match it, and if anything changes,
update this doc **and** `src/chatbot/react/openClawTransport.ts` together so the
two sides never drift.

> The portable chatbot core knows nothing about OpenClaw — it only calls
> `transport.send()`. This contract is specific to *this* app's host transport.

---

## 0. Responsibilities — who does what

| Layer | Responsibility |
|-------|----------------|
| **Frontend** (done) | Sends `POST /api/openclaw/chat` with the user's Supabase JWT and `{ botId, message, history }`. Renders the returned `BotReply`. Never classifies or performs actions. |
| **Server / route** (build) | Hosts the endpoint. **Verifies the JWT → user id.** Enforces capability gating. Parses/validates the request. Calls the skill. **Performs the side-effect** (generate file / insert plot row) before responding. Returns a `BotReply` or an error. |
| **OpenClaw skill** (build) | Given `{ botId, message, history }`, selects the personality by `botId`, **classifies** the user's intent, and produces the structured `BotReply` JSON. For a `service_request`, it specifies *what* action to take; the server executes it. |

Key rule: **the skill decides; the server verifies and executes.** Free text must
never directly cause a side-effect — the classified intent is validated
server-side before any action runs.

---

## 1. Endpoint

```
POST /api/openclaw/chat
```

- **Same-origin** with the web app in production (OpenClaw on the same server).
- Path is overridable on the frontend via `VITE_OPENCLAW_ENDPOINT`.
- Only called when `VITE_CHATBOT_BACKEND=openclaw`; otherwise the widget uses an
  in-browser mock and never hits the network.
- Content type: `application/json` for both request and response.

---

## 2. Authentication (required, detailed)

Every request carries the **current user's Supabase access token**:

```
Authorization: Bearer <supabase access_token>
```

The server **must verify it** and derive the user identity from it. Do **not**
trust any user id sent in the body, and do **not** use a shared client secret —
anything shipped to the browser is public.

**Supabase project:** `https://your-project-ref.supabase.co`

**Verification — two acceptable approaches:**

1. **Simplest (recommended):** use a server-side Supabase client and let Supabase
   validate the token:
   ```ts
   const { data, error } = await supabase.auth.getUser(accessToken);
   // data.user.id  -> the authenticated user id (UUID)
   ```
   `getUser` validates signature + expiry against Supabase. If `error` or no user,
   reject with **401**.

2. **Stateless:** verify the JWT yourself — fetch the JWKS from
   `https://your-project-ref.supabase.co/auth/v1/.well-known/jwks.json`
   (asymmetric keys) or use the project's JWT secret (legacy HS256), then check
   the signature, `exp`, and `aud === "authenticated"`. Extract `sub` as the user
   id.

**Claims of interest:** `sub` (user UUID — use this for ownership/gating),
`email`, `role`, `exp`.

**Capability gating:** authenticated users may trigger side-effects. The app also
tracks approval/roles (`user_approvals.status`, `user_roles.role`) — the server
**may** additionally require `status = 'approved'` and reject others with **403**.
Confirm whether unapproved users should be allowed read-only replies.

---

## 3. Request body

```jsonc
{
  "botId": "grooagent",                    // string — which bot/personality
  "conversationId": "6f1c…",               // opaque id for the current conversation
  "message": {                             // the NEW user message
    "role": "user",
    "content": "export last month's leads as a pdf"
  },
  "history": [                             // prior turns, oldest -> newest
    { "role": "user",      "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

Field rules:
- `botId` — non-empty string. Selects the system prompt / personality. Unknown
  `botId` → **400**.
- `conversationId` — opaque string identifying the current conversation. The
  server derives the OpenClaw session id from `userId` + `conversationId` (see
  §8). The frontend **rotates it on reset** ("Iniciar nova conversa" / `/new`),
  which starts a fresh OpenClaw context. Optional/back-compat: if absent, the
  server falls back to a `"default"` conversation.
- `message.role` — always `"user"` for the new message.
- `message.content` — non-empty string. Empty/whitespace → **400**.
- `history` — array (possibly empty); each item `{ role, content }` with
  `role ∈ { "user", "assistant", "system" }`. It **excludes** the new `message`.
  Note: OpenClaw owns conversational context via the session id, so the server
  may **ignore** `history` — it's sent for completeness/other transports.

---

## 4. Response body (200) — a `BotReply`

The response **is** the widget's `BotReply`, one of two shapes. `content` is
always present (the bubble text).

### 4a. Plain reply — no side-effect

```json
{ "type": "message", "content": "Here's what I found…" }
```

### 4b. Service request — a side-effect was performed

```jsonc
{
  "type": "service_request",
  "service": "export",                 // "export" | "plot"
  "content": "Done — here's your leads report.",   // REQUIRED, human-readable
  "artifact": {                        // present when service === "export"
    "kind": "pdf",                     // "pdf" | "png" | "md"
    "filename": "leads-2026-05.pdf",
    "mimeType": "application/pdf",     // e.g. application/pdf, image/png, text/markdown
    "source": "/api/openclaw/files/leads-2026-05.pdf"  // see download rule below
  },
  "plot": {                            // present when service === "plot"
    "id": "9b1c…",                     // DB row id (UUID)
    "title": "Leads by month",
    "thumbnailUrl": "/api/openclaw/plots/9b1c…/thumb.png",  // optional
    "spec": { }                        // optional chart spec the host renders
  },
  "actionResults": [                   // optional — audit detail of what ran
    { "action": "generate_pdf", "result": "ok" }
  ]
}
```

Validation/shape rules the server must honor:
- `type` ∈ `{ "message", "service_request" }`.
- `service` ∈ `{ "export", "plot" }` (only when `type === "service_request"`).
- `content` is **always** present and non-empty.
- `service === "export"` ⇒ include `artifact`; `service === "plot"` ⇒ include `plot`.
- Do **not** invent other `service` values without updating this doc + `types.ts`.

---

## 5. Side-effect requirements

> "The side-effect is already done by the time the response is sent." The server
> performs the work, then returns the reference.

**Both plots and generated files MUST be persisted on Supabase**, owned by the
authenticated user. Nothing is ephemeral — every artifact/plot is a durable,
user-owned record.

### `service: "export"` — generate a file, store it on Supabase, return a same-origin URL
1. **Generate** the file (pdf / png / md).
2. **Store it in Supabase Storage** — a **private** bucket (e.g.
   `chatbot-artifacts`), at a user-scoped path like `${userId}/${id}.${ext}`.
   Do **not** make the bucket public.
3. **Record metadata** in a table so the file can be listed, authorized, and
   re-served later (see schema below).
4. **Serve it same-origin for download.** Set `artifact.source` to an app-origin
   route, e.g. `GET /api/openclaw/files/:id`, which:
   - verifies the JWT and that the file's `user_id === sub` (else 403),
   - fetches the bytes from Storage (download the object, or mint a short-lived
     signed URL server-side and stream/proxy it), and
   - responds with `Content-Disposition: attachment; filename="<filename>"` and
     the right `Content-Type`.
   > Why not return the Supabase Storage URL directly? It's **cross-origin**
   > (`*.supabase.co`), so the browser **navigates** instead of downloading, and a
   > public URL leaks access. The same-origin streaming route fixes both. (A tiny
   > file may instead be returned as a `data:` URI, but it still must be persisted
   > to Storage per the rule above.)
5. `filename` + `mimeType` must match the stored file.

**Suggested artifacts table** (RLS: `user_id = auth.uid()`):
```sql
create table chatbot_artifacts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id),
  bot_id       text not null,
  kind         text not null,          -- 'pdf' | 'png' | 'md'
  filename     text not null,
  mime_type    text not null,
  storage_path text not null,          -- path within the private bucket
  created_at   timestamptz not null default now()
);
```

### `service: "plot"` — create a saved, user-owned plot on Supabase
1. Insert a plot row **owned by the authenticated user** (`user_id = sub`) into a
   Supabase table.
2. Return its `id` (opens `/plots/:id` in the app; also the delete route's key).
3. Persist the `spec` (chart definition) so the `/plots/:id` page can re-render it
   later. If you render a thumbnail, **store the image in Supabase Storage** too
   and serve `thumbnailUrl` same-origin (same rule as files).

**Suggested plots table** (RLS so a user only sees/deletes their own):
```sql
create table chatbot_plots (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id),
  bot_id        text not null,
  title         text,
  spec          jsonb,                 -- chart definition, re-rendered on /plots/:id
  thumbnail_path text,                 -- path in Storage (served via same-origin route)
  created_at    timestamptz not null default now()
);
-- RLS: user_id = auth.uid() for select/delete.
```
A simple **delete route** (for Postman during dev): `DELETE /api/openclaw/plots/:id`
deletes where `id = :id AND user_id = <jwt sub>` (and removes any Storage objects).

---

## 6. Intent contract (the safety spine)

```
user free text
  -> OpenClaw skill CLASSIFIES into the structured BotReply (decides intent + payload)
  -> server VALIDATES the classified intent + payload (and the user's capability)
  -> server REPLIES (type:"message")  OR  PERFORMS the action and returns (type:"service_request")
```

- Free text must **never** directly trigger a side-effect — only a validated,
  classified `service_request` may, and only for a permitted user.
- Validate the payload before acting (e.g. an `export` must have a real,
  permitted data scope; a `plot` spec must be well-formed).
- If classification is ambiguous or the action isn't allowed, return a
  `type:"message"` explaining, **not** a side-effect.

---

## 7. Error responses

Return a non-2xx status, optionally with a JSON body:

```json
{ "error": "human-readable reason" }
```

| Status | When |
|--------|------|
| **400** | Malformed body, empty `message.content`, unknown `botId`. |
| **401** | Missing/invalid/expired JWT. |
| **403** | Authenticated but not permitted (capability gating). |
| **422** | Intent understood but payload invalid / action can't be fulfilled. |
| **500** | Server/skill failure. |

The transport surfaces `error` (or the HTTP status text) as the failed message's
reason, and the widget shows a **Retry** button. Don't put sensitive data in
`error` — it's shown to the user.

---

## 8. botId & personality

- `botId` selects the system prompt / persona server-side. Today one bot
  (`"grooagent"`) for everyone; production will have ~3, chosen per user group.
- The mapping `botId -> system prompt` lives entirely in OpenClaw; the frontend
  only passes the id.
- Unknown/blocked `botId` → **400** (don't silently fall back to a default
  persona).

### Sessions & "new conversation" (`/new`)

OpenClaw keeps conversational memory per **session id**. The bridge derives it
from the verified user + the request's `conversationId`:

```
sessionId = `web-${userId}-${conversationId}`   // conversationId sanitized: [A-Za-z0-9_-], ≤64, else "default"
```

- Scoping by the **verified `userId`** (JWT `sub`) prevents one user from
  resuming/hijacking another's session by guessing an id.
- The frontend persists `conversationId` (localStorage), so context survives page
  reloads. **Reset** ("Iniciar nova conversa") rotates it to a fresh UUID → a new
  `sessionId` → OpenClaw starts with **no prior context**, exactly like `/new`.
  (Clearing the local transcript alone does NOT reset context — the session id is
  what carries memory.)

---

## 9. Phased rollout (recommended build order)

1. **MVP:** route + JWT verification + skill returning only
   `{ type: "message", content }`. End-to-end loop works immediately — the widget
   already renders this.
2. **Export:** add `service: "export"` — generate the file, serve it same-origin,
   return the `artifact`.
3. **Plot:** add `service: "plot"` — insert the user-owned row, return the `plot`
   ref; wire the `/plots/:id` page + delete route.
4. **Hardening:** capability gating (approval/roles), payload validation, rate
   limiting, audit logging.

Each phase is independently shippable and testable against the live widget.

---

## 10. Streaming (future, not now)

Request/response only for v1. The transport's `send(request, options)` already
accepts an `options.onChunk` callback, so server-sent-events / chunked streaming
can be added later **without changing the core or the call sites** — only the
transport and the endpoint.

---

## 11. Frontend env vars

| Var | Purpose | Default |
|-----|---------|---------|
| `VITE_CHATBOT_BACKEND` | set to `openclaw` to use the real transport | unset → in-browser mock |
| `VITE_OPENCLAW_ENDPOINT` | override the endpoint path | `/api/openclaw/chat` |

---

## 12. Worked examples

### Plain message
```http
POST /api/openclaw/chat
Authorization: Bearer eyJhbGciOi…
Content-Type: application/json

{ "botId": "grooagent",
  "message": { "role": "user", "content": "what can you do?" },
  "history": [] }
```
```json
{ "type": "message", "content": "I can pull reports, export PDFs, and build plots. What do you need?" }
```

### Export (PDF)
```json
{
  "type": "service_request",
  "service": "export",
  "content": "Done — here's your leads report.",
  "artifact": {
    "kind": "pdf",
    "filename": "leads-2026-05.pdf",
    "mimeType": "application/pdf",
    "source": "/api/openclaw/files/leads-2026-05.pdf"
  }
}
```

### Plot
```json
{
  "type": "service_request",
  "service": "plot",
  "content": "Here's your leads-by-month chart.",
  "plot": {
    "id": "9b1c2d3e-…",
    "title": "Leads by month",
    "thumbnailUrl": "/api/openclaw/plots/9b1c2d3e-…/thumb.png"
  }
}
```

### Error
```http
HTTP/1.1 403 Forbidden
Content-Type: application/json

{ "error": "Your account is pending approval." }
```

---

## 13. Reference types (mirror of `src/chatbot/core/types.ts`)

The response must satisfy these TypeScript types exactly:

```ts
type Role = 'user' | 'assistant' | 'system';
type ServiceType = 'export' | 'plot';

interface Artifact {
  kind: 'pdf' | 'png' | 'md';
  filename: string;
  mimeType: string;
  source: string;             // same-origin URL, or data:/blob: URI (see §5)
}
interface PlotRef {
  id: string;
  title?: string;
  thumbnailUrl?: string;
  spec?: unknown;
}
interface ActionResult { action: string; result: string; }

type BotReply =
  | { type: 'message'; content: string }
  | {
      type: 'service_request';
      service: ServiceType;
      content: string;
      artifact?: Artifact;     // when service === 'export'
      plot?: PlotRef;          // when service === 'plot'
      actionResults?: ActionResult[];
    };
```

Request type (what the frontend sends):
```ts
interface ChatRequest {
  botId: string;
  conversationId?: string;   // rotates on reset (/new); -> OpenClaw session id
  message: { role: Role; content: string };
  history: Array<{ role: Role; content: string }>;
}
```

---

## 14. Security checklist

- [ ] JWT verified on **every** request; reject 401 on failure.
- [ ] User id taken **only** from the verified token (`sub`), never the body.
- [ ] Capability gating enforced server-side (don't trust the client).
- [ ] Classified intent + payload validated before any side-effect runs.
- [ ] Side-effects scoped to the authenticated user (plots owned by `sub`; files
      they're allowed to access).
- [ ] Artifacts + plots persisted to Supabase (private Storage bucket + tables),
      owned by the user — nothing ephemeral.
- [ ] File `source` is same-origin (or data:/blob:) so downloads work and access
      is controlled.
- [ ] `error` messages contain no sensitive/internal detail.
- [ ] Review any LLM-generated auth / DB-write / file-generation code by hand.
