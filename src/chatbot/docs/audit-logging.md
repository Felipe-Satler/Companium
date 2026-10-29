# Event hooks & the structured logging hook (audit log)

How the chatbot emits observability data: the six **named hooks** for behavior,
plus one **structured logging hook** (`onEvent`) that produces a typed audit
record per interaction. Lives in `audit.ts` + `shell.ts`, wired by the host.

> **PII rule (non-negotiable):** the audit record carries **metadata only —
> never raw conversation text.** We log *shape* (input length, classification,
> action, status, timing), not *content*.

---

## 1. Two layers of observability

The brief asks for two distinct things, and we keep both:

1. **Named behavioral hooks** — `onOpen`, `onClose`, `onMessageSend`, `onReply`,
   `onError`, `onReset`. Lightweight "something happened" callbacks the host can
   use for UI side-effects.
2. **The structured logging hook** — a single `onEvent(auditEvent)` that emits a
   consistent, typed record per interaction, designed to be shipped to an audit
   sink (a Supabase table / edge function, later).

Both fire from the same call sites; the named hooks are loose, `onEvent` is the
structured spine.

---

## 2. The audit event model (`audit.ts`)

```ts
export type ChatAuditEventType =
  | 'open' | 'close' | 'reset'
  | 'message_send' | 'reply' | 'error';

export interface ChatAuditEvent {
  type: ChatAuditEventType;
  botSessionId: string;   // one widget session (this mount)
  traceId?: string;       // one send round-trip (correlates send <-> reply/error)
  timestamp: number;

  // request metadata — shape only, no text
  inputKind?: 'free_text' | 'option';
  textLength?: number;

  // classification / action, read off the reply
  intentType?: 'message' | 'service_request';
  service?: ServiceType;
  hasArtifact?: boolean;
  hasPlot?: boolean;

  // outcome
  status?: 'ok' | 'error';
  durationMs?: number;
  errorMessage?: string;  // transport error text (network/HTTP) — host may scrub
}
```

Two correlation ids make the log queryable:

- **`botSessionId`** — generated once per `mount()`. Groups every event from one
  widget session ("what did this user do in this session?").
- **`traceId`** — generated once per send. Ties a `message_send` to its resulting
  `reply` or `error` ("how long did *this* request take, and did it succeed?").

Everything else is **metadata**: `textLength` (not the text), `inputKind`,
`intentType`/`service`/`hasArtifact`/`hasPlot` (the classification, not the
payload), and outcome (`status`, `durationMs`). The lone borderline field is
`errorMessage` — transport error strings (network/HTTP), usually safe; flagged so
the host can scrub it if a backend ever leaks user data into an error.

This type lives in its own file because it's a **contract between the core and
the host's logger** — the host imports `ChatAuditEvent` to type its sink.

---

## 3. The hook on `ChatConfig`

```ts
export interface ChatHooks {
  onOpen?: () => void;
  onClose?: () => void;
  onMessageSend?: (message: ChatMessage) => void;
  onReply?: (reply: BotReply, message: ChatMessage) => void;
  onError?: (error: Error, context: { phase: string }) => void;
  onReset?: () => void;
  // structured logging hook: one typed audit record per interaction (no text)
  onEvent?: (event: ChatAuditEvent) => void;
}
```

`onEvent` is optional — if the host supplies none, the core simply emits nothing.
The **core fires; the host decides the destination.** The core has no idea what
Supabase, analytics, or "logging" even are.

---

## 4. Session id + the `emit` helper

```ts
private sessionId = ''; // set per mount; correlates all events in one session

mount(target: HTMLElement): void {
  if (this.root) return;
  this.target = target;
  this.sessionId = makeId('sess'); // one session per mount
  // …
}

// Fill in the constant fields and forward to the host's logging hook.
private emit(e: Partial<ChatAuditEvent> & { type: ChatAuditEventType }): void {
  const hook = this.config.hooks?.onEvent;
  if (!hook) return;
  hook({ botSessionId: this.sessionId, timestamp: Date.now(), ...e });
}
```

`emit` is the single chokepoint for audit events. Call sites pass only the
*interesting* fields (the `type` is required, the rest optional via `Partial`),
and `emit` stamps the two constants every event needs: `botSessionId` and
`timestamp`. Early-returns if no `onEvent` hook is configured, so it costs
nothing when logging is off.

