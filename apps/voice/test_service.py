"""Focused unit tests for the voice sidecar's deterministic pieces.

Run from `apps/voice` with the same Python environment as the service:

    python -m unittest -v test_service.py

**No Whisper model and no user recordings are used.** The model is replaced by a
stub in `MainLoopTests`, so the whole request loop — ready line, VAD short
circuit, error feedback, recovery — runs without ggml or a model file. The
"browser container" tests build a WAV in memory for the same reason the service
decodes from memory: no file path ever exists in production either.
"""

from __future__ import annotations

import base64
import io
import json
import sys
import types
import unittest
import wave
from unittest import mock

import numpy as np

import service


def wav_bytes(
    seconds: float = 1.0,
    rate: int = service.TARGET_RATE,
    channels: int = 1,
    amplitude: float = 0.0,
    frequency: float = 220.0,
) -> bytes:
    """A WAV built in memory. Silence when `amplitude` is 0, a tone otherwise."""
    frames = int(rate * seconds)
    if amplitude == 0.0:
        samples = np.zeros(frames * channels, dtype=np.int16)
    else:
        t = np.arange(frames, dtype=np.float32) / rate
        mono = (amplitude * np.sin(2 * np.pi * frequency * t) * 32767.0).astype(np.int16)
        samples = np.repeat(mono, channels)

    output = io.BytesIO()
    with wave.open(output, "wb") as handle:
        handle.setnchannels(channels)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(samples.tobytes())
    return output.getvalue()


def encoded_wav(**kwargs: object) -> str:
    return base64.b64encode(wav_bytes(**kwargs)).decode("ascii")


class ModelSettingsTests(unittest.TestCase):
    def test_base_is_the_default_model_and_small_is_the_fallback(self) -> None:
        # S15-A owner decision (2026-10-20): `base` is the target default,
        # `small` stays selectable as the fallback.
        self.assertEqual(service._model_name(None), "base")
        self.assertEqual(service._model_name(""), "base")
        self.assertEqual(service._model_name("   "), "base")
        self.assertEqual(service._model_name(" base "), "base")
        self.assertEqual(service._model_name("small"), "small")

    def test_thread_count_is_bounded_and_configurable(self) -> None:
        self.assertGreaterEqual(service._thread_count("1"), 1)
        self.assertLessEqual(service._thread_count("999"), service.os.cpu_count() or 999)
        self.assertGreaterEqual(service._thread_count("not-a-number"), 1)
        self.assertEqual(service._thread_count("2"), min(2, service.os.cpu_count() or 2))

    def test_vad_can_be_switched_off_by_env(self) -> None:
        # The escape hatch if the energy gate ever discards real speech.
        self.assertTrue(service._env_flag(None, True))
        self.assertTrue(service._env_flag("", True))
        self.assertTrue(service._env_flag("1", True))
        self.assertTrue(service._env_flag("true", True))
        self.assertTrue(service._env_flag("yes", True))
        self.assertFalse(service._env_flag("0", True))
        self.assertFalse(service._env_flag("false", True))
        self.assertFalse(service._env_flag("OFF", True))
        self.assertFalse(service._env_flag("no", True))
        self.assertFalse(service._env_flag(None, False))

    def test_noise_tokens_are_suppressed_and_decoding_is_greedy(self) -> None:
        # Bracket tags such as "[BLANK_AUDIO]" or "(音乐)" are not believable
        # bookkeeping notes; suppressing non-speech tokens keeps them out, and
        # temperature 0 keeps the same recording's wording stable. Both have an
        # env/constant escape hatch rather than being buried in a call site.
        self.assertTrue(service.SUPPRESS_NST)
        self.assertEqual(service.TEMPERATURE, 0.0)

    def test_every_rejection_has_a_message_for_the_user(self) -> None:
        # The sidecar's error message is shown to the user by the API route, so a
        # reason with no message would reach them as the generic fallback.
        reasons = {
            "bad_request",
            "audio_missing",
            "audio_not_base64",
            "audio_too_large",
            "audio_too_long",
            "audio_undecodable",
            "audio_empty",
        }
        self.assertEqual(set(service.MESSAGES), reasons)
        for message in service.MESSAGES.values():
            self.assertTrue(message.strip())


