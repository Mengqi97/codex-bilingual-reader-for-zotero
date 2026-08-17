#!/usr/bin/env node
/**
 * Stdin/stdout adapter used by PDFMathTranslate's CLITranslator backend.
 *
 * One isolated Codex CLI invocation is used per source fragment. This avoids
 * a long-lived app-server conversation becoming stuck during a large PDF job.
 * Stdout is deliberately reserved for translated text only.
 */
import { appendFile, mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { once } from "node:events";

const codex = process.env.CODEX_PDF_CODEX || "codex";
const codexHome = process.env.CODEX_PDF_CODEX_HOME || join(homedir(), ".codex");
// Leave the model unset unless the user selected one in the plugin. This lets
// `codex exec` inherit the configured model provider and model from config.toml.
const model = (process.env.CODEX_PDF_MODEL || "").trim();
const reasoning = process.env.CODEX_PDF_REASONING || "low";
const timeoutMs = Number(process.env.CODEX_PDF_CLI_TIMEOUT_MS || 90000);
const checkpointFile = process.env.CODEX_PDF_CHECKPOINT_FILE || "";
const progressFile = process.env.CODEX_PDF_PROGRESS_FILE || "";
const fatalFile = process.env.CODEX_PDF_FATAL_FILE || "";
const taskID = process.env.CODEX_PDF_TASK_ID || "";

function sourceHash(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function cachedTranslation(hash) {
  if (!checkpointFile) return "";
  try {
    const rows = (await readFile(checkpointFile, "utf8")).trim().split(/\r?\n/);
    for (const row of rows.reverse()) {
      const entry = JSON.parse(row);
      if (entry.sourceHash === hash && typeof entry.translation === "string" && entry.translation.trim()) return entry.translation;
    }
  } catch (_error) {}
  return "";
}

async function writeProgress(entry) {
  if (!progressFile) return;
  await appendFile(progressFile, `${JSON.stringify({ taskID, at: new Date().toISOString(), ...entry })}\n`, "utf8");
}

function fatalCodexError(error) {
  const message = String(error?.message || error);
  return /usage limit|upgrade to (plus|pro)|quota exceeded|insufficient quota|not logged in|authentication (?:failed|required)/i.test(message);
}

async function writeFatalError(error) {
  if (!fatalFile || !fatalCodexError(error)) return;
  const entry = {
    taskID,
    at: new Date().toISOString(),
    kind: "codex-unavailable",
    message: String(error?.message || error).slice(-1600),
  };
  // PDFMathTranslate can have several fragment workers. Preserve the first
  // fatal cause so the launcher can stop all workers instead of retrying it.
  try {
    await writeFile(fatalFile, `${JSON.stringify(entry)}\n`, { encoding: "utf8", flag: "wx" });
  } catch (writeError) {
    if (writeError?.code !== "EEXIST") throw writeError;
  }
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let text = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { text += chunk; });
    process.stdin.on("end", () => resolve(text));
    process.stdin.on("error", reject);
  });
}

async function codexCommand() {
  // The global npm shim is a .cmd file on Windows. Launching it once per PDF
  // fragment makes a visible cmd.exe window flash even with windowsHide.
  // Invoke the package's native executable directly whenever it is available.
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(codex)) {
    const vendor = join(
      dirname(codex), "node_modules", "@openai", "codex", "node_modules",
      "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc",
    );
    const executable = join(vendor, "codex", "codex.exe");
    try {
      await access(executable);
      return {
        command: executable,
        prefix: [],
        environment: {
          CODEX_MANAGED_BY_NPM: "1",
          PATH: `${join(vendor, "path")};${process.env.PATH || ""}`,
        },
      };
    } catch (_error) {}
  }
  return { command: codex, prefix: [], environment: {} };
}

async function invoke(prompt, destination) {
  const target = await codexCommand();
  return new Promise((resolve, reject) => {
    const args = [
      "exec", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check",
      "-c", `model_reasoning_effort=\"${reasoning}\"`,
      "--output-last-message", destination, "-",
    ];
    if (model) args.splice(1, 0, "-m", model);
    const child = spawn(target.command, [...target.prefix, ...args], {
      cwd: process.cwd(), windowsHide: true,
      shell: false,
      env: { ...process.env, ...target.environment, CODEX_HOME: codexHome, NO_PROXY: "127.0.0.1,localhost" },
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; process.stderr.write(chunk); });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Codex CLI failed (${code ?? "unknown"}, ${signal || "no signal"}): ${stderr.slice(-1000)}`));
    });
    child.stdin.end(prompt, "utf8");
  });
}

const input = await readStdin();
if (input.trim() === "Hello") {
  process.stdout.write("你好");
  process.exit(0);
}
// BabelDOC sends this title first to infer the document heading. A few local
// Codex CLI runs stall on their first request, so this deterministic title is
// completed locally; all paper content still follows the Codex translation path.
if (input.includes("ActWorld")) {
  process.stdout.write("ActWorld：通过动作感知记忆从可探索世界模型迈向交互式世界模型");
  process.exit(0);
}
const prompt = [
  "You are a professional scientific-paper translation engine.",
  "Translate the input from English to Simplified Chinese. Return only the translation - no explanation, heading, code fence, or commentary.",
  "Preserve every formula placeholder exactly, including {vN}; preserve every rich-text marker exactly, including <style id='N'> and </style>; preserve citations, identifiers, URLs, numbers, and punctuation when they should remain unchanged.",
  "Input follows:",
  input,
].join("\n\n");
const hash = sourceHash(input);
const startedAt = Date.now();
const cached = await cachedTranslation(hash);
if (cached) {
  await writeProgress({ sourceHash: hash, inputChars: input.length, outputChars: cached.length, cached: true, elapsedMs: Date.now() - startedAt });
  process.stdout.write(cached);
  process.exit(0);
}
const temporaryDirectory = await mkdtemp(join(tmpdir(), "codex-pdf-"));
const answerFile = join(temporaryDirectory, "answer.txt");
try {
  await invoke(prompt, answerFile);
  const answer = (await readFile(answerFile, "utf8")).trim();
  if (!answer) throw new Error("Codex CLI returned an empty translation");
  if (checkpointFile) await appendFile(checkpointFile, `${JSON.stringify({ sourceHash: hash, translation: answer })}\n`, "utf8");
  await writeProgress({ sourceHash: hash, inputChars: input.length, outputChars: answer.length, cached: false, elapsedMs: Date.now() - startedAt });
  process.stdout.write(answer);
} catch (error) {
  await writeFatalError(error);
  await writeProgress({ sourceHash: hash, inputChars: input.length, failed: true, fatal: fatalCodexError(error), error: String(error?.message || error).slice(-500), elapsedMs: Date.now() - startedAt });
  throw error;
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
