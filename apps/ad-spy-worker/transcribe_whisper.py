#!/usr/bin/env python3
"""
Batch transcription sidecar for the ad-spy worker.

WHY A SIDECAR, AND WHY BATCHED
------------------------------
Loading a Whisper model costs seconds (tens of seconds for large-v3 on CPU). Spawning one process
per ad would pay that cost 20 times for a 20-ad run, dwarfing the actual transcription. So the
worker hands this script the WHOLE manifest for a run: the model loads once and every file is
transcribed against it.

This mirrors the precedent render.js set in openclaw-bridge — spawn a purpose-built binary per job
rather than pulling a heavy runtime into the Node process.

NO ffmpeg BINARY IS NEEDED
--------------------------
faster-whisper 1.x decodes and resamples with PyAV (bundled), so the .mp4 is fed in directly. An
earlier version of this pipeline shelled out to `ffmpeg` to produce a 16 kHz mono WAV first; that
was a whole system dependency, a temp file per ad and a failure mode, all to do what the library
already does internally. Do not reintroduce it.

PROTOCOL
--------
stdin/arg:  --manifest <path to JSON>  ->  [{"id": <adId>, "media": "/abs/path.mp4"}, ...]
stdout:     one NDJSON object per line, so the parent can stream progress:
              {"type":"ready","device":"cuda","model":"large-v3","compute_type":"float16"}
              {"type":"result","id":123,"text":"...","lang":"pt","duration":31.2}
              {"type":"error","id":124,"error":"..."}
              {"type":"done","ok":3,"failed":1}
stderr:     human-readable log only. Never parsed.

NOTA SOBRE ALUCINAÇÃO (não mexa no VAD sem ler isto)
----------------------------------------------------
Muito anúncio é SÓ MÚSICA com texto na tela — não tem fala nenhuma. Em cima de música o Whisper
alucina com confiança: num teste real, um anúncio brasileiro de implante dentário produziu
"I'm just an artist, artist / Money's all I like to call you". Isso é pior que não ter transcrição,
porque vai direto para o corpus e envenena a análise do agente.

A causa era um `vad_parameters={"min_silence_duration_ms": 500}` daqui, que deixava o VAD menos
agressivo e entregava a música ao decoder. Com os parâmetros DEFAULT o mesmo anúncio devolve zero
segmentos, que é a resposta correta. Por isso:

  1. os parâmetros do VAD são os defaults, de propósito;
  2. `filter_segments()` ainda derruba o que passar, por confiança (no_speech_prob) e por
     repetição (compression_ratio) — as duas assinaturas clássicas de alucinação;
  3. anúncio sem fala devolve texto VAZIO, e o prompt do agente já trata isso como
     "(não disponível)".

Exit code is 0 whenever the batch ran, even with per-file failures — a single corrupt creative
must not fail a whole mining run. A non-zero exit means the batch could not start at all
(no faster-whisper, bad manifest).
"""

import argparse
import json
import os
import sys
import traceback


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def emit(obj):
    """One NDJSON line on stdout, flushed so the parent sees progress live."""
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def detect_device(requested):
    """
    Resolve the device. An explicit request wins; otherwise probe for CUDA.

    The probe is deliberately tolerant: faster-whisper runs on CTranslate2, which may or may not
    have been built with CUDA, and torch may not be installed at all. Any failure means CPU, which
    is correct but slower — never an error.
    """
    if requested:
        return requested
    try:
        import ctranslate2  # noqa: F401

        count = ctranslate2.get_cuda_device_count()
        if count and count > 0:
            return "cuda"
    except Exception:
        pass
    try:
        import torch  # noqa: F401

        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        pass
    return "cpu"


def pick_model(requested, device):
    """
    Default model per device.

    Ad creatives are short (15-60s) and the audio is clean studio/phone speech, so `small` on CPU
    is already accurate enough for theme and hook extraction — and int8 keeps it fast on many
    cores. With a GPU there is no reason not to use large-v3.
    """
    if requested:
        return requested
    return "large-v3" if device == "cuda" else "small"


