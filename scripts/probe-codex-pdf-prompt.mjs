import { once } from "node:events";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bridge = resolve(root, "scripts", "codex-openai-bridge.mjs");
const port = 18768;
const child = spawn(process.execPath, [bridge, "--port", String(port), "--codex", process.env.CODEX_BRIDGE_TEST_CODEX || "codex", "--codex-home", process.env.CODEX_BRIDGE_TEST_HOME || "C:\\Users\\mzcai\\.codex", "--model", process.env.CODEX_PDF_MODEL || "gpt-5.4-mini", "--reasoning", "low", "--timeout-ms", "60000"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += chunk; });
try {
  const [line] = await once(child.stdout, "data");
  const ready = JSON.parse(String(line).trim());
  const started = Date.now();
  const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ready.token}` },
    body: JSON.stringify({
      model: process.env.CODEX_PDF_MODEL || "gpt-5.4-mini",
      messages: [
        { role: "user", content: "You are a professional,authentic machine translation engine.\n\n;; Treat next line as plain text input and translate it into zh-CN, output translation ONLY. If translation is unnecessary (e.g. proper nouns, codes, {{1}}, etc. ), return the original text. NO explanations. NO notes. Input:\n\nActWorld: FromExplorabletoInteractiveWorldModel via Action-Aware Memory" },
      ],
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  console.log(JSON.stringify({ elapsedMs: Date.now() - started, output: result.choices?.[0]?.message?.content }));
} finally {
  child.kill();
  await once(child, "exit").catch(() => {});
  if (stderr) console.error(stderr);
}
