"""The speech-to-text sidecar.

A long-lived process that reads one JSON request per line on stdin and writes one
JSON response per line on stdout, exactly like the OCR sidecar next to it. Node
starts it on the first transcription and then talks to it for the life of the
server.

The three decisions the OCR service made apply here for the same reasons, and one
of them matters more:

**Long-lived, not one process per request.** Loading the `base` model takes about
six seconds and 147 MB. Paying that per recording would make a two-second
sentence take eight.

**stdin/stdout, not HTTP.** A pipe has no address, so there is nothing to expose
and nothing to authenticate.

**Audio arrives as base64 in the message, never as a file path.** This is the
part that matters more here than for screenshots: **a recording of somebody's
voice is the most sensitive thing this project ever handles.** It is decoded in
memory, transcribed, and dropped. Nothing is written to disk, so there is no
temporary file to forget, no backup that quietly keeps a copy, and no path to get
wrong.

A fourth decision is this service's own:

**One engine behind a narrow interface.** `transcribe()` below is the only thing
the caller knows about, so swapping whisper.cpp for `faster-whisper`, a hosted
API, or the browser's own speech engine is a change to this file and nothing
else. The owner asked for that split explicitly, and it is the right seam: the
part that is hard to get right is the *recognition*, and the part that is easy to
get wrong in a dozen small ways is turning a sentence into five fields.

Protocol, one JSON object per line:

    -> {"id": "1", "audio": "<base64>", "language": "zh"}
    <- {"id": "1", "ok": true, "text": "午饭 38", "seconds": 1.2}

On startup it prints {"ready": true} so the caller knows the model is loaded
rather than guessing with a sleep.
"""

from __future__ import annotations

import base64
import binascii
import io
import json
import os
import sys
import time
import traceback

import av
import numpy as np

# Whisper only ever wants this: 16 kHz, mono, float32 in [-1, 1].
TARGET_RATE = 16_000

# Refuse anything unreasonable before decoding. Ten minutes of speech is far more
# than a sentence about lunch, and the API enforces its own limit too — both ends
# check because either could be called by something else one day.
MAX_AUDIO_BYTES = 8 * 1024 * 1024
MAX_SECONDS = 60

# The model target for the next version (owner decision, S15-A · 2026-10-20):
# `base` is the default, `small` stays as the fallback.
#
# The numbers behind that decision are the S14-V measurements on the 2-vCPU
# production host, 4.7-second sample, same candidate code:
#
#   base  — 148 MB, model load 0.49 s, inference 6.72 s, total 6.73 s
#   small — 488 MB, model load 1.53 s, inference 25.51 s, total 25.54 s
#
# Amount/date/channel/direction were equally correct on the synthetic set (9/9,
# 7/7, 9/9, 9/9); `small` was better on merchant names (3/3 against base's 2/3 —
# base heard 星巴克 as 新八课), which is why `small` is kept as a one-variable
# fallback rather than deleted. ⚠️ Neither model meets the 5-second target yet,
# so this is a *candidate* default and must not be described as released.
#
# Overridable so the choice can be revisited on a server without editing code,
# and named in the startup line so a log says which one is actually loaded rather
# than which one was intended. `LIBELLUM_WHISPER_MODEL=small` selects the
# fallback.
DEFAULT_MODEL_NAME = "base"


def _model_name(value: str | None) -> str:
    """The model name from an env var, falling back to the S15-A target."""
    name = (value or "").strip()
    return name if name != "" else DEFAULT_MODEL_NAME


MODEL_NAME = _model_name(os.environ.get("LIBELLUM_WHISPER_MODEL"))
# A model spec may be a local path. Keeping this separate from MODEL_NAME lets a
# deployment switch models without changing the name written to logs.
MODEL_SPEC = os.environ.get("LIBELLUM_WHISPER_MODEL_PATH") or MODEL_NAME

# On the 2-vCPU production host two threads match the available cores. The old
# fallback of four was only used when the deployment forgot to set the env var;
# more threads than cores makes a CPU-only decoder compete with itself.
DEFAULT_THREADS = max(1, min(2, os.cpu_count() or 1))


def _thread_count(value: str | None) -> int:
    try:
        configured = int(value) if value is not None and value.strip() != "" else DEFAULT_THREADS
    except ValueError:
        configured = DEFAULT_THREADS
    return max(1, min(configured, os.cpu_count() or configured))