def pick_compute_type(device):
    # float16 on GPU; int8 on CPU, which is ~3-4x faster than float32 at negligible quality cost
    # for speech this clean.
    return "float16" if device == "cuda" else "int8"


def smoke_test(model):
    """
    Force one real encode pass so a broken GPU fails HERE, not mid-batch.

    This is not paranoia. `ctranslate2.get_cuda_device_count()` can report a GPU while the CUDA
    runtime libraries are unusable (a missing libcublas is the classic case) — and, crucially,
    `WhisperModel(...)` still CONSTRUCTS FINE in that state. The failure only surfaces on the first
    encode. Without this probe the fallback below never fires, and the run dies partway through the
    batch with a cryptic loader error instead of quietly finishing on CPU.

    Three seconds of silence is enough to reach the encoder and costs almost nothing.
    """
    import numpy as np

    silence = np.zeros(16000 * 3, dtype=np.float32)
    segments, _ = model.transcribe(silence, language="pt", vad_filter=False, beam_size=1)
    for _ in segments:  # segments is lazy; iterate to actually run the encoder
        break


# Acima disto o próprio Whisper considera o trecho "não é fala". É o default dele (0.6); usamos o
# mesmo número, só que aplicado por segmento em vez de por janela.
NO_SPEECH_MAX = 0.6
# Assinatura de loop de repetição ("agende já agende já agende já..."). 2.4 é o limiar do Whisper.
COMPRESSION_MAX = 2.4
# O separador que realmente funciona entre fala e música-alucinada. Medido em 6 anúncios reais:
#
#     fala de verdade   -0.18  -0.21  -0.27  -0.29
#     música alucinada  -0.83  -0.88
#
# O default do Whisper (-1.0) é frouxo demais e deixa a música passar inteira. -0.6 fica no meio do
# vão, com ~0.3 de margem dos dois lados. Áudio real mas ruim (celular, rua) pode encostar aqui —
# se começarem a sumir transcrições legítimas, afrouxe com --log-prob-min.
LOG_PROB_MIN = -0.6


def filter_segments(segments, log_prob_min=LOG_PROB_MIN):
    """
    Keep only segments that look like real speech.

    Returns (kept_texts, dropped_count). Dropping everything is a legitimate outcome: it means the
    ad is music/silence, and an empty transcript is the honest answer. See NOTA SOBRE ALUCINAÇÃO.

    VAD alone is not enough here: singing IS voice activity, so a music-only ad sails through the
    VAD and the decoder cheerfully invents lyrics. These thresholds are the second line.
    """
    kept = []
    dropped = 0
    for seg in segments:
        text = (seg.text or "").strip()
        if not text:
            continue
        if getattr(seg, "no_speech_prob", 0.0) > NO_SPEECH_MAX:
            dropped += 1
            continue
        if getattr(seg, "avg_logprob", 0.0) < log_prob_min:
            dropped += 1
            continue
        if getattr(seg, "compression_ratio", 0.0) > COMPRESSION_MAX:
            dropped += 1
            continue
        kept.append(text)
    return kept, dropped


def humanize_media_error(err):
    """
    Turn a decoder stack trace into something an operator can act on.

    "tuple index out of range" out of PyAV means the container has no audio stream at all — a
    perfectly normal thing for a silent, text-on-screen creative, and not worth alarming anyone.
    """
    msg = str(err).strip()
    if "tuple index out of range" in msg or "no audio" in msg.lower():
        return "vídeo sem trilha de áudio"
    return msg[:300]


