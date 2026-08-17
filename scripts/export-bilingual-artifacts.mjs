import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { basename, dirname, extname, join, parse, resolve } from "node:path";

const source = process.argv[2];
const requestedOutput = process.argv[3];
const requestedFormats = new Set(String(process.argv[4] || "").split(",").filter(Boolean));
if (!source || !requestedOutput) {
  throw new Error("Usage: node scripts/export-bilingual-artifacts.mjs <bilingual.pdf> <output-directory> <html,markdown,docx>");
}
for (const format of requestedFormats) {
  if (!["html", "markdown", "docx"].includes(format)) throw new Error(`Unsupported export format: ${format}`);
}

const output = resolve(requestedOutput);
const stem = parse(basename(source)).name;
const assetsDirectory = join(output, `${stem}-assets`);
const htmlPath = join(output, `${stem}.html`);
const markdownPath = join(output, `${stem}.md`);
const docxPath = join(output, `${stem}.docx`);
const docxBuilder = resolve(dirname(fileURLToPath(import.meta.url)), "render-pages-to-docx.py");

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(`${command} failed (${code ?? "unknown"}): ${(stderr || stdout).trim().slice(-800)}`));
    });
  });
}

function pageNumber(name) {
  const matched = name.match(/-(\d+)\.png$/i);
  return matched ? Number(matched[1]) : Number.MAX_SAFE_INTEGER;
}

function htmlDocument(title, images) {
  const escaped = String(title).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  }[character]));
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escaped} · 中英对照</title><style>
body{margin:0;background:#e5e7eb;font-family:system-ui,sans-serif}.page{max-width:1180px;margin:24px auto;background:#fff;box-shadow:0 2px 12px #0003;page-break-after:always}.page img{display:block;width:100%;height:auto}@media print{body{background:#fff}.page{max-width:none;margin:0;box-shadow:none;break-after:page}}
</style></head><body>${images.map((image, index) => `<section class="page" id="page-${index + 1}"><img src="${image}" alt="第 ${index + 1} 页中英对照"></section>`).join("\n")}</body></html>`;
}

const renderer = process.env.CODEX_PDF_PDFTOPPM || "pdftoppm";
const textExtractor = process.env.CODEX_PDF_PDFTOTEXT || "pdftotext";
const python = process.env.CODEX_PDF_PYTHON || "python";
await mkdir(output, { recursive: true });
let images = [];
if (requestedFormats.has("html") || requestedFormats.has("docx")) {
  await rm(assetsDirectory, { recursive: true, force: true });
  await mkdir(assetsDirectory, { recursive: true });
  const imagePrefix = join(assetsDirectory, "page");
  await run(renderer, ["-png", "-r", "144", source, imagePrefix]);
  images = (await readdir(assetsDirectory))
    .filter((name) => extname(name).toLowerCase() === ".png")
    .sort((left, right) => pageNumber(left) - pageNumber(right));
  if (!images.length) throw new Error("PDF page renderer did not create page images");
}
if (requestedFormats.has("html")) {
  const relativeImages = images.map((name) => `${basename(assetsDirectory)}/${name}`);
  await writeFile(htmlPath, htmlDocument(stem, relativeImages), "utf8");
}
if (requestedFormats.has("markdown")) {
  const extractedTextPath = join(output, `${stem}.txt`);
  await run(textExtractor, ["-layout", "-enc", "UTF-8", source, extractedTextPath]);
  const extractedText = (await readFile(extractedTextPath, "utf8")).trim();
  await rm(extractedTextPath, { force: true });
  await writeFile(markdownPath, [
    `# ${stem} · 中英对照`,
    "",
    "> 此 Markdown 与同名双语 PDF 同步生成，保留 PDF 的可搜索版式文本。需要完整图表、公式与页面布局时，请打开 PDF。",
    "",
    "```text",
    extractedText,
    "```",
    "",
  ].join("\n"), "utf8");
}
if (requestedFormats.has("docx")) await run(python, [docxBuilder, assetsDirectory, docxPath]);

console.log(`EXPORTS_JSON=${JSON.stringify({
  ...(requestedFormats.has("html") ? { htmlPath, assetsDirectory, pages: images.length } : {}),
  ...(requestedFormats.has("markdown") ? { markdownPath } : {}),
  ...(requestedFormats.has("docx") ? { docxPath, pages: images.length } : {}),
})}`);
