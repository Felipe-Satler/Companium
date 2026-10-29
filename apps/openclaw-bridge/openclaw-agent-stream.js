// OpenClaw 2026.5.6 local Gateway streaming client (ESM).
//
// Runs one agent turn against the local Gateway over WebSocket and streams the
// assistant message as it grows. Ported to ESM from the reference client that
// OpenClaw generated against these installed dist files:
//   - dist/protocol-ByTcB0og.js      (frame types: req/res/event)
//   - dist/client-CRyAb5LL.js        (connect handshake)
//   - dist/call-CGGbETeo.js
//   - dist/gateway-cli-C39dezTQ.js
//   - dist/chat-Ck90soS2.js          (chat.send requestedSessionId)
//   - dist/combined-store-gateway-GygZ9hLV.js  (agent: sessionKey prefix)
//
// NOTE: chat events carry CUMULATIVE message snapshots (message.content[].text
// is the full text so far), not raw token deltas. `onDelta` receives that full
// snapshot; the caller diffs it if it needs increments.

import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// The Gateway speaks the ws protocol; reuse the copy that ships with OpenClaw,
// falling back to a normally-resolved `ws` if that path isn't present.
let WSModule;
try {
  WSModule = require("/usr/lib/node_modules/openclaw/node_modules/ws");
} catch {
  WSModule = require("ws");
}
const WebSocket = WSModule.WebSocket || WSModule;

const GATEWAY_URL =
  process.env.OPENCLAW_GATEWAY_URL ||
  `ws://127.0.0.1:${process.env.OPENCLAW_GATEWAY_PORT || 18789}`;
const OPENCLAW_VERSION = "2026.5.6";
const PROTOCOL_VERSION = 3;
const CLIENT_ID = "gateway-client";
const CLIENT_MODE = "backend";
const ROLE = "operator";
const REQUIRED_SCOPES = [
  // Gateway gates methods on coarse operator scopes: read = subscribe/history,
  // write = chat.send/chat.abort. Keep the fine-grained names too (accepted at
  // connect) in case a build checks them.
  "operator.read",
  "operator.write",
  "chat.send",
  "sessions.messages.subscribe",
  "chat.history",
  "agent.wait",
];

export class GatewayProtocolError extends Error {
  constructor(message, extra) {
    super(message);
    this.name = "GatewayProtocolError";
    if (extra && typeof extra === "object") Object.assign(this, extra);
  }
}

export class AbortError extends Error {
  constructor(message = "The operation was aborted") {
    super(message);
    this.name = "AbortError";
  }
}

function assertNonEmpty(name, value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeAgentId(agentId) {
  return assertNonEmpty("agentId", agentId).toLowerCase();
}

function normalizeSessionKeySegment(segment) {
  return assertNonEmpty("sessionId", segment).toLowerCase();
}

export function buildAgentSessionKey(agentId, sessionId) {
  return `agent:${normalizeAgentId(agentId)}:${normalizeSessionKeySegment(sessionId)}`;
}

export function extractTextFromMessage(message) {
  if (!message || typeof message !== "object") return "";
  const content = message.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text" && typeof block.text === "string") {
      const text = block.text.trim();
      if (text) parts.push(text);
    }
  }
  return parts.join("\n").trim();
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function onceAbort(signal, fn) {
  if (!signal) return () => {};
  if (signal.aborted) {
    fn();
    return () => {};
  }
  const onAbort = () => fn();
  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}

/**
 * Run one streaming agent turn against the local Gateway.
 * @param {{ agentId: string, content: string, sessionId: string,
 *           onDelta?: (fullSnapshotText: string) => void, signal?: AbortSignal }} args
 * @returns {Promise<{ finalText: string, stopReason: string }>}
 */
