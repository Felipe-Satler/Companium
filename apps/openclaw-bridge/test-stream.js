// Standalone check for the Gateway WS streaming client — does NOT touch the
// running bridge. Run it on the server after `git pull`, with the same gateway
// auth env the bridge will use, to prove connectivity/auth/protocol/streaming
// before restarting anything.
//
// Usage (in apps/openclaw-bridge/):
//   OPENCLAW_GATEWAY_TOKEN=... node test-stream.js <agentId> "<message>"
//   (omit the token if the gateway auth mode is "none")
//
// Success = tokens print progressively, then a FINAL block. Failure prints the
// exact error (auth, connect, timeout, etc.) so you can fix it with the bridge
// still serving traffic normally.

import { runAgentStream } from "./openclaw-agent-stream.js";

const agentId = process.argv[2] || "grooagent";
const content = process.argv[3] || "Diga olá em uma frase curta.";
const sessionId = `test-${Date.now()}`;

console.error(`[test] agent=${agentId} session=${sessionId}\n[test] streaming...\n`);

let last = "";
try {
  const { finalText, stopReason } = await runAgentStream({
    agentId,
    content,
    sessionId,
    onDelta: (snap) => {
      process.stdout.write(snap.slice(last.length)); // print only the new part
      last = snap;
    },
  });
  console.log(`\n\n--- FINAL (${stopReason}) ---\n${finalText}`);
  process.exit(0);
} catch (e) {
  console.error(`\n\n[test] STREAM FAILED: ${e?.message || e}`);
  process.exit(1);
}
