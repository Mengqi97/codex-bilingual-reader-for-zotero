import { mkdir, rm, stat, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = 18766;
const output = resolve(root, ".runtime", "pdf-smoke-output");
const home = resolve(root, ".runtime", "pdf2zh-home");
const source = resolve(root, "tests", "fixtures", "preserved-layout-sample.pdf");
const node = process.execPath;
const bridge = resolve(root, "scripts", "codex-openai-bridge.mjs");
const engine = resolve(root, ".tools", "pdf2zh-next-staging-2.9.0-babeldoc-0.6.4", "pdf2zh", "pdf2zh.exe");
const codex = process.env.CODEX_BRIDGE_TEST_CODEX || "codex";
const codexHome = process.env.CODEX_BRIDGE_TEST_HOME || "C:\\Users\\mzcai\\.codex";

function run(command, args, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolvePromise({ stdout, stderr }) : reject(new Error(`${command} failed (${code}):\n${stdout}\n${stderr}`)));
  });
}

await mkdir(output, { recursive: true });
await mkdir(home, { recursive: true });
await rm(resolve(output, "preserved-layout-sample_dual.pdf"), { force: true });
const env = {
  ...process.env,
  USERPROFILE: home,
  HOME: home,
  HTTP_PROXY: process.env.HTTP_PROXY || "http://127.0.0.1:7897",
  HTTPS_PROXY: process.env.HTTPS_PROXY || "http://127.0.0.1:7897",
  ALL_PROXY: process.env.ALL_PROXY || "http://127.0.0.1:7897",
  NO_PROXY: "127.0.0.1,localhost",
};
const bridgeChild = spawn(node, [bridge, "--port", String(port), "--codex", codex, "--codex-home", codexHome, "--model", "gpt-5.4-mini", "--reasoning", "low"], { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
bridgeChild.stdout.setEncoding("utf8"); bridgeChild.stderr.setEncoding("utf8");
let bridgeStderr = "";
bridgeChild.stderr.on("data", (chunk) => { bridgeStderr += chunk; });
try {
  const [readyLine] = await once(bridgeChild.stdout, "data");
  const ready = JSON.parse(String(readyLine).trim());
  const engineResult = await run(engine, [
    source, "--output", output, "--lang-in", "en", "--lang-out", "zh-CN",
    "--openaicompatible", "--openai-compatible-base-url", `http://127.0.0.1:${port}/v1`,
    "--openai-compatible-api-key", ready.token, "--openai-compatible-model", "gpt-5.4-mini",
    "--openai-compatible-timeout", "150", "--qps", "1", "--pool-max-workers", "1",
    "--term-qps", "1", "--term-pool-max-workers", "1", "--no-auto-extract-glossary",
    "--translate-table-text", "--enhance-compatibility", "--watermark-output-mode", "no_watermark",
  ], env);
  const outputNames = await readdir(output);
  if (process.env.PDF_SMOKE_DEBUG === "1") console.error(JSON.stringify({ outputNames, engine: engineResult }, null, 2));
  const dualName = outputNames.find((name) => /dual.*\.pdf$/i.test(name))
    || outputNames.find((name) => /\.pdf$/i.test(name));
  if (!dualName) throw new Error(`PDF engine exited without a PDF artifact. Output: ${engineResult.stdout}\n${engineResult.stderr}`);
  const dual = resolve(output, dualName);
  const information = await stat(dual);
  if (information.size < 1024) throw new Error("Generated bilingual PDF is unexpectedly small");
  console.log(JSON.stringify({ source, dualPdf: dual, bytes: information.size }));
} finally {
  bridgeChild.kill();
  await once(bridgeChild, "exit").catch(() => {});
  if (bridgeStderr.trim()) console.error(bridgeStderr.trim());
}
