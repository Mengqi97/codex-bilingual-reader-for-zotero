#!/usr/bin/env python3
"""Loopback-only batching broker for BabelDOC CLITranslator fragments."""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import re
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path


def append_jsonl(path_text: str, record: dict) -> None:
    if not path_text:
        return
    with Path(path_text).open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(record, ensure_ascii=False) + "\n")


def load_cache(path_text: str) -> dict[str, str]:
    cache: dict[str, str] = {}
    if not path_text:
        return cache
    try:
        for row in Path(path_text).read_text(encoding="utf-8").splitlines():
            entry = json.loads(row)
            digest = str(entry.get("sourceHash", ""))
            translation = str(entry.get("translation", "")).strip()
            if digest and translation:
                cache[digest] = translation
    except (OSError, ValueError, json.JSONDecodeError):
        pass
    return cache


def resolve_codex() -> tuple[str, dict[str, str]]:
    configured = os.environ.get("CODEX_PDF_CODEX", "codex")
    command = Path(configured)
    if command.suffix.lower() in {".cmd", ".bat"}:
        vendor = command.parent / "node_modules" / "@openai" / "codex" / "node_modules" / "@openai" / "codex-win32-x64" / "vendor" / "x86_64-pc-windows-msvc"
        native = vendor / "codex" / "codex.exe"
        if native.exists():
            return str(native), {"CODEX_MANAGED_BY_NPM": "1", "PATH": f"{vendor / 'path'};{os.environ.get('PATH', '')}"}
    return configured, {}


def is_fatal(message: str) -> bool:
    words = ("usage limit", "quota exceeded", "insufficient quota", "not logged in", "authentication failed", "authentication required")
    return any(word in message.lower() for word in words)


def write_fatal(message: str) -> None:
    path = os.environ.get("CODEX_PDF_FATAL_FILE", "")
    if path and is_fatal(message):
        Path(path).write_text(json.dumps({"taskID": os.environ.get("CODEX_PDF_TASK_ID", ""), "kind": "codex-unavailable", "message": message}, ensure_ascii=False), encoding="utf-8")


def one_prompt(source: str) -> str:
    return "\n\n".join((
        "You are a professional scientific-paper translation engine.",
        "Translate the input from English to Simplified Chinese. Return only the translation - no explanation, heading, code fence, or commentary.",
        "Preserve every formula placeholder exactly, including {vN}; preserve every rich-text marker exactly, including <style id='N'> and </style>; preserve citations, identifiers, URLs, numbers, and punctuation when they should remain unchanged.",
        "Input follows:", source,
    ))


def batch_prompt(batch: list[dict]) -> str:
    blocks = [f"[[[CBR_BEGIN_{item['marker']}]]]\n{item['source']}\n[[[CBR_SOURCE_END_{item['marker']}]]]" for item in batch]
    return "\n\n".join((
        "You are a professional scientific-paper translation engine.",
        "Translate every English fragment below to Simplified Chinese.",
        "Return exactly one result block for every input fragment and no other text.",
        "Required form: [[[CBR_RESULT_<marker>]]] then the translation, then [[[CBR_END_<marker>]]].",
        "Copy each marker byte-for-byte. Do not merge, omit, reorder, or translate markers.",
        "Preserve every formula placeholder exactly, including {vN}; preserve every rich-text marker exactly, including <style id='N'> and </style>; preserve citations, identifiers, URLs, numbers, and punctuation when they should remain unchanged.",
        "Input fragments follow:", *blocks,
    ))


