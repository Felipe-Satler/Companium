# Bridge implementation brief — chatbot ↔ OpenClaw

Hand this to **Claude Code on the server**. It describes a small backend service
("the bridge") that connects the already-built chatbot frontend to the OpenClaw
gateway. The frontend, its transport, and the contract are done and must not be
changed — build the server side to match this.

Companion doc: `openclaw-contract.md` (the frontend↔bridge HTTP contract). This
brief is the bridge↔OpenClaw side.

---

## 1. Context & architecture

A React app served by nginx at `companium.example.com` already has a chatbot widget.
The widget calls a same-origin endpoint with the user's Supabase JWT and expects a
structured `BotReply`. OpenClaw (the AI gateway) runs on this same server but
speaks its own protocol/auth — it does **not** accept Supabase JWTs and does not
expose this endpoint. The bridge is the translator:

```
Browser widget (Supabase JWT)
  → POST /api/openclaw/chat                (contract in openclaw-contract.md)
     → nginx proxies to → BRIDGE (this service, runs as user `deploy`)
          1. verify the Supabase JWT → userId
          2. call OpenClaw via `openclaw agent --json`
          3. map OpenClaw's JSON → BotReply
     ← BotReply (JSON)
```

The bridge is the **only** new code. nginx already serves the SPA; you add one
`location` block to proxy `/api/openclaw/` to the bridge.

---

## 2. What to build

A small HTTP service (Node — `deploy` has nvm node v22; Express is fine, or plain
`http`). Bind to **`127.0.0.1`** on an **unused local port** (check `ss -tlnp`;
e.g. `18900`). It exposes one route: `POST /api/openclaw/chat`.

Keep dependencies minimal. Suggested: `express`, and for JWT either `jose`
(recommended) or `@supabase/supabase-js`.

---

## 3. The HTTP contract it must serve (frontend → bridge)

**Request** (`Content-Type: application/json`, `Authorization: Bearer <supabase jwt>`):
```jsonc
{
  "botId": "grooagent",
  "message": { "role": "user", "content": "..." },
  "history": [ { "role": "user|assistant|system", "content": "..." } ]
}
```

**Response 200** — a `BotReply`:
```json
{ "type": "message", "content": "..." }
```
(Phase 2 adds `{ "type":"service_request", "service":"export"|"plot", "content", "artifact"?, "plot"? }`.)

**Errors**: non-2xx with `{ "error": "reason" }`. Status codes: 400 (bad body),
401 (bad/missing JWT), 403 (not permitted), 502 (OpenClaw failed), 500 (bridge
error). The frontend shows a Retry button on any failure.

Full field rules: see `openclaw-contract.md` §3–§7 and §13 (reference types).

---

## 4. Auth — verify the Supabase JWT

- Supabase project: `https://your-project-ref.supabase.co`
- Tokens are **ES256** (asymmetric), so verify against the project JWKS — no
  secret needed:
  - JWKS URL: `https://your-project-ref.supabase.co/auth/v1/.well-known/jwks.json`
  - With `jose`: `createRemoteJWKSet(new URL(jwksUrl))` + `jwtVerify(token, jwks, { issuer: 'https://your-project-ref.supabase.co/auth/v1', audience: 'authenticated' })`.
  - The user id is the **`sub`** claim. Reject (401) on any verification failure
    or expiry.
- Simpler alternative: `@supabase/supabase-js` →
  `createClient(url, ANON_KEY).auth.getUser(token)` (does a network call per
  request). The anon/publishable key is public; it's in the app's `.env`
  (`VITE_SUPABASE_PUBLISHABLE_KEY`). Prefer the JWKS path for performance.
- **Never** trust a user id from the request body — only the verified `sub`.

---

## 5. Call OpenClaw via the CLI

Run one agent turn per request, non-interactively, with JSON output. **Do not**
pass `--deliver` (we don't want replies pushed to Telegram/WhatsApp/etc.).

```
openclaw agent --agent <agentId> -m <content> --json \
               --session-id web-<userId>-<conversationId> --timeout 120
```

- **Spawn with an argument array and NO shell** (`child_process.spawn('openclaw',
  [...])`, not `exec` with a string). The user's text is untrusted — an arg array
  prevents shell injection.
- **`--agent`:** map `botId → agentId`. For now `"grooagent" → "main"` (the
  groohub skills — `groohub-supabase-readonly`, `ads-metrics-report`, etc. — are
  loaded on `main`). Make the mapping a small config object so it's easy to add a
  dedicated `grooagent` agent later.
- **`--session-id web-<userId>-<conversationId>`:** the session key = verified
  user + the request's `conversationId` (sanitized: `[A-Za-z0-9_-]`, ≤64, else
  `"default"`). OpenClaw keeps conversational context per session, so you can
  **ignore the request's `history`**. The frontend rotates `conversationId` on
  reset → a new session → fresh context (this is the "new conversation" / `/new`
  behavior). See `openclaw-contract.md` §8.