def load_model(WhisperModel, requested_model, device, allow_fallback=True):
    """
    Load the model on `device`, smoke-test it, and fall back to CPU if the GPU is unusable.

    Returns (model, device, model_name, compute_type).
    """
    model_name = pick_model(requested_model, device)
    compute_type = pick_compute_type(device)
    try:
        model = WhisperModel(model_name, device=device, compute_type=compute_type)
        smoke_test(model)
        return model, device, model_name, compute_type
    except Exception as err:
        if device != "cuda" or not allow_fallback:
            raise
        # Realistic causes: no free VRAM (this box also serves nginx and the bridge), or CUDA
        # libraries that are present-but-broken. Either way, CPU is slower but correct.
        log(f"GPU inutilizável ({str(err).strip()[:160]}); caindo para CPU")
        device = "cpu"
        model_name = pick_model(requested_model, device)
        compute_type = pick_compute_type(device)
        model = WhisperModel(model_name, device=device, compute_type=compute_type)
        smoke_test(model)
        return model, device, model_name, compute_type


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--lang", default="pt")
    ap.add_argument("--model", default="")
    ap.add_argument("--device", default="")
    ap.add_argument(
        "--log-prob-min",
        type=float,
        default=LOG_PROB_MIN,
        help="corte de confiança por segmento; menor = mais permissivo (default %(default)s)",
    )
    args = ap.parse_args()

    try:
        with open(args.manifest, "r", encoding="utf-8") as fh:
            jobs = json.load(fh)
    except Exception as err:
        log(f"manifest ilegível: {err}")
        return 2
    if not isinstance(jobs, list):
        log("manifest deve ser uma lista")
        return 2

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        log(
            "faster-whisper não instalado. Instale num venv que o usuário do serviço possa\n"
            "escrever (a HOME dele, não /opt) e aponte SPY_PYTHON_BIN para ele:\n"
            "  python3 -m venv ~/ad-spy-venv\n"
            "  ~/ad-spy-venv/bin/pip install faster-whisper\n"
            "  # spy.env:  SPY_PYTHON_BIN=/home/deploy/ad-spy-venv/bin/python"
        )
        return 3

    device = detect_device(args.device)
    forced = bool(args.device)

    try:
        model, device, model_name, compute_type = load_model(
            WhisperModel, args.model, device, allow_fallback=not forced
        )
    except Exception as err:
        log(f"não foi possível carregar o modelo: {err}")
        return 4

    emit(
        {
            "type": "ready",
            "device": device,
            "model": model_name,
            "compute_type": compute_type,
            "count": len(jobs),
        }
    )

    ok = 0
    failed = 0
    for job in jobs:
        ad_id = job.get("id")
        media = job.get("media") or job.get("wav")  # "wav" aceito por compatibilidade
        if not media or not os.path.exists(media):
            failed += 1
            emit({"type": "error", "id": ad_id, "error": "arquivo de mídia ausente"})
            continue
        try:
            # O caminho do .mp4 vai direto: o PyAV decodifica e reamostra para 16 kHz mono.
            segments, info = model.transcribe(
                media,
                language=args.lang or None,
                # VAD corta silêncio e trechos só-música, que é o que enche criativo de anúncio.
                # Os parâmetros são os DEFAULTS de propósito — ver NOTA SOBRE ALUCINAÇÃO no topo.
                vad_filter=True,
                beam_size=5,
                condition_on_previous_text=False,
            )
            kept, dropped = filter_segments(segments, args.log_prob_min)
            text = " ".join(kept).strip()
            emit(
                {
                    "type": "result",
                    "id": ad_id,
                    "text": text,
                    "lang": getattr(info, "language", args.lang),
                    "duration": round(float(getattr(info, "duration", 0.0)), 2),
                    # O pai loga isto; é o que distingue "anúncio sem fala" de "transcrição falhou".
                    "dropped": dropped,
                }
            )
            ok += 1
        except Exception as err:
            failed += 1
            friendly = humanize_media_error(err)
            # Um criativo mudo é situação NORMAL (vídeo com texto na tela), não um bug — não
            # polui o stderr com stack trace. Só o que não sabemos explicar ganha traceback.
            if friendly == str(err).strip()[:300]:
                log(traceback.format_exc())
            else:
                log(f"anúncio {ad_id}: {friendly}")
            emit({"type": "error", "id": ad_id, "error": friendly})

    emit({"type": "done", "ok": ok, "failed": failed, "device": device, "model": model_name})
    return 0


if __name__ == "__main__":
    sys.exit(main())
