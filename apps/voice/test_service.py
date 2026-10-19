"""Focused unit tests for the voice sidecar's deterministic pieces.

Run from `apps/voice` with the same Python environment as the service:

    python -m unittest -v test_service.py

These do not load a Whisper model and do not use user recordings.
"""

from __future__ import annotations

import base64
import io
import unittest
import wave

import numpy as np

import service


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
        audio = np.concatenate([np.zeros(service.TARGET_RATE, dtype=np.float32), tone, np.zeros(service.TARGET_RATE, dtype=np.float32)])
        has_speech, _ = service.detect_speech(audio)
        self.assertTrue(has_speech)

    def test_thread_count_is_bounded_and_configurable(self) -> None:
        self.assertGreaterEqual(service._thread_count("1"), 1)
        self.assertLessEqual(service._thread_count("999"), service.os.cpu_count() or 999)
        self.assertGreaterEqual(service._thread_count("not-a-number"), 1)


class DecodeAudioTests(unittest.TestCase):
    def _wav_bytes(self) -> bytes:
        output = io.BytesIO()
        with wave.open(output, "wb") as handle:
            handle.setnchannels(1)
            handle.setsampwidth(2)
            handle.setframerate(service.TARGET_RATE)
            handle.writeframes(np.zeros(service.TARGET_RATE, dtype=np.int16).tobytes())
        return output.getvalue()

    def test_wav_is_decoded_in_memory(self) -> None:
        payload = base64.b64encode(self._wav_bytes()).decode("ascii")
        audio = service.decode_audio(payload)
        self.assertEqual(audio.dtype, np.float32)
        self.assertEqual(audio.size, service.TARGET_RATE)

    def test_invalid_base64_is_a_typed_rejection(self) -> None:
        with self.assertRaises(ValueError) as raised:
            service.decode_audio("not base64")
        self.assertEqual(str(raised.exception), "audio_not_base64")

    def test_empty_payload_is_rejected(self) -> None:
        with self.assertRaises(ValueError) as raised:
            service.decode_audio("")
        self.assertEqual(str(raised.exception), "audio_undecodable")


if __name__ == "__main__":
    unittest.main()