THREADS = _thread_count(os.environ.get("LIBELLUM_WHISPER_THREADS"))

# VAD is deliberately conservative: it only skips clips with almost no energy,
# where Whisper would otherwise spend a full inference pass and often invent
# text. Normal speech still goes through the model unchanged.
#
# ⚠️ `LIBELLUM_WHISPER_VAD=0` is the escape hatch: if the energy gate ever
# discards real speech on a device with unusual gain, recognition can be restored
# without a code change.
def _env_flag(value: str | None, default: bool) -> bool:
    """Read a boolean env var the way the other services do."""
    if value is None or value.strip() == "":
        return default
    return value.strip().lower() not in {"0", "false", "no", "off"}


VAD_ENABLED = _env_flag(os.environ.get("LIBELLUM_WHISPER_VAD"), True)
VAD_FRAME_SECONDS = 0.02
VAD_MIN_SPEECH_SECONDS = 0.20
VAD_PEAK_FLOOR = 0.002

# Whisper can emit non-speech tokens ("[BLANK_AUDIO]", "(音乐)", "[NOISE]") on
# noisy recordings. The energy gate already refuses near-silence, but a cough or
# a passing bus can still reach the model; suppressing those tokens keeps them
# out of the transcript without touching the words that were actually said.
# whisper.cpp exposes this as `suppress_nst`. It defaults on because the failure
# is visible nonsense in the note field, and can be switched off by env for a
# deployment that finds it removes a real sound description.
SUPPRESS_NST = _env_flag(os.environ.get("LIBELLUM_WHISPER_SUPPRESS_NST"), True)

# Greedy decoding, explicitly, rather than inheriting a library default. A
# bookkeeping sentence has one obvious reading; temperature 0 is the least
# surprising one and keeps repeated requests stable. The fallback schedule
# (`temperature_inc`) stays at its default so a stuck decode can still recover.
TEMPERATURE = 0.0

# ---------------------------------------------------------------------------
# The hint that steers recognition towards bookkeeping.
# ---------------------------------------------------------------------------

"""
The owner's idea, and a good one: **"既然识别声用的是AI，可不可以给他一些提示词，
比如说让他把听到的声音往金钱记账方面去靠一靠？"**

Whisper takes an `initial_prompt` — text prepended before decoding that biases
what it expects to hear next. It is the nearest thing the model has to "the
subject is money", so this is exactly the right lever.

**The wording is chosen around three rules.**

1. **Only words that are easy to mishear as something else, or that the user is
   likely to say.** 微信 and 支付宝 are the obvious ones: a general model hearing
   "微信" with no context may write 威信 or 维新. 余额, 收款, 零钱 have the same
   problem in ordinary speech.

2. **No category names.** The temptation is to list 餐饮、交通、房租、水电 so the
   model "knows the domain" — but the categories are user-editable, and a prompt
   full of them would **plant words the speaker never said**, which is the one
   failure this feature cannot afford: an amount is confirmable at a glance, an
   invented note is not.

3. **Short.** A long prompt crowds out the actual audio in the model's context
   window and costs time on every request. It biases the decoder, it does not
   teach it, so a line is enough.

`carry_initial_prompt` is left **off**, which is whisper's default and the right
choice here: carrying it into every decode window would repeat the bias and make
the model progressively more likely to hallucinate the prompt's own words into
silence.
"""
INITIAL_PROMPT = os.environ.get(
    "LIBELLUM_WHISPER_PROMPT",
    "记账。微信支付，支付宝，银行卡，花呗，信用卡，余额，零钱，红包，转账，"
    "收款，付款，退款，工资，报销，房租，水电费，话费，加油，停车费，打车，外卖。",
)