> `sessionId` is regenerated on every `mount()`, so a remount (e.g. the React
> host re-mounting) starts a fresh session — which is the correct semantics.

---

## 5. Lifecycle events

```ts
open():  …; this.config.hooks?.onOpen?.();  this.emit({ type: 'open' });
close(): …; this.config.hooks?.onClose?.(); this.emit({ type: 'close' });
reset(): …; this.emit({ type: 'reset' });   this.config.hooks?.onReset?.();
```

Each public action fires its named hook **and** an audit event. These are the
"session shape" events — when the widget was opened, closed, or reset.

---

## 6. The request round-trip (`callTransport`)

This is where the rich data comes from. One send produces up to two audit
events sharing a `traceId`, with timing measured across the await:

```ts
private callTransport(
  userMsg: ChatMessage,
  inputKind: 'free_text' | 'option' = 'free_text',
): void {
  // …
  const traceId = makeId('trace');
  const startedAt = Date.now();
  this.emit({
    type: 'message_send',
    traceId,
    inputKind,
    textLength: userMsg.content.length, // length, NOT the text
  });

  this.config.transport.send(req)
    .then((reply) => {
      if (controller.signal.aborted) return;
      const botMsg = messageFromReply(reply);
      // … dispatch + storage + onReply …
      this.emit({
        type: 'reply',
        traceId,
        status: 'ok',
        durationMs: Date.now() - startedAt,
        intentType: botMsg.metadata?.intentType,
        service: botMsg.metadata?.service,
        hasArtifact: !!botMsg.metadata?.artifact,
        hasPlot: !!botMsg.metadata?.plot,
      });
    })
    .catch((err) => {
      if (controller.signal.aborted) return;
      // … dispatch fail + onError …
      this.emit({
        type: 'error',
        traceId,
        status: 'error',
        durationMs: Date.now() - startedAt,
        errorMessage: error.message,
      });
    });
}
```

What's captured and why:

- **`traceId` + `startedAt`** are created *before* the send, so both outcomes can
  reference the same id and compute `durationMs = Date.now() - startedAt`.
- **`message_send`** logs `inputKind` (`'free_text'` now; Step 8's option buttons
  will pass `'option'`) and `textLength` — the *size* of the input, never its
  text.
- **`reply`** reads the classification off the produced message's metadata:
  `intentType`, `service`, and booleans `hasArtifact`/`hasPlot`. This is the
  "what did the bot decide to do" record — again, shape not content.
- **`error`** logs the failure with timing and the error message.
- Both handlers **early-return if aborted**, so a torn-down widget emits nothing
  stale — consistent with the rest of `callTransport`.

---

## 7. The host side (for now: `dev-mount.ts`)

```ts
const widget = new ChatbotShell({
  transport,
  // …
  hooks: {
    onEvent: (e) => console.debug('[chatbot audit]', e),
  },
});
```

The dev harness just prints to the console. In **Step 7** the real React host
will forward `onEvent` to a Supabase audit table / edge function — and the core
won't change at all, because it only ever calls `this.config.hooks?.onEvent?.(…)`.

A typical session in the console:

```
[chatbot audit] {type:'open',         botSessionId:'sess-…'}
[chatbot audit] {type:'message_send', traceId:'trace-…', inputKind:'free_text', textLength:11}
[chatbot audit] {type:'reply',        traceId:'trace-…', status:'ok', durationMs:702,
                 intentType:'service_request', service:'export', hasArtifact:true, hasPlot:false}
```

---

## 8. Why it's built this way

- **Metadata, not content** — every field is shape/classification/outcome, never
  the message text. This is decision #3 (transcript local-only; remote = audit
  metadata) enforced in code.
- **Core emits, host routes** — the core has no logging destination baked in;
  swap the host's `onEvent` and the same widget logs to console, Supabase, or
  nothing. Portable to the vanilla app unchanged.
- **Correlation built in** — `botSessionId` + `traceId` turn a stream of events
  into something you can actually query: per-session behavior, per-request
  timing, failure rates by `service`.
- **Single `emit` chokepoint** — every event goes through one helper that stamps
  the constants, so records are uniform and the no-hook case is free.
- **Done before the real backend** — instrumenting now means Step 7's real
  transport drops into an already-observable widget.
