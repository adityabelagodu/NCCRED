"""Turn a call recording into a text transcript with Google Speech-to-Text.

Calls are a Kannada / Hindi / English mix, so we hand Google a primary language
plus alternates and let it pick per utterance.

Auth: set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON key that has
the Cloud Speech-to-Text API enabled. See the README.

Two entry points:
  * transcribe_file(path)  - a local audio file (uses inline bytes; for short
                             clips up to ~1 min / 10 MB).
  * transcribe_gcs(uri)    - a gs:// URI (uses long-running recognize; required
                             for longer calls). Upload longer recordings to a
                             Cloud Storage bucket first.
"""

from __future__ import annotations

from pathlib import Path

from . import config


def _recognition_config():
    from google.cloud import speech

    return speech.RecognitionConfig(
        encoding=speech.RecognitionConfig.AudioEncoding.ENCODING_UNSPECIFIED,
        language_code=config.STT_PRIMARY_LANGUAGE,
        alternative_language_codes=config.STT_ALTERNATE_LANGUAGES,
        enable_automatic_punctuation=True,
        model="default",
    )


def _join_results(response) -> str:
    parts = [
        result.alternatives[0].transcript
        for result in response.results
        if result.alternatives
    ]
    return "\n".join(p.strip() for p in parts if p.strip())


def transcribe_file(path: str | Path) -> str:
    """Transcribe a short local audio file (<= ~1 minute)."""
    from google.cloud import speech

    path = Path(path)
    client = speech.SpeechClient()
    audio = speech.RecognitionAudio(content=path.read_bytes())
    response = client.recognize(config=_recognition_config(), audio=audio)
    return _join_results(response)


def transcribe_gcs(gcs_uri: str, timeout: int = 600) -> str:
    """Transcribe a longer recording stored at a gs:// URI."""
    from google.cloud import speech

    client = speech.SpeechClient()
    audio = speech.RecognitionAudio(uri=gcs_uri)
    operation = client.long_running_recognize(
        config=_recognition_config(), audio=audio
    )
    response = operation.result(timeout=timeout)
    return _join_results(response)


def transcribe(source: str) -> str:
    """Dispatch on the source: gs:// URI vs local path."""
    if str(source).startswith("gs://"):
        return transcribe_gcs(source)
    return transcribe_file(source)