def decode_audio(payload: str) -> np.ndarray:
    """Decode any container the browser produced into 16 kHz mono float32.

    PyAV rather than a WAV reader because the browser decides the format, not us:
    Chrome records `audio/webm;codecs=opus`, Safari records `audio/mp4` with AAC.
    Handing either to a WAV parser produces silence at best, and both are decoded
    here by the same code path, which is one fewer difference between browsers to
    discover on a phone.

    Raises `ValueError` with a reason the caller can show, rather than letting a
    decoder exception surface as a 500.
    """
    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, TypeError, ValueError) as error:
        # TypeError covers a missing/`None` payload: the caller sent no string at
        # all, which is not something to let surface as a 500.
        raise ValueError("audio_not_base64") from error

    if len(raw) > MAX_AUDIO_BYTES:
        raise ValueError("audio_too_large")

    try:
        container = av.open(io.BytesIO(raw))
    except Exception as error:  # PyAV's exception base class differs by release
        raise ValueError("audio_undecodable") from error

    try:
        stream = next(s for s in container.streams if s.type == "audio")
    except StopIteration as error:
        raise ValueError("audio_undecodable") from error

    # `to_ndarray` gives (samples, channels) as int16 for most codecs; the
    # resampler converts to the rate, layout and format whisper wants in one
    # step, so nothing downstream has to know what the browser chose.
    resampler = av.audio.resampler.AudioResampler(
        format="fltp",
        layout="mono",
        rate=TARGET_RATE,
    )

    chunks: list[np.ndarray] = []
    total = 0

    for frame in container.decode(stream):
        for converted in resampler.resample(frame):
            samples = converted.to_ndarray()
            chunks.append(samples.reshape(-1))
            total += samples.size

            # Stop early rather than decoding a long file the API would refuse
            # anyway: the cost of decoding is the cost of holding it.
            if total > TARGET_RATE * MAX_SECONDS:
                raise ValueError("audio_too_long")

    # Flush whatever the resampler is still holding.
    for converted in resampler.resample(None):
        samples = converted.to_ndarray()
        chunks.append(samples.reshape(-1))

    container.close()

    if not chunks:
        raise ValueError("audio_empty")

    audio = np.concatenate(chunks).astype(np.float32)

    if audio.size == 0:
        raise ValueError("audio_empty")

    return audio


def detect_speech(audio: np.ndarray) -> tuple[bool, float]:
    """Conservatively decide whether a clip contains any speech at all.

    This is intentionally an energy gate, not a full VAD: it must never discard
    normal speech. A clip is skipped only when its frame RMS never rises meaningfully
    above its own noise floor and the absolute floor. The caller still uses Whisper
    for every clip that passes, so recognition quality is unchanged.

    Returns ``(has_speech, active_seconds)``.
    """
    if audio.size == 0:
        return False, 0.0

    frame_size = max(1, int(TARGET_RATE * VAD_FRAME_SECONDS))
    usable = audio[: audio.size - (audio.size % frame_size)]
    if usable.size < frame_size:
        return False, 0.0

    frames = usable.reshape(-1, frame_size).astype(np.float64)
    rms = np.sqrt(np.mean(frames * frames, axis=1))
    peak = float(rms.max())
    if peak < VAD_PEAK_FLOOR:
        return False, 0.0

    # A relative-to-peak gate follows both a quiet recording and a loud one.
    # Using the 20th percentile alone would reject a perfectly steady tone:
    # with no pauses, the "noise floor" is the speech itself.
    threshold = max(VAD_PEAK_FLOOR, peak * 0.08)
    active = rms >= threshold
    active_seconds = float(active.sum()) * VAD_FRAME_SECONDS

    if active_seconds < VAD_MIN_SPEECH_SECONDS:
        return False, active_seconds
    return True, active_seconds


