#!/usr/bin/env python3
"""Invisible stdin/stdout bridge from BabelDOC fragments to local Codex."""
from __future__ import annotations

import hashlib
import json
import os
import socket
import sys
import uuid
from pathlib import Path

def is_fatal(message: str) -> bool:
    lowered = message.lower()
    return any(token in lowered for token in ("usage limit", "quota exceeded", "insufficient quota", "not logged in", "authentication failed", "authentication required"))


def write_stdout(value: str) -> None:
    payload = value.encode("utf-8")
    binary = getattr(sys.stdout, "buffer", None)
    if binary is not None:
        binary.write(payload)
        binary.flush()
    else:
        sys.stdout.write(value)


def request_broker(source: str, digest: str) -> dict:
    """Submit one BabelDOC fragment to the local, short-lived batch broker."""
    port = int(os.environ.get("CODEX_PDF_BROKER_PORT", "0"))
    if not port:
        raise RuntimeError("Codex batch broker is not available")
    payload = json.dumps({"id": uuid.uuid4().hex, "source": source, "sourceHash": digest}, ensure_ascii=False).encode("utf-8") + b"\n"
    timeout = int(os.environ.get("CODEX_PDF_CLI_TIMEOUT_SECONDS", "360")) + 60
    with socket.create_connection(("127.0.0.1", port), timeout=15) as connection:
        connection.settimeout(timeout)
        connection.sendall(payload)
        chunks: list[bytes] = []
        while True:
            chunk = connection.recv(65536)
            if not chunk:
                break
            chunks.append(chunk)
            if b"\n" in chunk:
                break
    response = json.loads(b"".join(chunks).decode("utf-8").split("\n", 1)[0])
    if not response.get("ok"):
        raise RuntimeError(str(response.get("error") or "Codex batch broker failed"))
    if not str(response.get("translation", "")).strip():
        raise RuntimeError("Codex batch broker returned an empty translation")
    return response


def main() -> int:
    source = sys.stdin.read()
    if source.strip() == "Hello":
        write_stdout("你好")
        return 0

    digest = hashlib.sha256(source.encode("utf-8")).hexdigest()
    response = request_broker(source, digest)
    answer = str(response["translation"]).strip()
    write_stdout(answer)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        message = str(error)
        fatal_path = os.environ.get("CODEX_PDF_FATAL_FILE", "")
        if fatal_path and is_fatal(message):
            try:
                Path(fatal_path).write_text(json.dumps({"taskID": os.environ.get("CODEX_PDF_TASK_ID", ""), "kind": "codex-unavailable", "message": message}, ensure_ascii=False), encoding="utf-8")
            except OSError:
                pass
        sys.stderr.write(message)
        raise