class DetectSpeechTests(unittest.TestCase):
    def test_digital_silence_is_rejected_without_inference(self) -> None:
        has_speech, active = service.detect_speech(np.zeros(service.TARGET_RATE * 3, dtype=np.float32))
        self.assertFalse(has_speech)
        self.assertEqual(active, 0.0)

    def test_low_level_noise_is_rejected(self) -> None:
        rng = np.random.default_rng(7)
        noise = (rng.normal(0, 0.0005, service.TARGET_RATE * 3)).astype(np.float32)
        has_speech, _ = service.detect_speech(noise)
        self.assertFalse(has_speech)

    def test_speech_like_energy_is_kept(self) -> None:
        t = np.arange(service.TARGET_RATE, dtype=np.float32) / service.TARGET_RATE
        tone = (0.08 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
        has_speech, active = service.detect_speech(tone)
        self.assertTrue(has_speech)
        self.assertGreater(active, 0.5)

    def test_short_click_is_not_treated_as_speech(self) -> None:
        audio = np.zeros(service.TARGET_RATE, dtype=np.float32)
        audio[1000:1100] = 0.5
        has_speech, active = service.detect_speech(audio)
        self.assertFalse(has_speech)
        self.assertLess(active, service.VAD_MIN_SPEECH_SECONDS)

    def test_speech_with_surrounding_silence_is_kept(self) -> None:
        t = np.arange(service.TARGET_RATE, dtype=np.float32) / service.TARGET_RATE
        tone = (0.05 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
        audio = np.concatenate(
            [np.zeros(service.TARGET_RATE, dtype=np.float32), tone, np.zeros(service.TARGET_RATE, dtype=np.float32)]
        )
        has_speech, _ = service.detect_speech(audio)
        self.assertTrue(has_speech)

    def test_empty_and_too_short_clips_report_no_speech(self) -> None:
        # Not an exception: a call that produced no samples is still "no speech".
        self.assertEqual(service.detect_speech(np.zeros(0, dtype=np.float32)), (False, 0.0))
        self.assertEqual(service.detect_speech(np.zeros(100, dtype=np.float32)), (False, 0.0))

    def test_active_seconds_approximates_the_speech_duration(self) -> None:
        # The caller logs this as a diagnostic; it must not claim a minute of
        # speech for a one-second tone.
        t = np.arange(service.TARGET_RATE, dtype=np.float32) / service.TARGET_RATE
        tone = (0.2 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
        has_speech, active = service.detect_speech(tone)
        self.assertTrue(has_speech)
        self.assertGreaterEqual(active, 0.9)
        self.assertLessEqual(active, 1.1)

    def test_vad_thresholds_stay_conservative(self) -> None:
        # A gate that needs more than a fraction of a second of energy would
        # start discarding short real recordings, which is the one failure this
        # VAD must not have.
        self.assertLess(service.VAD_MIN_SPEECH_SECONDS, 0.5)
        self.assertGreater(service.VAD_PEAK_FLOOR, 0.0)
        self.assertGreater(service.VAD_FRAME_SECONDS, 0.0)


class DecodeAudioTests(unittest.TestCase):
    def test_wav_is_decoded_in_memory(self) -> None:
        audio = service.decode_audio(encoded_wav())
        self.assertEqual(audio.dtype, np.float32)
        self.assertEqual(audio.size, service.TARGET_RATE)

    def test_stereo_44k_is_resampled_to_16k_mono(self) -> None:
        # The browser decides the container; PyAV is what makes the rate and the
        # channel count stop mattering to Whisper.
        audio = service.decode_audio(encoded_wav(seconds=1.0, rate=44_100, channels=2, amplitude=0.1))
        self.assertEqual(audio.ndim, 1)
        self.assertEqual(audio.dtype, np.float32)
        self.assertGreaterEqual(audio.size, 15_000)
        self.assertLessEqual(audio.size, 17_000)

    def test_a_quiet_tone_survives_decoding(self) -> None:
        audio = service.decode_audio(encoded_wav(seconds=0.5, amplitude=0.05))
        self.assertGreater(float(np.max(np.abs(audio))), 0.01)

    def test_invalid_base64_is_a_typed_rejection(self) -> None:
        with self.assertRaises(ValueError) as raised:
            service.decode_audio("not base64")
        self.assertEqual(str(raised.exception), "audio_not_base64")

    def test_a_missing_payload_is_a_typed_rejection(self) -> None:
        # A caller that forgot the field gets a rejection, not a TypeError 500.
        with self.assertRaises(ValueError) as raised:
            service.decode_audio(None)  # type: ignore[arg-type]
        self.assertEqual(str(raised.exception), "audio_not_base64")

    def test_empty_payload_is_rejected(self) -> None:
        with self.assertRaises(ValueError) as raised:
            service.decode_audio("")
        self.assertEqual(str(raised.exception), "audio_undecodable")

    def test_oversized_payload_is_rejected_before_decoding(self) -> None:
        payload = base64.b64encode(b"\x00" * 32).decode("ascii")
        with mock.patch.object(service, "MAX_AUDIO_BYTES", 8):
            with self.assertRaises(ValueError) as raised:
                service.decode_audio(payload)
        self.assertEqual(str(raised.exception), "audio_too_large")

    def test_overlong_clip_is_rejected_while_decoding(self) -> None:
        # Uses the same ceiling the API enforces, so a client that skips the
        # browser limit still cannot make the sidecar decode a long recording.
        with mock.patch.object(service, "MAX_SECONDS", 0.25):
            with self.assertRaises(ValueError) as raised:
                service.decode_audio(encoded_wav(seconds=1.0, amplitude=0.1))
        self.assertEqual(str(raised.exception), "audio_too_long")


class FakeModel:
    """Stands in for `pywhispercpp.Model`; records what it was asked to do."""

    instances: list["FakeModel"] = []

    def __init__(self, spec: object = "", **kwargs: object) -> None:
        self.spec = spec
        self.kwargs = kwargs
        self.calls: list[dict[str, object]] = []
        FakeModel.instances.append(self)

    def transcribe(self, audio: np.ndarray, **kwargs: object) -> list[types.SimpleNamespace]:
        self.calls.append({"samples": int(audio.size), **kwargs})
        return [types.SimpleNamespace(text=" 午饭 38 块 ")]


class MainLoopTests(unittest.TestCase):
    """The stdin/stdout request loop, with the model stubbed out."""

    def setUp(self) -> None:
        FakeModel.instances.clear()

    def run_loop(self, requests: list[object]) -> tuple[int, dict[str, object], list[dict[str, object]], FakeModel]:
        """Run main() once; return (exit code, ready line, request answers, model)."""
        fake_model_module = types.ModuleType("pywhispercpp.model")
        fake_model_module.Model = FakeModel  # type: ignore[attr-defined]
        fake_package = types.ModuleType("pywhispercpp")
        fake_package.model = fake_model_module  # type: ignore[attr-defined]

        lines = "".join(
            (request if isinstance(request, str) else json.dumps(request, ensure_ascii=False)) + "\n"
            for request in requests
        )
        stdout = io.StringIO()

        with mock.patch.dict(sys.modules, {"pywhispercpp": fake_package, "pywhispercpp.model": fake_model_module}):
            with mock.patch.object(sys, "stdin", io.StringIO(lines)):
                with mock.patch.object(sys, "stdout", stdout):
                    code = service.main()

        responses = [json.loads(line) for line in stdout.getvalue().splitlines() if line.strip()]
        self.assertEqual(len(FakeModel.instances), 1, "the model must be loaded once, not per request")
        # The first line says "loading", the second that the model is ready; the
        # answers follow.
        self.assertEqual(responses[0], {"ready": False, "loading": True})
        return code, responses[1], responses[2:], FakeModel.instances[0]

    def test_ready_line_names_what_was_actually_loaded(self) -> None:
        code, ready, answers, model = self.run_loop([])
        self.assertEqual(code, 0)
        self.assertEqual(answers, [])
        self.assertTrue(ready["ready"])
        self.assertEqual(ready["model"], service.MODEL_SPEC)
        self.assertEqual(ready["threads"], service.THREADS)
        self.assertEqual(ready["vad"], service.VAD_ENABLED)
        self.assertEqual(ready["suppressNst"], service.SUPPRESS_NST)
        self.assertEqual(ready["temperature"], service.TEMPERATURE)
        self.assertIn("modelLoadMs", ready)
        self.assertEqual(model.kwargs["n_threads"], service.THREADS)

    def test_silence_short_circuits_before_whisper(self) -> None:
        _, _, answers, model = self.run_loop([{"id": "1", "audio": encoded_wav(seconds=1.0), "language": "zh"}])
        answer = answers[0]
        self.assertTrue(answer["ok"])
        self.assertTrue(answer["speechless"])
        self.assertEqual(answer["text"], "")
        self.assertEqual(answer["timings"]["inferMs"], 0.0)
        self.assertEqual(model.calls, [], "silence must not reach the model")
        self.assertGreaterEqual(answer["timings"]["decodeMs"], 0.0)

    def test_speech_is_transcribed_with_the_bookkeeping_hint(self) -> None:
        _, _, answers, model = self.run_loop([{"id": "2", "audio": encoded_wav(amplitude=0.08), "language": "zh"}])
        answer = answers[0]
        self.assertTrue(answer["ok"])
        self.assertEqual(answer["text"], "午饭 38 块")
        self.assertNotIn("speechless", answer)
        self.assertGreaterEqual(answer["activeSeconds"], 0.5)
        self.assertEqual(len(model.calls), 1)
        call = model.calls[0]
        self.assertEqual(call["language"], "zh")
        self.assertTrue(call["no_context"])
        self.assertEqual(call["initial_prompt"], service.INITIAL_PROMPT)
        self.assertEqual(call["suppress_nst"], service.SUPPRESS_NST)
        self.assertEqual(call["temperature"], service.TEMPERATURE)
        self.assertEqual(call["samples"], service.TARGET_RATE)

    def test_a_bad_recording_is_reported_and_the_loop_keeps_going(self) -> None:
        # One bad request must not kill the sidecar: the next one is answered.
        _, _, answers, _ = self.run_loop(
            [
                {"id": "3", "audio": "not base64"},
                {"id": "4", "audio": encoded_wav(seconds=1.0)},
            ]
        )
        failed, answered = answers[0], answers[1]
        self.assertFalse(failed["ok"])
        self.assertEqual(failed["id"], "3")
        self.assertEqual(failed["error"], "audio_not_base64")
        self.assertEqual(failed["message"], service.MESSAGES["audio_not_base64"])
        self.assertTrue(answered["ok"])
        self.assertEqual(answered["id"], "4")

    def test_a_malformed_line_is_reported_as_a_bad_request(self) -> None:
        # `json.JSONDecodeError` is a ValueError; without the separate parse this
        # answered with Python exception text as the error code.
        _, _, answers, _ = self.run_loop(["this is not json", {"id": "5", "audio": encoded_wav(seconds=1.0)}])
        failed = answers[0]
        self.assertFalse(failed["ok"])
        self.assertEqual(failed["error"], "bad_request")
        self.assertEqual(failed["message"], service.MESSAGES["bad_request"])
        self.assertTrue(answers[1]["ok"])

    def test_a_request_without_audio_is_a_typed_rejection(self) -> None:
        _, _, answers, _ = self.run_loop([{"id": "6"}, []])
        self.assertEqual(answers[0]["error"], "audio_missing")
        self.assertEqual(answers[0]["message"], service.MESSAGES["audio_missing"])
        self.assertEqual(answers[1]["error"], "bad_request")


if __name__ == "__main__":
    unittest.main()