def main() -> int:
    # Imported here, not at module scope, so `decode_audio` can be imported and
    # tested without loading a model.
    from pywhispercpp.model import Model

    print(json.dumps({"ready": False, "loading": True}), flush=True)

    model_started = time.perf_counter()
    model = Model(
        MODEL_SPEC,
        n_threads=THREADS,
        print_realtime=False,
        print_progress=False,
    )
    model_load_ms = round((time.perf_counter() - model_started) * 1000, 1)

    print(
        json.dumps(
            {
                "ready": True,
                "model": MODEL_SPEC,
                "threads": THREADS,
                "vad": VAD_ENABLED,
                "suppressNst": SUPPRESS_NST,
                "temperature": TEMPERATURE,
                "modelLoadMs": model_load_ms,
            }
        ),
        flush=True,
    )

    for line in sys.stdin:
        line = line.strip()
        if line == "":
            continue

        started = time.perf_counter()
        request_id = None
        decode_ms = 0.0
        vad_ms = 0.0
        infer_ms = 0.0

        try:
            # ⚠️ Parsed separately so a malformed line is reported as a malformed
            # line. `json.JSONDecodeError` is a `ValueError`, so the old single
            # `except ValueError` answered a broken request with its *Python
            # exception text* as the error code and "音频无法识别。" as the message
            # — true of the audio, misleading about the request.
            try:
                request = json.loads(line)
            except json.JSONDecodeError:
                raise ValueError("bad_request") from None

            if not isinstance(request, dict):
                raise ValueError("bad_request")

            request_id = request.get("id")
            language = request.get("language")

            # Reject a request with no audio as a typed rejection rather than
            # letting the KeyError become "transcribe_failed".
            payload = request.get("audio")
            if not isinstance(payload, str):
                raise ValueError("audio_missing")

            decode_started = time.perf_counter()
            audio = decode_audio(payload)
            decode_ms = round((time.perf_counter() - decode_started) * 1000, 1)

            speech_present = True
            active_seconds = 0.0
            if VAD_ENABLED:
                vad_started = time.perf_counter()
                speech_present, active_seconds = detect_speech(audio)
                vad_ms = round((time.perf_counter() - vad_started) * 1000, 1)

            timings = {
                "decodeMs": decode_ms,
                "vadMs": vad_ms,
                "inferMs": 0.0,
                "totalMs": 0.0,
            }

            if not speech_present:
                # Do not feed a silent clip to Whisper: it costs a full decode
                # pass and can hallucinate text into the gap.
                total_ms = round((time.perf_counter() - started) * 1000, 1)
                timings["totalMs"] = total_ms
                print(
                    json.dumps(
                        {
                            "id": request_id,
                            "ok": True,
                            "text": "",
                            "speechless": True,
                            "seconds": round(total_ms / 1000, 2),
                            "audioSeconds": round(audio.size / TARGET_RATE, 2),
                            "activeSeconds": round(active_seconds, 2),
                            "timings": timings,
                        },
                        ensure_ascii=False,
                    ),
                    flush=True,
                )
                continue

            infer_started = time.perf_counter()
            segments = model.transcribe(
                audio,
                language=language,
                # One sentence about a purchase: no context to carry, and keeping
                # it avoids whisper inventing continuity between two recordings
                # that have nothing to do with each other.
                no_context=True,
                # The bookkeeping hint. See INITIAL_PROMPT above for what is in it
                # and, more importantly, what is deliberately not.
                initial_prompt=INITIAL_PROMPT,
                # Keep bracket noise ("[BLANK_AUDIO]", "(音乐)") out of the note.
                # See SUPPRESS_NST above; disabled only by explicit env opt-out.
                suppress_nst=SUPPRESS_NST,
                temperature=TEMPERATURE,
            )
            infer_ms = round((time.perf_counter() - infer_started) * 1000, 1)
            timings["inferMs"] = infer_ms

            text = "".join(getattr(segment, "text", "") for segment in segments).strip()
            total_ms = round((time.perf_counter() - started) * 1000, 1)
            timings["totalMs"] = total_ms

            print(
                json.dumps(
                    {
                        "id": request_id,
                        "ok": True,
                        "text": text,
                        "seconds": round(total_ms / 1000, 2),
                        "audioSeconds": round(audio.size / TARGET_RATE, 2),
                        "activeSeconds": round(active_seconds, 2) if VAD_ENABLED else None,
                        "timings": timings,
                    },
                    ensure_ascii=False,
                ),
                flush=True,
            )
        except ValueError as error:
            print(
                json.dumps(
                    {"id": request_id, "ok": False, "error": str(error), "message": MESSAGES.get(str(error), "音频无法识别。")},
                    ensure_ascii=False,
                ),
                flush=True,
            )
        except Exception:  # noqa: BLE001 - one bad request must not kill the service
            traceback.print_exc(file=sys.stderr)
            print(
                json.dumps(
                    {
                        "id": request_id,
                        "ok": False,
                        "error": "transcribe_failed",
                        "message": "识别失败，请再试一次。",
                    },
                    ensure_ascii=False,
                ),
                flush=True,
            )

    return 0


MESSAGES = {
    "bad_request": "请求格式无法识别。",
    "audio_missing": "没有收到录音数据。",
    "audio_not_base64": "录音数据无法解码。",
    "audio_too_large": "录音文件过大。",
    "audio_too_long": f"录音超过 {MAX_SECONDS} 秒，请说短一点。",
    "audio_undecodable": "录音格式无法识别。",
    "audio_empty": "没有录到声音。",
}


if __name__ == "__main__":
    sys.exit(main())