def run_codex(prompt: str) -> str:
    if os.environ.get("CODEX_PDF_TRANSLATION_DRY_RUN", "").lower() == "true":
        markers = re.findall(r"\[\[\[CBR_BEGIN_([a-z0-9]+)\]\]\]", prompt, re.IGNORECASE)
        if markers:
            return "\n".join(f"[[[CBR_RESULT_{marker}]]]\n测试译文\n[[[CBR_END_{marker}]]]" for marker in markers)
        return "测试译文"
    command, additions = resolve_codex()
    env = {**os.environ, **additions, "CODEX_HOME": os.environ.get("CODEX_PDF_CODEX_HOME", os.path.expanduser("~/.codex")), "NO_PROXY": "127.0.0.1,localhost"}
    args = [command, "exec", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check", "-c", f'model_reasoning_effort="{os.environ.get("CODEX_PDF_REASONING", "low")}"']
    if model := os.environ.get("CODEX_PDF_MODEL", "").strip():
        args[1:1] = ["-m", model]
    with tempfile.TemporaryDirectory(prefix="codex-pdf-") as temporary:
        destination = str(Path(temporary) / "answer.txt")
        result = subprocess.run([*args, "--output-last-message", destination, "-"], input=prompt, text=True, encoding="utf-8", capture_output=True, timeout=int(os.environ.get("CODEX_PDF_CLI_TIMEOUT_SECONDS", "360")), env=env, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if result.returncode:
            raise RuntimeError(f"Codex CLI failed ({result.returncode}): {result.stderr[-1000:]}")
        answer = Path(destination).read_text(encoding="utf-8").strip()
    if not answer:
        raise RuntimeError("Codex CLI returned an empty translation")
    return answer


def api_endpoint(base_url: str) -> str:
    normalized = base_url.strip().rstrip("/")
    if not normalized:
        raise RuntimeError("OpenAI-compatible API Base URL is not configured")
    return normalized if normalized.endswith("/chat/completions") else f"{normalized}/chat/completions"


def normalize_api_usage(result: dict) -> dict[str, int] | None:
    usage = result.get("usage") or {}
    input_tokens = usage.get("prompt_tokens", usage.get("input_tokens"))
    output_tokens = usage.get("completion_tokens", usage.get("output_tokens"))
    if not isinstance(input_tokens, (int, float)) or not isinstance(output_tokens, (int, float)):
        return None
    return {"inputTokens": max(0, int(input_tokens)), "outputTokens": max(0, int(output_tokens))}


def run_openai_compatible_api_result(prompt: str) -> tuple[str, dict[str, int] | None]:
    model = os.environ.get("CODEX_PDF_API_MODEL", "").strip()
    if not model:
        raise RuntimeError("OpenAI-compatible API model is not configured")
    payload = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
    }, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json", "User-Agent": "Codex-Bilingual-Reader/1"}
    api_key = os.environ.get("CODEX_PDF_API_KEY", "").strip()
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    request = urllib.request.Request(
        api_endpoint(os.environ.get("CODEX_PDF_API_BASE_URL", "")),
        data=payload,
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=int(os.environ.get("CODEX_PDF_CLI_TIMEOUT_SECONDS", "360"))) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read(1000).decode("utf-8", errors="replace").strip().replace("\n", " ")
        raise RuntimeError(f"OpenAI-compatible API failed (HTTP {error.code}){f': {detail}' if detail else ''}") from error
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        raise RuntimeError(f"OpenAI-compatible API request failed: {error}") from error
    content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
    if isinstance(content, list):
        content = "".join(str(part.get("text", "")) for part in content if isinstance(part, dict))
    answer = str(content).strip()
    if not answer:
        raise RuntimeError("OpenAI-compatible API returned an empty translation")
    return answer, normalize_api_usage(result)


def run_openai_compatible_api(prompt: str) -> str:
    return run_openai_compatible_api_result(prompt)[0]


def run_translation_result(prompt: str) -> tuple[str, dict[str, int] | None]:
    if os.environ.get("CODEX_PDF_TRANSLATION_DRY_RUN", "").lower() == "true":
        return run_codex(prompt), None
    if os.environ.get("CODEX_PDF_BACKEND", "cli").lower() == "api":
        return run_openai_compatible_api_result(prompt)
    return run_codex(prompt), None


def run_translation(prompt: str) -> str:
    return run_translation_result(prompt)[0]


def parse_batch_partial(answer: str, batch: list[dict]) -> tuple[dict[str, str], list[dict]]:
    translated: dict[str, str] = {}
    missing: list[dict] = []
    for item in batch:
        marker = re.escape(item["marker"])
        found = re.findall(rf"\[\[\[\s*CBR_RESULT_{marker}\s*\]\]\]\s*(.*?)\s*\[\[\[\s*CBR_END_{marker}\s*\]\]\]", answer, re.DOTALL | re.IGNORECASE)
        if len(found) == 1 and found[0].strip():
            translated[item["id"]] = found[0].strip()
        else:
            missing.append(item)
    return translated, missing


class Broker:
    def __init__(self) -> None:
        self.queue: asyncio.Queue[dict] = asyncio.Queue()
        self.wait_seconds = max(0, int(os.environ.get("CODEX_PDF_BATCH_WAIT_MS", "3000"))) / 1000
        self.max_fragments = max(1, int(os.environ.get("CODEX_PDF_BATCH_MAX_FRAGMENTS", "32")))
        self.max_chars = max(1, int(os.environ.get("CODEX_PDF_BATCH_MAX_CHARS", "24000")))
        self.codex_slots = asyncio.Semaphore(max(1, int(os.environ.get("CODEX_PDF_BATCH_CONCURRENCY", "2"))))
        self.checkpoint_path = os.environ.get("CODEX_PDF_CHECKPOINT_FILE", "")
        self.progress_path = os.environ.get("CODEX_PDF_PROGRESS_FILE", "")
        self.task_id = os.environ.get("CODEX_PDF_TASK_ID", "")
        self.cache = load_cache(self.checkpoint_path)
        self.codex_calls = 0
        self.active: set[asyncio.Task] = set()

    def event(self, stage: str, **values: object) -> None:
        append_jsonl(self.progress_path, {"kind": "batch_event", "taskID": self.task_id, "stage": stage, "at": time.time(), **values})

    async def call_codex(self, prompt: str, *, slot_reserved: bool = False) -> tuple[int, str, dict[str, int] | None]:
        if not slot_reserved:
            await self.codex_slots.acquire()
        try:
            self.codex_calls += 1
            call_index = self.codex_calls
            answer, usage = await asyncio.to_thread(run_translation_result, prompt)
            return call_index, answer, usage
        finally:
            self.codex_slots.release()

    def complete(self, item: dict, translation: str, *, cached: bool, batch_id: str, batch_count: int, batch_chars: int, batch_elapsed_ms: int, call_index: int, fallback: bool = False) -> None:
        digest = item["sourceHash"]
        if not cached:
            self.cache[digest] = translation
            append_jsonl(self.checkpoint_path, {"sourceHash": digest, "translation": translation})
        append_jsonl(self.progress_path, {
            "kind": "fragment", "taskID": self.task_id, "sourceHash": digest,
            "inputChars": len(item["source"]), "outputChars": len(translation),
            "cached": cached, "elapsedMs": round((time.monotonic() - item["receivedAt"]) * 1000),
            "batchId": batch_id, "batchFragmentCount": batch_count,
            "batchInputChars": batch_chars, "batchElapsedMs": batch_elapsed_ms,
            "codexCallIndex": call_index, "fallback": fallback,
        })
        if not item["future"].done():
            item["future"].set_result({
                "ok": True, "translation": translation, "batchId": batch_id,
                "batchFragmentCount": batch_count, "batchInputChars": batch_chars,
                "batchElapsedMs": batch_elapsed_ms, "codexCallIndex": call_index,
                "fallback": fallback,
            })

    def record_usage(self, usage: dict[str, int] | None, call_index: int) -> None:
        if not usage:
            return
        self.event("usage_actual", callIndex=call_index, **usage)

    async def handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            item = json.loads((await asyncio.wait_for(reader.readline(), 15)).decode("utf-8"))
            item["source"] = str(item.get("source", ""))
            if not item["source"].strip():
                raise ValueError("empty source")
            item["id"] = str(item.get("id") or uuid.uuid4().hex)
            item["marker"] = item["id"].replace("-", "")
            item["sourceHash"] = str(item.get("sourceHash") or hashlib.sha256(item["source"].encode("utf-8")).hexdigest())
            item["receivedAt"] = time.monotonic()
            item["future"] = asyncio.get_running_loop().create_future()
            cached = self.cache.get(item["sourceHash"], "")
            if cached:
                self.complete(item, cached, cached=True, batch_id="cache", batch_count=1, batch_chars=len(item["source"]), batch_elapsed_ms=0, call_index=self.codex_calls)
            else:
                await self.queue.put(item)
            response = await item["future"]
        except Exception as error:
            response = {"ok": False, "error": str(error)}
        writer.write((json.dumps(response, ensure_ascii=False) + "\n").encode("utf-8"))
        await writer.drain()
        writer.close()
        await writer.wait_closed()

    async def dispatcher(self) -> None:
        while True:
            slot_reserved = False
            try:
                # Do not freeze incoming fragments into tiny batches while all
                # Codex calls are busy. Leaving them in the shared queue lets
                # the next available slot consume one large batch instead.
                await self.codex_slots.acquire()
                slot_reserved = True
                batch = [await self.queue.get()]
                chars = len(batch[0]["source"])
                deadline = time.monotonic() + self.wait_seconds
                while len(batch) < self.max_fragments and chars < self.max_chars:
                    try:
                        item = await asyncio.wait_for(self.queue.get(), max(0, deadline - time.monotonic()))
                    except asyncio.TimeoutError:
                        break
                    if chars + len(item["source"]) > self.max_chars:
                        await self.queue.put(item)
                        break
                    batch.append(item)
                    chars += len(item["source"])
                task = asyncio.create_task(self.translate(batch, chars, slot_reserved=True))
                slot_reserved = False
                self.active.add(task)
                task.add_done_callback(self.active.discard)
            finally:
                if slot_reserved:
                    self.codex_slots.release()

    async def retry_one(self, item: dict, original_batch_id: str) -> None:
        started = time.monotonic()
        try:
            call_index, translation, usage = await self.call_codex(one_prompt(item["source"]))
            self.record_usage(usage, call_index)
            elapsed = round((time.monotonic() - started) * 1000)
            self.complete(item, translation, cached=False, batch_id=f"{original_batch_id}-retry", batch_count=1, batch_chars=len(item["source"]), batch_elapsed_ms=elapsed, call_index=call_index, fallback=True)
        except Exception as error:
            message = str(error)
            write_fatal(message)
            if not item["future"].done():
                item["future"].set_result({"ok": False, "error": message})

    async def translate(self, batch: list[dict], chars: int, *, slot_reserved: bool = False) -> None:
        batch_id, started = uuid.uuid4().hex[:12], time.monotonic()
        self.event("batch_started", batchId=batch_id, batchFragmentCount=len(batch), batchInputChars=chars, codexCalls=self.codex_calls)
        translated: dict[str, str] = {}
        missing = batch
        call_index = self.codex_calls
        batch_error = ""
        try:
            call_index, answer, usage = await self.call_codex(
                one_prompt(batch[0]["source"]) if len(batch) == 1 else batch_prompt(batch),
                slot_reserved=slot_reserved,
            )
            self.record_usage(usage, call_index)
            if len(batch) == 1:
                translated, missing = {batch[0]["id"]: answer}, []
            else:
                translated, missing = parse_batch_partial(answer, batch)
        except Exception as error:
            batch_error = str(error)
            if is_fatal(batch_error):
                write_fatal(batch_error)
                for item in batch:
                    item["future"].set_result({"ok": False, "error": batch_error})
                return
        elapsed = round((time.monotonic() - started) * 1000)
        for item in batch:
            if item["id"] in translated:
                self.complete(item, translated[item["id"]], cached=False, batch_id=batch_id, batch_count=len(batch), batch_chars=chars, batch_elapsed_ms=elapsed, call_index=call_index)
        if missing:
            self.event("batch_partial_fallback", batchId=batch_id, batchFragmentCount=len(batch), batchInputChars=chars, completedFragments=len(translated), missingFragments=len(missing), error=batch_error)
            await asyncio.gather(*(self.retry_one(item, batch_id) for item in missing))
        self.event("batch_completed", batchId=batch_id, batchFragmentCount=len(batch), batchInputChars=chars, completedFragments=len(batch), fallbackFragments=len(missing), codexCalls=self.codex_calls, elapsedMs=round((time.monotonic() - started) * 1000))


async def run(ready_file: Path) -> None:
    broker = Broker()
    server = await asyncio.start_server(broker.handle, "127.0.0.1", 0)
    ready_file.write_text(json.dumps({"port": server.sockets[0].getsockname()[1]}), encoding="utf-8")
    dispatcher = asyncio.create_task(broker.dispatcher())
    try:
        async with server:
            await server.serve_forever()
    finally:
        dispatcher.cancel()
        for task in broker.active:
            task.cancel()
        ready_file.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ready-file", required=True)
    args = parser.parse_args()
    asyncio.run(run(Path(args.ready_file)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
