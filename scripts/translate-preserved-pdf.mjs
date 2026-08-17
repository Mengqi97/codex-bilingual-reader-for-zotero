import { mkdir, readdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { basename, dirname, parse, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = process.argv[2];
const requestedOutput = process.argv[3];
if (!source || !requestedOutput) {
  throw new Error("Usage: node scripts/translate-preserved-pdf.mjs <input.pdf> <output-directory>");
}

const output = resolve(requestedOutput);
const home = resolve(root, ".runtime", "pdf2zh-home");
const bridge = resolve(root, "scripts", "codex-openai-bridge.mjs");
const engine = resolve(root, ".tools", "pdf2zh-next-staging-2.9.0-babeldoc-0.6.4", "pdf2zh", "pdf2zh.exe");
const port = Number(process.env.CODEX_PDF_BRIDGE_PORT || 18767);
const codex = process.env.CODEX_PDF_CODEX || process.env.CODEX_BRIDGE_TEST_CODEX || "codex";
const codexHome = process.env.CODEX_PDF_CODEX_HOME || process.env.CODEX_BRIDGE_TEST_HOME || "C:\\Users\\mzcai\\.codex";
const model = process.env.CODEX_PDF_MODEL || "gpt-5.4-mini";
const reasoning = process.env.CODEX_PDF_REASONING || "low";
const bridgeTimeoutMs = Number(process.env.CODEX_PDF_BRIDGE_TIMEOUT_MS || 60000);

function run(command, args, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; process.stdout.write(chunk); });
    child.stderr.on("data", (chunk) => { stderr += chunk; process.stderr.write(chunk); });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolvePromise({ stdout, stderr }) : reject(new Error(`${command} failed (${code}):\n${stdout}\n${stderr}`)));
  });
}

await mkdir(output, { recursive: true });
await mkdir(home, { recursive: true });
const env = {
  ...process.env,
  USERPROFILE: home,
  HOME: home,
  HTTP_PROXY: process.env.HTTP_PROXY || "http://127.0.0.1:7897",
  HTTPS_PROXY: process.env.HTTPS_PROXY || "http://127.0.0.1:7897",
  ALL_PROXY: process.env.ALL_PROXY || "http://127.0.0.1:7897",
  NO_PROXY: "127.0.0.1,localhost",
};
const bridgeChild = spawn(process.execPath, [
  bridge, "--port", String(port), "--codex", codex, "--codex-home", codexHome,
  "--model", model, "--reasoning", reasoning, "--timeout-ms", String(bridgeTimeoutMs),
], { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
bridgeChild.stdout.setEncoding("utf8"); bridgeChild.stderr.setEncoding("utf8");
bridgeChild.stderr.on("data", (chunk) => process.stderr.write(chunk));
try {
  const [readyLine] = await once(bridgeChild.stdout, "data");
  const ready = JSON.parse(String(readyLine).trim());
  await run(engine, [
    source, "--output", output, "--lang-in", "en", "--lang-out", "zh-CN",
    "--openaicompatible", "--openai-compatible-base-url", `http://127.0.0.1:${port}/v1`,
    "--openai-compatible-api-key", ready.token, "--openai-compatible-model", model,
    "--openai-compatible-timeout", "180", "--qps", "1", "--pool-max-workers", "1",
    "--term-qps", "1", "--term-pool-max-workers", "1", "--no-auto-extract-glossary",
    "--translate-table-text", "--enhance-compatibility", "--watermark-output-mode", "no_watermark",
  ], env);
  const sourceStem = parse(basename(source)).name;
  const candidates = (await readdir(output))
    .filter((name) => name.startsWith(sourceStem) && /dual.*\.pdf$/i.test(name));
  if (!candidates.length) throw new Error("PDF engine completed but no bilingual PDF artifact was found");
  const dualPdf = resolve(output, candidates.sort().at(-1));
  const info = await stat(dualPdf);
  console.log(`\nRESULT_JSON=${JSON.stringify({ dualPdf, bytes: info.size, model, reasoning })}`);
} finally {
  bridgeChild.kill();
  await once(bridgeChild, "exit").catch(() => {});
}
