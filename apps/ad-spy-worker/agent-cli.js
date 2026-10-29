/**
 * Run one agent turn through the OpenClaw **CLI**, as an alternative to the Gateway WebSocket.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Gateway refused our `connect` with "device identity required" — it wants a paired device
 * identity that neither this worker nor `openclaw-bridge` carries in its environment. Rather than
 * block the whole feature on that, we take the path the bridge already keeps for the non-streaming
 * case: spawn `openclaw agent --json` and read the envelope.
 *
 * And for THIS worker the CLI is arguably the better fit anyway. `runAgentStream` exists so the
 * chat can push tokens to a browser as they arrive; the ad-spy worker streams to nobody. It writes
 * stage progress to Supabase and the UI polls — the analysis is a single long call whose only
 * output is the final text. Streaming buys nothing and costs a Gateway handshake that can fail.
 *
 * Same envelope the bridge expects: { status: "ok", result: { payloads: [{ text }] } }.
 */

import { spawn } from "node:child_process";
import { OPENCLAW_BIN, SPY_RUN_TIMEOUT_MS } from "./config.js";

export class AgentCliError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = "AgentCliError";
    this.detail = detail;
  }
}

/**
 * Parse JSON from CLI stdout, tolerating noise around it.
 *
 * Mirrors `tryParseJson` in openclaw-bridge, and the two steps matter for different reasons:
 * parsing the WHOLE text handles a pretty-printed multi-line envelope, and the first-`{`-to-
 * last-`}` slice handles plugin banners or warnings printed around it. An earlier version here
 * scanned line by line and therefore failed on any indented JSON — which is exactly how it
 * failed in production ("resposta do agente não é JSON").
 */
export function tryParseJson(raw) {
  if (!raw) return null;
  const text = String(raw).trim();
  try {
    return JSON.parse(text);
  } catch {
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

/** Pull the text out of the CLI's JSON envelope. Mirrors extractAgentContent in the bridge. */
export function extractAgentContent(json) {
  if (!json || json.status !== "ok") {
    const summary =
      (json && (json.summary || (json.result && json.result.summary))) || "OpenClaw error";
    return { ok: false, error: String(summary) };
  }
  const payloads =
    (json.result && Array.isArray(json.result.payloads) && json.result.payloads) || [];
  const content = payloads
    .map((p) => (p && typeof p.text === "string" ? p.text : ""))
    .filter(Boolean)
    .join("\n\n")
    .trim();
  return { ok: true, content };
}

/**
 * @param {{ agentId: string, content: string, sessionId: string,
 *           timeoutMs?: number, signal?: AbortSignal, log?: (m: string) => void }} args
 * @returns {Promise<{ finalText: string, stopReason: string }>}
 */
export function runAgentCli({ agentId, content, sessionId, timeoutMs, signal, log }) {
  const runTimeoutMs = timeoutMs || SPY_RUN_TIMEOUT_MS;
  const timeoutSeconds = Math.max(30, Math.round(runTimeoutMs / 1000));
  // Hard kill a bit past the agent's own timeout, so it gets a chance to end cleanly first.
  const killMs = runTimeoutMs + 30000;

  return new Promise((resolve, reject) => {
    // Arg array, never a shell: `content` carries ad copy and transcripts scraped from the open
    // web, so it is untrusted text and must never reach a shell parser.
    const args = [
      "agent",
      "--agent",
      agentId,
      "-m",
      content,
      "--json",
      "--session-id",
      sessionId,
      "--timeout",
      String(timeoutSeconds),
    ];

    let child;
    try {
      child = spawn(OPENCLAW_BIN, args, {
        shell: false,
        env: process.env,
        timeout: killMs,
        killSignal: "SIGKILL",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      return reject(new AgentCliError(`não foi possível executar "${OPENCLAW_BIN}"`, err?.message));
    }

    let stdout = "";
    let stderr = "";
    let settled = false;

    const onAbort = () => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new AgentCliError("cancelado"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      reject(
        new AgentCliError(
          err?.code === "ENOENT"
            ? `binário "${OPENCLAW_BIN}" não encontrado no PATH do serviço`
            : `falha ao executar o agente: ${err?.message}`,
          stderr.slice(0, 300)
        )
      );
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);

      // Parse ANTES de olhar o código de saída: a CLI sai != 0 e ainda assim imprime um envelope
      // com `summary`, que é uma mensagem muito melhor que "saiu com código 1". Mesma ordem que
      // o openclaw-bridge usa.
      const parsed = tryParseJson(stdout);
      if (!parsed) {
        return reject(
          new AgentCliError(
            code === 0
              ? "a saída do agente não é JSON"
              : `openclaw agent saiu com código ${code} e sem JSON`,
            (stdout || stderr).slice(0, 600)
          )
        );
      }

      const out = extractAgentContent(parsed);
      if (!out.ok) return reject(new AgentCliError(`o agente falhou: ${out.error}`));
      if (!out.content) {
        return reject(new AgentCliError("o agente respondeu vazio"));
      }
      log?.(`agente respondeu ${out.content.length} chars (via CLI)`);
      resolve({ finalText: out.content, stopReason: "end_turn" });
    });
  });
}
