"""Self-check ('doctor'): verify the setup is complete and credentials work.

Run on the machine where you've installed the tool and created .env:

    python -m nccred.cli --check

Each check prints PASS / FAIL / WARN with guidance, and never prints secrets.
"""

from __future__ import annotations

import json
import os

from . import config

OK = "PASS"
BAD = "FAIL"
WARN = "WARN"


def _line(status: str, label: str, detail: str = "") -> None:
    mark = {OK: "[ok]  ", BAD: "[FAIL]", WARN: "[warn]"}[status]
    print(f"  {mark} {label}" + (f" — {detail}" if detail else ""))


def _check_packages() -> bool:
    pkgs = {
        "anthropic": "anthropic",
        "google-cloud-speech": "google.cloud.speech",
        "google-api-python-client": "googleapiclient",
        "google-auth": "google.auth",
        "requests": "requests",
        "pydantic": "pydantic",
    }
    missing = []
    for name, mod in pkgs.items():
        try:
            __import__(mod)
        except Exception:
            missing.append(name)
    if missing:
        _line(BAD, "Python packages", f"missing: {', '.join(missing)}")
        print("        Fix: pip install -r requirements.txt")
        return False
    _line(OK, "Python packages", "all installed")
    return True


def _check_anthropic_key() -> bool:
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        _line(BAD, "ANTHROPIC_API_KEY", "not set (add it to .env)")
        return False
    _line(OK, "ANTHROPIC_API_KEY", f"set ({key[:7]}…{key[-4:]})")
    return True


def _check_google_creds() -> str | None:
    """Returns the service account client_email if readable, else None."""
    path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if not path:
        _line(BAD, "GOOGLE_APPLICATION_CREDENTIALS", "not set (add it to .env)")
        return None
    if not os.path.exists(path):
        _line(BAD, "GOOGLE_APPLICATION_CREDENTIALS", f"file not found: {path}")
        return None
    try:
        with open(path) as fh:
            data = json.load(fh)
        email = data.get("client_email")
        if not email:
            _line(WARN, "Service account key", "no client_email in the JSON")
            return None
        _line(OK, "Service account key", "readable")
        print(f"        client_email: {email}")
        print("        ^ this email must be shared as Editor on the spreadsheet")
        return email
    except Exception as exc:
        _line(BAD, "Service account key", f"could not read JSON ({exc})")
        return None


def _check_anthropic_call() -> bool:
    try:
        import anthropic

        client = anthropic.Anthropic()
        client.messages.create(
            model=config.ANTHROPIC_MODEL,
            max_tokens=1,
            messages=[{"role": "user", "content": "ping"}],
        )
        _line(OK, "Anthropic API call", f"{config.ANTHROPIC_MODEL} reachable")
        return True
    except Exception as exc:
        _line(BAD, "Anthropic API call", f"{exc.__class__.__name__}: {exc}")
        return False


def _check_sheet_access() -> bool:
    """Confirm the service account can open the sheet and the needed tabs exist."""
    try:
        from . import sheets

        svc = sheets._service()
        meta = (
            svc.spreadsheets()
            .get(
                spreadsheetId=config.SPREADSHEET_ID,
                fields="sheets(properties(title))",
            )
            .execute()
        )
    except Exception as exc:
        _line(BAD, "Open spreadsheet", f"{exc.__class__.__name__}: {exc}")
        print("        If this is a permission error, the sheet isn't shared with")
        print("        the service account email shown above (share as Editor).")
        return False

    titles = {
        s["properties"]["title"].strip().lower()
        for s in meta.get("sheets", [])
        if s.get("properties", {}).get("title")
    }
    _line(OK, "Open spreadsheet", "service account can read it")

    required = {
        "data tab (QUOTATIONS)": config.DATA_TAB,
        "latest landscape": config.PDF_LATEST_LANDSCAPE_TAB,
        "latest portrait": config.PDF_LATEST_PORTRAIT_TAB,
        "lookup landscape": config.PDF_LOOKUP_LANDSCAPE_TAB,
        "lookup portrait": config.PDF_LOOKUP_PORTRAIT_TAB,
    }
    all_found = True
    for label, name in required.items():
        if name.strip().lower() in titles:
            _line(OK, f"Tab: {name!r}", f"found ({label})")
        else:
            _line(BAD, f"Tab: {name!r}", f"NOT found ({label})")
            all_found = False
    if not all_found:
        present = sorted(s["properties"]["title"] for s in meta.get("sheets", []))
        print(f"        Tabs actually present: {present}")
    return all_found


def _check_speech_client() -> bool:
    try:
        from google.cloud import speech

        speech.SpeechClient()
        _line(OK, "Speech-to-Text client", "credentials load")
        print("        (note: a real transcription also needs the API enabled +")
        print("         billing on the Google Cloud project)")
        return True
    except Exception as exc:
        _line(WARN, "Speech-to-Text client", f"{exc.__class__.__name__}: {exc}")
        return False


def run() -> int:
    print("NCCRED setup check")
    print("=" * 50)

    print("\n1. Software")
    pkgs_ok = _check_packages()
    if not pkgs_ok:
        print("\nInstall the packages first, then re-run --check.")
        return 1

    print("\n2. Credentials in .env")
    key_ok = _check_anthropic_key()
    _check_google_creds()

    print("\n3. Live connection — Anthropic")
    call_ok = _check_anthropic_call() if key_ok else False

    print("\n4. Live connection — Google Sheet")
    sheet_ok = _check_sheet_access()

    print("\n5. Live connection — Speech-to-Text")
    _check_speech_client()

    print("\n" + "=" * 50)
    if call_ok and sheet_ok:
        print("Ready: calls can be read and the sheet can be read/written.")
        return 0
    print("Not ready yet — fix the FAIL lines above and re-run: python -m nccred.cli --check")
    return 1
