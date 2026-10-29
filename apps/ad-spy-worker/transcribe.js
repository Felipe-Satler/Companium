/**
 * Transcription driver: hands the downloaded creatives to the Python faster-whisper sidecar.
 *
 * It runs as a subprocess, which keeps the Node service free of a Python runtime and of a model
 * sitting in its heap — the same trade render.js makes by spawning headless Chrome instead of
 * bundling a PDF library.
 *
 * NO ffmpeg. faster-whisper 1.x decodes and resamples with PyAV (bundled), so the .mp4 goes in as
 * it is. An earlier version extracted a 16 kHz mono WAV with ffmpeg first — a system dependency, a
 * temp file per ad and an extra failure mode, all to do what the library already does internally.
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PYTHON_BIN,
  TRANSCRIBE_TIMEOUT_MS,
  WHISPER_DEVICE,
  WHISPER_LANG,
  WHISPER_LOG_PROB_MIN,
  WHISPER_MODEL,
} from "./config.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "transcribe_whisper.py");

/** Run a command to completion, capturing stdout/stderr. Never throws on a non-zero exit. */
function run(bin, args, { timeoutMs, onStdoutLine } = {}) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let pending = "";
    let timer = null;
    let timedOut = false;

    if (timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);
    }

    child.stdout.on("data", (buf) => {
      const chunk = buf.toString("utf8");
      stdout += chunk;
      if (!onStdoutLine) return;
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) onStdoutLine(line.trim());
      }
    });
    child.stderr.on("data", (buf) => {
      stderr += buf.toString("utf8");
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}\n${err.message}`, timedOut });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (onStdoutLine && pending.trim()) onStdoutLine(pending.trim());
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

/** Probe for the tools this module needs, for GET /api/spy/health. */
export async function probe() {
  // Counting CUDA devices is NOT enough to say the GPU is usable: ctranslate2 happily reports a
  // device while the CUDA runtime libraries are missing, and the failure only shows up on the
  // first encode. We hit exactly that (libcublas.so.12 absent). So the probe also tries to dlopen
  // the libraries an encode needs — cheap, and it stops /health from advertising a GPU that every
  // real run then falls back off of.
  const PROBE = [
    "import json, ctypes",
    "import faster_whisper, ctranslate2, av",
    "n = ctranslate2.get_cuda_device_count()",
    "usable = n > 0",
    "missing = ''",
    "if usable:",
    "    for lib in ('libcublas.so.12', 'libcudnn_ops.so.9'):",
    "        try: ctypes.CDLL(lib)",
    "        except OSError as e:",
    "            usable = False; missing = lib; break",
    "print(json.dumps({'cuda': n, 'usable': usable, 'missing': missing}))",
  ].join("\n");

  const py = await run(PYTHON_BIN, ["-c", PROBE], { timeoutMs: 30000 });

  let cudaCount = 0;
  let cudaUsable = false;
  let cudaMissing = "";
  try {
    const parsed = JSON.parse((py.stdout || "").trim().split("\n").pop() || "{}");
    cudaCount = Number(parsed.cuda) || 0;
    cudaUsable = Boolean(parsed.usable);
    cudaMissing = parsed.missing || "";
  } catch {
    /* probe failed entirely; treated as no-CUDA below */
  }

  // An explicit SPY_WHISPER_DEVICE wins — if an operator forces cuda, report cuda and let the run
  // fail loudly rather than silently disagreeing with the setting.
  const device = WHISPER_DEVICE || (cudaUsable ? "cuda" : "cpu");
  return {
    fasterWhisper: py.code === 0,
    device,
    model: WHISPER_MODEL || (device === "cuda" ? "large-v3" : "small"),
    cudaDevices: cudaCount,
    // Set when a GPU exists but cannot be used — the single most useful line for "why is this slow?"
    cudaUnusable: cudaCount > 0 && !cudaUsable ? `${cudaMissing} não encontrada` : null,
  };
}

/**
 * Transcribe a batch of downloaded videos.
 *
 * @param {{ id: number, videoPath: string }[]} items
 * @param {{ log?: (m: string) => void, onProgress?: (done: number, total: number) => void,
 *           signal?: AbortSignal }} ctx
 * @returns {Promise<{ results: Map<number, {text, lang, duration}>, errors: Map<number, string>,
 *                     device: string|null, model: string|null }>}
 */
export async function transcribeBatch(items, ctx = {}) {
  const log = ctx.log || (() => {});
  const results = new Map();
  const errors = new Map();
  let device = null;
  let model = null;

  if (!items.length) return { results, errors, device, model };

  const workDir = await mkdtemp(path.join(tmpdir(), "adspy-stt-"));
  try {
    // The sidecar reads the mp4 directly; per-file decode failures (a creative with no audio
    // track, say) are reported per ad on its NDJSON stream, not here.
    const jobs = items.map((item) => ({ id: item.id, media: item.videoPath }));

    // One Python process for the whole batch, so the model loads once instead of per ad.
    const manifestPath = path.join(workDir, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(jobs), "utf8");

    let done = 0;
    const args = [SCRIPT, "--manifest", manifestPath, "--lang", WHISPER_LANG];
    if (WHISPER_MODEL) args.push("--model", WHISPER_MODEL);
    if (WHISPER_DEVICE) args.push("--device", WHISPER_DEVICE);
    if (WHISPER_LOG_PROB_MIN) args.push("--log-prob-min", WHISPER_LOG_PROB_MIN);

    const { code, stderr, timedOut } = await run(PYTHON_BIN, args, {
      // The timeout covers the whole batch: model load plus every file.
      timeoutMs: TRANSCRIBE_TIMEOUT_MS * Math.max(1, jobs.length),
      onStdoutLine: (line) => {
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          return; // stray print; stderr is where logs belong
        }
        if (msg.type === "ready") {
          device = msg.device;
          model = msg.model;
          log(`whisper pronto: ${msg.model} em ${msg.device} (${msg.compute_type})`);
        } else if (msg.type === "result") {
          results.set(msg.id, { text: msg.text, lang: msg.lang, duration: msg.duration });
          // `dropped` is how we tell "this ad genuinely has no speech" apart from "the model
          // hallucinated over music and we threw it away" — both give an empty transcript.
          if (msg.dropped > 0) {
            log(`anúncio ${msg.id}: ${msg.dropped} segmento(s) descartado(s) por baixa confiança`);
          }
          done += 1;
          ctx.onProgress?.(done, jobs.length);
        } else if (msg.type === "error") {
          errors.set(msg.id, msg.error);
          done += 1;
          ctx.onProgress?.(done, jobs.length);
        }
      },
    });

    if (code !== 0) {
      // The sidecar exits non-zero only when the batch could not start (missing faster-whisper,
      // unreadable manifest, model load failure) — a real configuration problem worth surfacing.
      const detail = timedOut ? "tempo limite excedido" : stderr.trim().slice(0, 400);
      throw new Error(`transcrição falhou: ${detail}`);
    }

    return { results, errors, device, model };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
