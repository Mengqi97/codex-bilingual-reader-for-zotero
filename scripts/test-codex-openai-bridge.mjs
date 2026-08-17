import { once } from "node:events";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bridge = resolve(root, "scripts", "codex-openai-bridge.mjs");
const port = 18765;
const codex = process.env.CODEX_BRIDGE_TEST_CODEX || "codex";
const child = spawn(process.execPath, [bridge, "--port", String(port), "--codex", codex, "--model", "gpt-5.4-mini", "--reasoning", "low"], {
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += chunk; });

try {
  const readyLine = await Promise.race([
    once(child.stdout, "data").then(([line]) => String(line)),
    once(child, "exit").then(([code, signal]) => {
      throw new Error(`Bridge exited before ready (${code ?? "unknown"}, ${signal || "no signal"}): ${stderr.trim()}`);
    }),
  ]);
  const line = readyLine;
  const ready = JSON.parse(String(line).trim());
  const health = await fetch(ready.health).then((response) => response.json());
  if (health.status !== "ok" || health.loopbackOnly !== true) throw new Error("Bridge health response is invalid");
  const completion = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ready.token}` },
    body: JSON.stringify({
      model: "gpt-5.4-mini",
      messages: [{ role: "user", content: "Translate to Simplified Chinese. Return only the translation: The formula $E=mc^2$ is unchanged." }],
    }),
  });
  const result = await completion.json();
  if (!completion.ok || !result.choices?.[0]?.message?.content) throw new Error(JSON.stringify(result));
  console.log(JSON.stringify({ health, completion: result.choices[0].message.content }));
} finally {
  child.kill();
  await once(child, "exit").catch(() => {});
  if (stderr.trim()) console.error(stderr.trim());
}
