import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const files = ["src/pipeline.js", "src/preserved-pdf-workflow.js", "src/task-metrics.js", "src/official-pricing.js", "src/main.js", "addon/bootstrap.js"];
for (const file of files) {
  const source = await readFile(resolve(file), "utf8");
  new Function(source);
  if (source.includes("TODO")) throw new Error(`${file}: remove TODO markers before release`);
}
const bootstrap = await readFile(resolve("addon/bootstrap.js"), "utf8");
if (!bootstrap.includes("Subprocess.sys.mjs")) {
  throw new Error("addon/bootstrap.js: explicitly import Subprocess into the plugin context");
}
const main = await readFile(resolve("src/main.js"), "utf8");
if (!main.includes("new progress.ItemProgress")) {
  throw new Error("src/main.js: use Zotero's native progress window API");
}
if (!main.includes("await process.wait()")) {
  throw new Error("src/main.js: wait for Codex subprocess completion before reading its exit status");
}
if (!main.includes("async function fetchModels")) {
  throw new Error("src/main.js: implement API model discovery");
}
if (!main.includes("async function listTasks") || !main.includes("function openTaskCenter")) {
  throw new Error("src/main.js: implement durable task-center APIs");
}
if (!main.includes("async function fetchOfficialPrice")) {
  throw new Error("src/main.js: implement official pricing lookup");
}
for (const file of [
  "addon/content/icons/icon.svg",
  "addon/content/icons/icon-16.svg",
  "addon/content/icons/icon-20.svg",
  "addon/locale/en-US/codex-bilingual-reader.ftl",
  "addon/locale/zh-CN/codex-bilingual-reader.ftl",
  "addon/content/preferences.xhtml",
  "addon/content/prefsPane-init.js",
  "addon/content/task-center.xhtml",
  "addon/content/task-center.js",
  "addon/prefs.js",
]) {
  await access(resolve(file));
}
for (const file of [
  "scripts/codex-openai-bridge.mjs",
  "scripts/export-bilingual-artifacts.mjs",
  "scripts/run-preserved-pdf-smoke.mjs",
  "scripts/verify-preserved-pdf.py",
  "docs/PDF_PRESERVATION_WORKFLOW.md",
]) {
  await access(resolve(file));
}
console.log(`Checked ${files.length} JavaScript files.`);