- **PATH:** the service's environment must find the `openclaw` binary (and its
  node). Resolve with `command -v openclaw` and set the systemd unit's `PATH`
  (or use the absolute path). The OpenClaw **gateway must be running** for
  `openclaw agent` to work.
- **Concurrency:** each turn takes several seconds and many tokens. Fine for now;
  a simple in-flight limit can be added if needed.

---

## 6. Map OpenClaw's JSON → BotReply

`openclaw agent --json` returns (relevant fields):
```jsonc
{
  "status": "ok",
  "result": {
    "payloads": [ { "text": "the assistant reply", "mediaUrl": null } ],
    "meta": { "agentMeta": { "sessionId": "..." }, "durationMs": 6868 }
  }
}
```

Mapping (Phase 1 — message only):
- If `status !== "ok"` (or non-zero exit / parse failure) → **502** `{ error: result.summary || "OpenClaw error" }`.
- Else:
  ```
  content = result.payloads.map(p => p.text).filter(Boolean).join("\n\n").trim()
  ```
  Strip a leading `[[...]]` control marker if present (e.g. `[[reply_to_current]] `).
  Return **200** `{ "type": "message", "content": content }`.
- If `content` is empty, return a friendly fallback message, not an empty bubble.

**Phase 2 (later):** when the skill produces files/plots, map
`result.payloads[].mediaUrl` (and/or structured skill output) into
`service_request` with an `artifact`/`plot`, **persisting to Supabase** per
`openclaw-contract.md` §5 (private Storage bucket + `chatbot_artifacts` /
`chatbot_plots` tables, served same-origin so downloads work). Keep Phase 1
message-only to get a working loop first.

---

## 7. nginx — proxy the endpoint (additive, reversible)

In the `companium.example.com` server block, add (nginx matches longest prefix, so it
takes precedence over the SPA fallback):
```nginx
location /api/openclaw/ {
    proxy_pass http://127.0.0.1:18900;     # the bridge port
    proxy_http_version 1.1;
    proxy_read_timeout 180s;               # agent turns can take a while
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    # Authorization (Bearer JWT) is forwarded by default.
}
```
Back up the config first; `sudo nginx -t` before `sudo systemctl reload nginx`. A
failed `nginx -t` means nothing is applied — the live site is untouched.

---

## 8. systemd — run the bridge as a service

Mirror `openclaw.service`'s style (User=deploy, Restart=on-failure). Ensure `PATH`
includes node + the openclaw binary. Example:
```ini
[Unit]
Description=Chatbot ↔ OpenClaw bridge
After=network-online.target openclaw.service
Wants=network-online.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/home/deploy/apps/openclaw-bridge
Environment=NODE_ENV=production
Environment=PORT=18900
Environment=PATH=/home/deploy/.nvm/versions/node/v22.22.3/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/home/deploy/.nvm/versions/node/v22.22.3/bin/node /home/deploy/apps/openclaw-bridge/index.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```
(Adjust paths. Confirm node path with `command -v node`.)

---

## 9. Acceptance tests (do these before declaring done)

1. **Health:** `curl http://127.0.0.1:18900/` (add a simple health route) → 200.
2. **Auth rejected:** `POST /api/openclaw/chat` with no/invalid token → **401**.
3. **Happy path:** with a real Supabase JWT (from the app's `groohub-auth`
   localStorage) →
   ```bash
   curl -i -X POST http://127.0.0.1:18900/api/openclaw/chat \
     -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -d '{"botId":"grooagent","message":{"role":"user","content":"hello"},"history":[]}'
   ```
   → **200** + `{"type":"message","content":"<the agent's reply>"}`.
4. **Through nginx:** same call against `https://companium.example.com/api/openclaw/chat`.
5. **In the app:** log in, open the widget, send a message → reply renders; Network
   shows the POST with the `Authorization` header.

---

## 10. Guardrails (don't break production)

- The bridge + nginx `location` are **additive** — they don't touch the existing
  site. The widget is gated to authenticated users; if OpenClaw hiccups, only the
  chat fails, the dashboard is fine.
- `spawn` with an arg array (no shell). Validate `message.content` is a non-empty
  string; cap its length.
- Never put secrets or internal details in the `error` field (it's shown to the
  user). Log details to the journal instead.
- Set `proxy_read_timeout` (nginx) and `--timeout` (agent) so slow turns don't
  hang forever.
- The frontend deploy is separate (it's this repo's `deploy.sh`); the bridge can
  go live first and be tested with `curl` before any frontend change.

---

## 11. Summary for the implementer

Build a `127.0.0.1:18900` Node service exposing `POST /api/openclaw/chat` that:
verifies the Supabase JWT (JWKS, `sub` = userId) → spawns
`openclaw agent --agent main -m <content> --json --session-id web-<userId>-<conversationId>` →
maps `result.payloads[].text` to `{ type:'message', content }` → returns it. Front
it with the nginx `location` block and a systemd unit. Test with curl, then in the
app. Phase 2: map media/skill output to `service_request` + Supabase-persisted
artifacts/plots.
