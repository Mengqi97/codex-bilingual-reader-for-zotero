import asyncio
import importlib.util
import json
import os
import re
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "codex-batch-broker.py"
SPEC = importlib.util.spec_from_file_location("codex_batch_broker", SCRIPT)
broker_module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(broker_module)


class BatchBrokerTests(unittest.IsolatedAsyncioTestCase):
    def test_openai_and_deepseek_compatible_api_requests(self):
        requests = []

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))).decode("utf-8"))
                requests.append({"path": self.path, "authorization": self.headers.get("Authorization"), "body": body})
                payload = json.dumps({
                    "choices": [{"message": {"content": "API 测试译文"}}],
                    "usage": {"prompt_tokens": 120, "completion_tokens": 30},
                }, ensure_ascii=False).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, _format, *_args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        names = ("CODEX_PDF_BACKEND", "CODEX_PDF_API_BASE_URL", "CODEX_PDF_API_MODEL", "CODEX_PDF_API_KEY")
        previous = {name: os.environ.get(name) for name in names}
        try:
            os.environ["CODEX_PDF_BACKEND"] = "api"
            os.environ["CODEX_PDF_API_KEY"] = "local-test-key"
            for provider, suffix, expected_path in (
                ("openai", "/v1", "/v1/chat/completions"),
                ("deepseek", "", "/chat/completions"),
            ):
                os.environ["CODEX_PDF_API_BASE_URL"] = f"http://127.0.0.1:{server.server_port}{suffix}"
                os.environ["CODEX_PDF_API_MODEL"] = f"{provider}-test-model"
                self.assertEqual(broker_module.run_translation("Translate this."), "API 测试译文")
                text, usage = broker_module.run_translation_result("Translate this.")
                self.assertEqual(text, "API 测试译文")
                self.assertEqual(usage, {"inputTokens": 120, "outputTokens": 30})
                request = requests[-1]
                self.assertEqual(request["path"], expected_path)
                self.assertEqual(request["authorization"], "Bearer local-test-key")
                self.assertEqual(request["body"]["model"], f"{provider}-test-model")
                self.assertEqual(request["body"]["messages"][0]["content"], "Translate this.")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
            for name, value in previous.items():
                if value is None:
                    os.environ.pop(name, None)
                else:
                    os.environ[name] = value

    def test_default_batch_limits_use_more_model_context(self):
        names = ("CODEX_PDF_BATCH_MAX_FRAGMENTS", "CODEX_PDF_BATCH_MAX_CHARS")
        previous = {name: os.environ.pop(name, None) for name in names}
        try:
            broker = broker_module.Broker()
            self.assertEqual(broker.max_fragments, 32)
            self.assertEqual(broker.max_chars, 24000)
        finally:
            for name, value in previous.items():
                if value is not None:
                    os.environ[name] = value

    async def test_dispatcher_accumulates_queue_while_codex_slot_is_busy(self):
        previous = {name: os.environ.get(name) for name in (
            "CODEX_PDF_BATCH_WAIT_MS", "CODEX_PDF_BATCH_MAX_FRAGMENTS",
            "CODEX_PDF_BATCH_MAX_CHARS", "CODEX_PDF_BATCH_CONCURRENCY",
        )}
        os.environ["CODEX_PDF_BATCH_WAIT_MS"] = "40"
        os.environ["CODEX_PDF_BATCH_MAX_FRAGMENTS"] = "16"
        os.environ["CODEX_PDF_BATCH_MAX_CHARS"] = "6000"
        os.environ["CODEX_PDF_BATCH_CONCURRENCY"] = "1"
        broker = broker_module.Broker()
        loop = asyncio.get_running_loop()
        first_started = asyncio.Event()
        release_first = asyncio.Event()
        second_started = asyncio.Event()
        batches = []

        async def fake_translate(batch, chars, *, slot_reserved=False):
            batches.append((len(batch), chars))
            if len(batches) == 1:
                first_started.set()
                await release_first.wait()
            if slot_reserved:
                broker.codex_slots.release()
            if len(batches) == 2:
                second_started.set()

        broker.translate = fake_translate
        dispatcher = asyncio.create_task(broker.dispatcher())
        try:
            await broker.queue.put({"source": "first"})
            await asyncio.wait_for(first_started.wait(), 1)
            for index in range(8):
                await broker.queue.put({"source": f"queued-{index}"})
                await asyncio.sleep(0.05)
            self.assertEqual(batches, [(1, 5)], "busy slots must not pre-partition the waiting queue")
            release_first.set()
            await asyncio.wait_for(second_started.wait(), 1)
            self.assertEqual(batches[1][0], 8, "the next free slot should consume the accumulated queue")
        finally:
            dispatcher.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await dispatcher
            for name, value in previous.items():
                if value is None:
                    os.environ.pop(name, None)
                else:
                    os.environ[name] = value

    async def test_partial_batch_retries_only_missing_fragment(self):
        test_root = Path(__file__).parents[1] / "tmp" / "tests"
        test_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=test_root) as temporary:
            checkpoint = Path(temporary) / "checkpoint.jsonl"
            progress = Path(temporary) / "progress.jsonl"
            previous = {name: os.environ.get(name) for name in (
                "CODEX_PDF_CHECKPOINT_FILE", "CODEX_PDF_PROGRESS_FILE", "CODEX_PDF_TASK_ID",
            )}
            os.environ["CODEX_PDF_CHECKPOINT_FILE"] = str(checkpoint)
            os.environ["CODEX_PDF_PROGRESS_FILE"] = str(progress)
            os.environ["CODEX_PDF_TASK_ID"] = "test-task"
            calls = []

            def fake_codex(prompt):
                calls.append(prompt)
                markers = re.findall(r"CBR_BEGIN_([a-z0-9]+)", prompt)
                if markers:
                    marker = markers[0]
                    return f"[[[CBR_RESULT_{marker}]]]\n批量结果\n[[[CBR_END_{marker}]]]"
                return "单段重试结果"

            original = broker_module.run_codex
            broker_module.run_codex = fake_codex
            try:
                broker = broker_module.Broker()
                loop = asyncio.get_running_loop()
                batch = [
                    {"id": "a1", "marker": "a1", "source": "First", "sourceHash": "hash-a", "receivedAt": time.monotonic(), "future": loop.create_future()},
                    {"id": "b2", "marker": "b2", "source": "Second", "sourceHash": "hash-b", "receivedAt": time.monotonic(), "future": loop.create_future()},
                ]
                await broker.translate(batch, 11)
                self.assertEqual(len(calls), 2, "one batch plus only the missing fragment")
                self.assertEqual(batch[0]["future"].result()["translation"], "批量结果")
                self.assertFalse(batch[0]["future"].result()["fallback"])
                self.assertEqual(batch[1]["future"].result()["translation"], "单段重试结果")
                self.assertTrue(batch[1]["future"].result()["fallback"])
                self.assertEqual(len(checkpoint.read_text(encoding="utf-8").splitlines()), 2)
                records = [json.loads(row) for row in progress.read_text(encoding="utf-8").splitlines()]
                self.assertEqual(sum(record.get("kind") == "fragment" for record in records), 2)
                self.assertTrue(any(record.get("stage") == "batch_partial_fallback" for record in records))
            finally:
                broker_module.run_codex = original
                for name, value in previous.items():
                    if value is None:
                        os.environ.pop(name, None)
                    else:
                        os.environ[name] = value

    async def test_actual_api_usage_is_recorded_once_per_call(self):
        test_root = Path(__file__).parents[1] / "tmp" / "tests"
        test_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=test_root) as temporary:
            progress = Path(temporary) / "progress.jsonl"
            previous = {name: os.environ.get(name) for name in (
                "CODEX_PDF_PROGRESS_FILE", "CODEX_PDF_TASK_ID",
            )}
            os.environ["CODEX_PDF_PROGRESS_FILE"] = str(progress)
            os.environ["CODEX_PDF_TASK_ID"] = "usage-test"
            original = broker_module.run_translation_result
            broker_module.run_translation_result = lambda _prompt: (
                "实际译文", {"inputTokens": 321, "outputTokens": 123},
            )
            try:
                broker = broker_module.Broker()
                loop = asyncio.get_running_loop()
                item = {
                    "id": "usage1", "marker": "usage1", "source": "Source",
                    "sourceHash": "usage-hash", "receivedAt": time.monotonic(),
                    "future": loop.create_future(),
                }
                await broker.translate([item], len(item["source"]))
                records = [json.loads(row) for row in progress.read_text(encoding="utf-8").splitlines()]
                usage = [row for row in records if row.get("stage") == "usage_actual"]
                self.assertEqual(len(usage), 1)
                self.assertEqual(usage[0]["inputTokens"], 321)
                self.assertEqual(usage[0]["outputTokens"], 123)
            finally:
                broker_module.run_translation_result = original
                for name, value in previous.items():
                    if value is None:
                        os.environ.pop(name, None)
                    else:
                        os.environ[name] = value

    @unittest.skipUnless(os.environ.get("CODEX_REAL_BATCH_SMOKE") == "1", "manual real Codex smoke")
    async def test_real_codex_keeps_thirty_two_markers_in_one_call(self):
        test_root = Path(__file__).parents[1] / "tmp" / "tests"
        test_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=test_root) as temporary:
            os.environ["CODEX_PDF_CHECKPOINT_FILE"] = str(Path(temporary) / "checkpoint.jsonl")
            os.environ["CODEX_PDF_PROGRESS_FILE"] = str(Path(temporary) / "progress.jsonl")
            os.environ["CODEX_PDF_TASK_ID"] = "real-smoke"
            broker = broker_module.Broker()
            loop = asyncio.get_running_loop()
            batch = [
                {"id": f"m{index}", "marker": f"m{index}", "source": f"Scientific test fragment number {index}.", "sourceHash": f"hash-{index}", "receivedAt": time.monotonic(), "future": loop.create_future()}
                for index in range(32)
            ]
            await broker.translate(batch, sum(len(item["source"]) for item in batch))
            self.assertEqual(broker.codex_calls, 1)
            self.assertTrue(all(item["future"].result()["fallback"] is False for item in batch))


if __name__ == "__main__":
    unittest.main()