export async function runAgentStream({ agentId, content, sessionId, onDelta, signal, runTimeoutMs, attachments }) {
  const normalizedAgentId = normalizeAgentId(agentId);
  const explicitSessionId = assertNonEmpty("sessionId", sessionId);
  const sessionKey = buildAgentSessionKey(normalizedAgentId, explicitSessionId);
  const message = assertNonEmpty("content", content);
  const onDeltaFn = typeof onDelta === "function" ? onDelta : () => {};
  const runId = randomUUID();
  // Run/idle timeout the Gateway applies to the turn (chat.send param). Runs
  // pesados (coleta + plot) passavam do default de 60s e o Gateway abortava.
  const runTimeout =
    Number.isFinite(runTimeoutMs) && runTimeoutMs > 0
      ? runTimeoutMs
      : Number(process.env.OPENCLAW_RUN_TIMEOUT_MS || 300000);

  // Accept our own var OR the Gateway's canonical one (config auth.token.id on
  // this host is OPENCLAW_GATEWAY_AUTH_TOKEN), so the bridge can reuse the same
  // token variable the Gateway already uses.
  const rawToken =
    process.env.OPENCLAW_GATEWAY_TOKEN || process.env.OPENCLAW_GATEWAY_AUTH_TOKEN;
  const gatewayAuthToken =
    typeof rawToken === "string" && rawToken.trim() ? rawToken.trim() : undefined;
  const gatewayPassword =
    typeof process.env.OPENCLAW_GATEWAY_PASSWORD === "string" &&
    process.env.OPENCLAW_GATEWAY_PASSWORD.trim()
      ? process.env.OPENCLAW_GATEWAY_PASSWORD.trim()
      : undefined;

  const ws = new WebSocket(GATEWAY_URL);
  const pending = new Map();
  const finished = createDeferred();

  let closed = false;
  let settled = false;
  let connectNonce = null;
  let connected = false;
  let subscribed = false;
  let started = false;
  let remoteRunId = null;
  let latestText = "";
  let finalStopReason = undefined;

  function settleResolve(value) {
    if (settled) return;
    settled = true;
    finished.resolve(value);
  }

  function settleReject(err) {
    if (settled) return;
    settled = true;
    finished.reject(err);
  }

  function cleanupPending(err) {
    for (const { reject, timer } of pending.values()) {
      if (timer) clearTimeout(timer);
      reject(err);
    }
    pending.clear();
  }

  function safeClose(code = 1000, reason = "done") {
    if (closed) return;
    closed = true;
    try {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(code, reason);
      }
    } catch {}
  }

  function fail(err) {
    cleanupPending(err);
    safeClose(1000, "client-finished");
    settleReject(err);
  }

  function sendFrame(frame) {
    if (ws.readyState !== WebSocket.OPEN) {
      throw new GatewayProtocolError("gateway socket is not open");
    }
    ws.send(JSON.stringify(frame));
  }

  function request(method, params, { timeoutMs = 30000 } = {}) {
    if (closed) {
      return Promise.reject(
        new GatewayProtocolError(`cannot send ${method}: socket already closing`),
      );
    }
    const id = randomUUID();
    const deferred = createDeferred();
    const timer =
      timeoutMs == null
        ? null
        : setTimeout(() => {
            pending.delete(id);
            deferred.reject(
              new GatewayProtocolError(`gateway request timeout for ${method}`, {
                method,
                id,
              }),
            );
          }, timeoutMs);
    pending.set(id, { resolve: deferred.resolve, reject: deferred.reject, timer, method });
    sendFrame({ type: "req", id, method, params });
    return deferred.promise;
  }

  async function sendConnect() {
    if (connected) return;
    if (!connectNonce) {
      throw new GatewayProtocolError("connect.challenge nonce not received before connect");
    }
    const auth = {};
    if (gatewayAuthToken) auth.token = gatewayAuthToken;
    if (gatewayPassword) auth.password = gatewayPassword;
    const hello = await request("connect", {
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      client: {
        id: CLIENT_ID,
        version: OPENCLAW_VERSION,
        platform: process.platform,
        mode: CLIENT_MODE,
        instanceId: `node-${randomUUID()}`,
      },
      role: ROLE,
      scopes: REQUIRED_SCOPES,
      ...(Object.keys(auth).length > 0 ? { auth } : {}),
    });
    if (!hello || hello.type !== "hello-ok") {
      throw new GatewayProtocolError("gateway connect did not return hello-ok", { hello });
    }
    connected = true;
  }

  async function subscribeToSession() {
    const res = await request("sessions.messages.subscribe", { key: sessionKey });
    if (!res || res.subscribed !== true) {
      throw new GatewayProtocolError("failed to subscribe to session message events", {
        response: res,
      });
    }
    subscribed = true;
  }

  async function startChatTurn() {
    const res = await request(
      "chat.send",
      {
        sessionKey,
        sessionId: explicitSessionId,
        message,
        timeoutMs: runTimeout,
        idempotencyKey: runId,
        ...(Array.isArray(attachments) && attachments.length > 0 ? { attachments } : {}),
      },
      { timeoutMs: 60000 },
    );
    if (!res || typeof res.runId !== "string") {
      throw new GatewayProtocolError("chat.send did not return a runId", { response: res });
    }
    remoteRunId = res.runId;
    started = true;
  }

  async function abortRun() {
    if (!connected || !subscribed || !remoteRunId || ws.readyState !== WebSocket.OPEN) return;
    try {
      await request("chat.abort", { sessionKey, runId: remoteRunId }, { timeoutMs: 5000 });
    } catch {}
  }

  const removeAbortListener = onceAbort(signal, () => {
    const err = new AbortError("runAgentStream aborted");
    Promise.resolve()
      .then(() => abortRun())
      .finally(() => {
        cleanupPending(err);
        safeClose(1000, "aborted");
        settleReject(err);
      });
  });

  ws.on("message", async (raw) => {
    if (settled) return;
    let frame;
    try {
      frame = JSON.parse(Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw));
    } catch (err) {
      fail(new GatewayProtocolError(`failed to parse gateway frame: ${String(err)}`));
      return;
    }

    if (frame.type === "res") {
      const entry = pending.get(frame.id);
      if (!entry) return;
      pending.delete(frame.id);
      if (entry.timer) clearTimeout(entry.timer);
      if (frame.ok) entry.resolve(frame.payload);
      else
        entry.reject(
          new GatewayProtocolError(frame.error?.message || "gateway request failed", {
            response: frame,
          }),
        );
      return;
    }

    if (frame.type !== "event") {
      fail(
        new GatewayProtocolError(`unexpected gateway frame type: ${String(frame.type)}`, {
          frame,
        }),
      );
      return;
    }

    if (frame.event === "connect.challenge") {
      const nonce =
        frame.payload && typeof frame.payload.nonce === "string"
          ? frame.payload.nonce.trim()
          : "";
      if (!nonce) {
        fail(new GatewayProtocolError("gateway connect.challenge missing nonce", { frame }));
        return;
      }
      connectNonce = nonce;
      try {
        await sendConnect();
        await subscribeToSession();
        await startChatTurn();
      } catch (err) {
        fail(err instanceof Error ? err : new Error(String(err)));
      }
      return;
    }

    if (frame.event !== "chat") return;
    const payload = frame.payload;
    if (!payload || typeof payload !== "object") return;
    if (payload.sessionKey !== sessionKey) return;
    if (!started || !remoteRunId) return;
    if (payload.runId !== remoteRunId) return;

    const state = payload.state;
    if (state === "delta") {
      latestText = extractTextFromMessage(payload.message);
      onDeltaFn(latestText);
      return;
    }
    if (state === "final") {
      latestText = extractTextFromMessage(payload.message);
      onDeltaFn(latestText);
      finalStopReason = payload.stopReason || "end_turn";
      cleanupPending(new GatewayProtocolError("run finished"));
      safeClose(1000, "final");
      settleResolve({ finalText: latestText, stopReason: finalStopReason });
      return;
    }
    if (state === "error") {
      fail(
        new GatewayProtocolError(`gateway chat error: ${payload.errorMessage || "unknown"}`, {
          payload,
        }),
      );
      return;
    }
    if (state === "aborted") {
      fail(new GatewayProtocolError("gateway chat run aborted", { payload }));
    }
  });

  ws.on("error", (err) => {
    if (settled) return;
    fail(err instanceof Error ? err : new Error(String(err)));
  });

  ws.on("close", (code, reasonBuffer) => {
    const closeReason = Buffer.isBuffer(reasonBuffer)
      ? reasonBuffer.toString("utf8")
      : String(reasonBuffer || "");
    cleanupPending(
      new GatewayProtocolError(`gateway socket closed (${code}): ${closeReason || "no reason"}`),
    );
    if (!settled) {
      settleReject(
        new GatewayProtocolError(
          `gateway socket closed before final result (${code}): ${closeReason || "no reason"}`,
        ),
      );
    }
  });

  try {
    return await finished.promise;
  } finally {
    removeAbortListener();
    safeClose(1000, "done");
  }
}
