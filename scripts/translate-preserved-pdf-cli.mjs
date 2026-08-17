import { access, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { basename, dirname, parse, resolve } from "node:path";
import { preparePdf2zhRuntime } from "./prepare-pdf2zh-runtime.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checking = process.argv[2] === "--check";
const source = process.argv[2];
const requestedOutput = process.argv[3];
if (!checking && (!source || !requestedOutput)) throw new Error("Usage: node scripts/translate-preserved-pdf-cli.mjs <input.pdf> <output-directory>");

const output = requestedOutput ? resolve(requestedOutput) : "";
const home = resolve(root, ".runtime", "pdf2zh-home");
// Windows uses PDFMathTranslate's official portable bundle. macOS uses the
// official uv-installed `pdf2zh_next` command supplied through CODEX_PDF_ENGINE.
const portableRoot = resolve(root, ".tools", "pdf2zh-next-staging-2.9.0-babeldoc-0.6.4", "pdf2zh");
const portableEngine = resolve(portableRoot, "pdf2zh.exe");
const engine = process.env.CODEX_PDF_ENGINE || (process.platform === "win32" ? portableEngine : "");
// CLITranslator parses its command with POSIX shlex even on Windows. Forward
// slashes plus explicit quotes keep this absolute path intact across that hop.
// BabelDOC launches this bridge once per source fragment. Windows uses the
// bundled windowless Python; macOS uses the uv environment selected by Zotero.
const bridgePython = (process.env.CODEX_PDF_PYTHON
  || (process.platform === "win32" ? resolve(portableRoot, "runtime", "pythonw.exe") : "/usr/bin/python3"))
  .replace(/\\\\/g, "/");
const wrapper = resolve(root, "scripts", "codex-cli-translator.py").replace(/\\\\/g, "/");
const broker = resolve(root, "scripts", "codex-batch-broker.py").replace(/\\\\/g, "/");
const compactDualPdfScript = resolve(root, "scripts", "compact-dual-pdf.py");
const exporter = resolve(root, "scripts", "export-bilingual-artifacts.mjs");
const docxBuilder = resolve(root, "scripts", "render-pages-to-docx.py");
const requestedCliTimeout = Number(process.env.CODEX_PDF_CLI_TIMEOUT_SECONDS || "300");
// PDFMathTranslate validates this CLI option before doing any work and its
// current schema caps it at 300 seconds.
const cliTimeout = String(Math.min(300, Math.max(1, Number.isFinite(requestedCliTimeout) ? requestedCliTimeout : 300)));
// These workers only feed the local broker. The broker limits actual Codex
// concurrency independently while enough layout fragments gather per batch.
const qps = process.env.CODEX_PDF_QPS || "64";
const workers = process.env.CODEX_PDF_WORKERS || "64";
const recoveryIdleMs = Math.max(60000, Number(process.env.CODEX_PDF_ENGINE_RECOVERY_IDLE_SECONDS || "90") * 1000);
// Capture the real user account before isolating BabelDOC's HOME. A
// stale inherited CODEX_HOME can otherwise point into the temporary runtime.
const codexHome = process.env.CODEX_PDF_CODEX_HOME
  || process.env.CODEX_HOME
  || (process.env.USERPROFILE ? resolve(process.env.USERPROFILE, ".codex") : "")
  || (process.env.HOME ? resolve(process.env.HOME, ".codex") : "");
const platformProxyDefaults = process.platform === "win32" ? {
  HTTP_PROXY: process.env.HTTP_PROXY || "http://127.0.0.1:7897",
  HTTPS_PROXY: process.env.HTTPS_PROXY || "http://127.0.0.1:7897",
  ALL_PROXY: process.env.ALL_PROXY || "http://127.0.0.1:7897",
} : {};
const env = {
  ...process.env,
  ...(process.platform === "win32" ? { USERPROFILE: home } : {}),
  HOME: home,
  CODEX_HOME: codexHome,
  CODEX_PDF_CODEX_HOME: codexHome,
  CODEX_PDF_CODEX: process.env.CODEX_PDF_CODEX || "codex",
  ...platformProxyDefaults,
  NO_PROXY: "127.0.0.1,localhost",
  PYTHONIOENCODING: "utf-8",
  PYTHONUTF8: "1",
  NO_COLOR: "1",
  // DirectML is available on this machine but benchmarked slower than CPU for
  // BabelDOC's dynamic layout model. Keep it opt-in.
  CODEX_PDF_LAYOUT_PROVIDER: process.env.CODEX_PDF_LAYOUT_PROVIDER || "cpu",
};
async function verifyPythonRuntime() {
  const pythonProbe = "import sys; from pathlib import Path; sys.path.insert(0, str(Path(sys.executable).resolve().parents[1] / 'site-packages')); import pymupdf";
  const child = spawn(bridgePython, ["-c", pythonProbe], {
    cwd: root, env, windowsHide: true, stdio: ["ignore", "ignore", "pipe"],
  });
  let diagnostics = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { diagnostics += chunk; });
  const exitCode = await new Promise((resolvePromise, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolvePromise(code));
  });
  if (exitCode !== 0) throw new Error(`Configured PDF Python cannot import pymupdf: ${diagnostics.slice(-500)}`);
}
if (checking) {
  await mkdir(home, { recursive: true });
  if (!engine) throw new Error("CODEX_PDF_ENGINE is required on macOS");
  await access(engine);
  await access(resolve(root, "scripts", "prepare-pdf2zh-runtime.mjs"));
  await access(bridgePython);
  await access(wrapper);
  await access(broker);
  await access(compactDualPdfScript);
  await access(exporter);
  await access(docxBuilder);
  await verifyPythonRuntime();
  console.log(`RESULT_JSON=${JSON.stringify({ status: "ready", engine, wrapper })}`);
  process.exit(0);
}
await mkdir(output, { recursive: true });
await mkdir(home, { recursive: true });
if (process.platform === "win32" && resolve(engine).toLowerCase() === portableEngine.toLowerCase()) {
  await preparePdf2zhRuntime(portableRoot);
}
const runnerResultPath = resolve(output, "codex-runner-result.json");
await rm(runnerResultPath, { force: true });
env.CODEX_PDF_CHECKPOINT_FILE = resolve(output, "codex-fragment-checkpoint.jsonl");
env.CODEX_PDF_PROGRESS_FILE = resolve(output, "codex-fragment-progress.jsonl");
env.CODEX_PDF_FATAL_FILE = resolve(output, "codex-fatal-error.json");
await rm(env.CODEX_PDF_FATAL_FILE, { force: true });
const brokerReadyPath = resolve(output, "codex-batch-broker-ready.json");
await rm(brokerReadyPath, { force: true });
const brokerChild = spawn(bridgePython, [broker, "--ready-file", brokerReadyPath], { cwd: root, env, windowsHide: true, stdio: "ignore" });
let brokerReady = null;
const brokerStartedAt = Date.now();
while (!brokerReady && Date.now() - brokerStartedAt < 10000) {
  try {
    brokerReady = JSON.parse(await readFile(brokerReadyPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
}
if (!Number(brokerReady?.port)) {
  brokerChild.kill();
  throw new Error("Codex batch broker did not start within 10 seconds");
}
env.CODEX_PDF_BROKER_PORT = String(brokerReady.port);
const stopBroker = () => { if (!brokerChild.killed) brokerChild.kill(); };
const sourceStem = parse(basename(source)).name;
const translationSide = process.env.CODEX_PDF_TRANSLATION_SIDE === "left" ? "left" : "right";
async function latestEngineDualPdf() {
  const candidates = (await readdir(output)).filter((name) => name.startsWith(sourceStem) && /dual.*\.pdf$/i.test(name));
  if (!candidates.length) return "";
  const paths = await Promise.all(candidates.map(async (name) => {
    const filePath = resolve(output, name);
    return { filePath, info: await stat(filePath) };
  }));
  return paths.sort((left, right) => right.info.mtimeMs - left.info.mtimeMs)[0].filePath;
}
const args = [
  source, "--output", output, "--lang-in", "en", "--lang-out", "zh-CN",
  "--clitranslator", "--clitranslator-command", `\"${bridgePython}\" \"${wrapper}\" --utf8-v2`,
  "--clitranslator-timeout", cliTimeout,
  "--qps", qps, "--pool-max-workers", workers, "--no-auto-extract-glossary",
  // Use BabelDOC's native dual-page compositor. It preserves the CJK font
  // resources Zotero can render. Do not pass --skip-clean: BabelDOC performs
  // CJK font subsetting in its clean stage, which is required by Zotero's
  // PDF.js reader. Direction remains explicitly user-controlled below.
  // Academic PDFs with selectable text do not need BabelDOC's scanned-page
  // detection pass. Table translation stays enabled to preserve full-text
  // behavior; it can be disabled explicitly for a faster draft.
  "--skip-scanned-detection", "--disable-rich-text-translate", "--watermark-output-mode", "no_watermark",
];
if (String(env.CODEX_PDF_TRANSLATE_TABLE_TEXT || "true") !== "false") args.push("--translate-table-text");
if (String(env.CODEX_PDF_PAGES || "").trim()) args.push("--pages", String(env.CODEX_PDF_PAGES).trim());
if (translationSide === "left") args.push("--dual-translate-first");
const child = spawn(engine, args, { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
let lastEngineActivityAt = Date.now();
child.stdout.on("data", (chunk) => { lastEngineActivityAt = Date.now(); process.stdout.write(chunk); });
child.stderr.on("data", (chunk) => { lastEngineActivityAt = Date.now(); process.stderr.write(chunk); });
let fatalError = null;
let stoppingForFatal = false;
let recoveredEngineDualPdf = "";
let recoveryProbe = { filePath: "", size: -1, mtimeMs: -1, stableSince: 0 };
async function readFatalError() {
  try {
    return JSON.parse((await readFile(env.CODEX_PDF_FATAL_FILE, "utf8")).trim());
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}
const fatalMonitor = setInterval(() => {
  void readFatalError().then((entry) => {
    if (!entry || stoppingForFatal) return;
    fatalError = entry;
    stoppingForFatal = true;
    // The engine owns its worker pool. Terminating this root process makes a
    // quota/authentication error visible immediately instead of retrying every fragment.
    child.kill();
  }).catch((error) => process.stderr.write(`Unable to read Codex failure marker: ${error.message}\n`));
}, 500);
const recoveryMonitor = setInterval(() => {
  void (async () => {
    if (stoppingForFatal || recoveredEngineDualPdf) return;
    const candidate = await latestEngineDualPdf();
    if (!candidate) return;
    const info = await stat(candidate);
    const now = Date.now();
    const progressInfo = await stat(env.CODEX_PDF_PROGRESS_FILE).catch(() => null);
    const lastActivity = Math.max(lastEngineActivityAt, progressInfo?.mtimeMs || 0);
    if (candidate !== recoveryProbe.filePath || info.size !== recoveryProbe.size || info.mtimeMs !== recoveryProbe.mtimeMs) {
      recoveryProbe = { filePath: candidate, size: info.size, mtimeMs: info.mtimeMs, stableSince: now };
      return;
    }
    if (now - recoveryProbe.stableSince < recoveryIdleMs || now - lastActivity < recoveryIdleMs) return;
    recoveredEngineDualPdf = candidate;
    stoppingForFatal = true;
    process.stderr.write(`PDF engine produced a stable dual PDF but did not exit for ${Math.round(recoveryIdleMs / 1000)} seconds; recovering output.\n`);
    child.kill();
  })().catch((error) => process.stderr.write(`Unable to monitor PDF engine recovery: ${error.message}\n`));
}, 1000);
let exitCode;
try {
  exitCode = await new Promise((resolvePromise, reject) => { child.on("error", reject); child.on("exit", (code) => resolvePromise(code)); });
} finally {
  clearInterval(fatalMonitor);
  clearInterval(recoveryMonitor);
  stopBroker();
}
fatalError ||= await readFatalError();
if (fatalError) throw new Error(`Codex CLI is unavailable; PDF translation stopped: ${fatalError.message}`);
if (exitCode !== 0 && !recoveredEngineDualPdf) throw new Error(`PDF engine failed (${exitCode})`);
const engineDualPdf = recoveredEngineDualPdf || await latestEngineDualPdf();
if (!engineDualPdf) throw new Error("PDF engine completed but no bilingual PDF artifact was found");
const compactedDualPdf = resolve(output, `${parse(engineDualPdf).name}.compact.pdf`);
const compactChild = spawn(bridgePython, [
  compactDualPdfScript,
  engineDualPdf,
  compactedDualPdf,
  "--trim-points",
  String(env.CODEX_PDF_DUAL_INNER_TRIM_PT || "80"),
], { cwd: root, env, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
let compactError = "";
compactChild.stderr.setEncoding("utf8");
compactChild.stderr.on("data", (chunk) => { compactError += chunk; process.stderr.write(chunk); });
const compactExitCode = await new Promise((resolvePromise, reject) => {
  compactChild.on("error", reject);
  compactChild.on("exit", (code) => resolvePromise(code));
});
if (compactExitCode !== 0) throw new Error(`Compact dual PDF failed (${compactExitCode}): ${compactError.slice(-800)}`);
const dualPdf = compactedDualPdf;
const exportFormats = String(env.CODEX_PDF_EXPORTS || "").split(",").filter(Boolean);
let artifacts = {};
if (exportFormats.length) {
  const exporterChild = spawn(process.execPath, [exporter, dualPdf, output, exportFormats.join(",")], { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let exporterOutput = "";
  let exporterError = "";
  exporterChild.stdout.setEncoding("utf8"); exporterChild.stderr.setEncoding("utf8");
  exporterChild.stdout.on("data", (chunk) => { exporterOutput += chunk; process.stdout.write(chunk); });
  exporterChild.stderr.on("data", (chunk) => { exporterError += chunk; process.stderr.write(chunk); });
  const exporterExitCode = await new Promise((resolvePromise, reject) => { exporterChild.on("error", reject); exporterChild.on("exit", (code) => resolvePromise(code)); });
  if (exporterExitCode !== 0) throw new Error(`Artifact export failed (${exporterExitCode}): ${exporterError.slice(-800)}`);
  const exportResult = exporterOutput.match(/EXPORTS_JSON=(\{[^\r\n]+\})/g)?.at(-1);
  if (!exportResult) throw new Error("Artifact exporter did not return EXPORTS_JSON");
  artifacts = JSON.parse(exportResult.slice("EXPORTS_JSON=".length));
}
const resultPayload = {
  dualPdf,
  engineDualPdf,
  recoveredEngineHang: Boolean(recoveredEngineDualPdf),
  bytes: (await stat(dualPdf)).size,
  artifacts,
};
// Zotero's Subprocess pipe can occasionally lose stdout from a completed
// Windows child process. Persist the same contract beside the artifacts so
// the add-on can recover the result without rerunning translation.
await writeFile(runnerResultPath, JSON.stringify(resultPayload), "utf8");
console.log(`RESULT_JSON=${JSON.stringify({ ...resultPayload, runnerResultPath })}`);
