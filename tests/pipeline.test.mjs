import test from "node:test";
import assert from "node:assert/strict";
import pipeline from "../src/pipeline.js";
import preservedPdfWorkflow from "../src/preserved-pdf-workflow.js";
import taskMetrics from "../src/task-metrics.js";
import officialPricing from "../src/official-pricing.js";
import { parseArgs, requestText } from "../scripts/codex-openai-bridge.mjs";

test("segments paragraphs and preserves page boundaries", () => {
  const segments = pipeline.segmentFullText("First paragraph.\n\nSecond paragraph.\fThird page.");
  assert.deepEqual(segments.map(({ page, source }) => [page, source]), [
    [1, "First paragraph."],
    [1, "Second paragraph."],
    [2, "Third page."],
  ]);
});

test("splits oversized source safely", () => {
  const text = `${"One sentence. ".repeat(800)}Last sentence.`;
  const segments = pipeline.segmentFullText(text);
  assert.ok(segments.length > 1);
  assert.ok(segments.every((segment) => segment.source.length <= pipeline.MAX_SEGMENT_LENGTH));
});

test("rendered reading page keeps each source and translation in one row", () => {
  const html = pipeline.renderBilingualHTML({
    title: "A < B",
    generatedAt: "now",
    segments: [{ id: "p1-s1", page: 1, source: "Source", translation: "译文" }],
  });
  assert.match(html, /class="segment" id="p1-s1"/);
  assert.match(html, /grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/);
  assert.match(html, /A &lt; B/);
});

test("preference bridge listens for XUL command events", async () => {
  const source = await (await import("node:fs/promises")).readFile(
    new URL("../addon/content/prefsPane-init.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /field\.addEventListener\("command", persist\)/);
  assert.match(source, /set\("apiProvider", provider\(\)\)/);
  assert.match(source, /const preset = document\.getElementById\("codex-bilingual-api-model-preset"\)/);
  assert.match(source, /\["codex-bilingual-preferred-open-attachment", "preferredOpenAttachment"\]/);
  assert.match(source, /API（\$\{result\.provider \|\| provider\(\)\}）/);
});

test("Codex subprocess handling accepts Gecko process status objects", async () => {
  const source = await (await import("node:fs/promises")).readFile(
    new URL("../src/main.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /function subprocessExitCode\(status\)/);
  assert.match(source, /status\?\.exitCode/);
  assert.match(source, /subprocessExitCode\(await process\.wait\(\)\)/);
  assert.match(source, /function nodeExecutablePath\(\)/);
  assert.match(source, /function codexHomePath\(\)/);
  assert.match(source, /CODEX_HOME: codexHome/);
  assert.match(source, /environmentAppend: Boolean\(environment\)/);
  assert.match(source, /command: node/);
  assert.match(source, /stderr: "pipe"/);
  assert.match(source, /async function readSubprocessStream\(stream\)/);
  assert.match(source, /const stderrPromise = readSubprocessStream\(process\.stderr\)/);
  assert.match(source, /async function startAppServer\(\)/);
  assert.match(source, /arguments: \["app-server"\]/);
  assert.match(source, /await startAppServer\(\);/);
  assert.match(source, /request\("model\/list", \{\}, 70000\)/);
  assert.match(source, /async function fetchAppServerModels\(\)/);
  assert.match(source, /function appServerModelCatalog\(result\)/);
  assert.match(source, /supportedReasoningEfforts/);
  assert.match(source, /function appServerReasoningParams\(\)/);
  assert.match(source, /\.\.\.appServerReasoningParams\(\)/);
  assert.match(source, /async function translateWithAppServer\(source\)/);
  assert.match(source, /request\("thread\/start"/);
  assert.match(source, /request\("turn\/start"/);
  assert.match(source, /server\.on\("turn\/completed"/);
});

test("App Server preferences expose model loading and reasoning selection", async () => {
  const source = await (await import("node:fs/promises")).readFile(
    new URL("../addon/content/prefsPane-init.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /fetchAppServerModels\(\)/);
  assert.match(source, /renderAppServerModels/);
  assert.match(source, /renderAppServerReasoning/);
  assert.match(source, /appServerReasoningEffort/);
  assert.match(source, /refreshPreservedPdfModelSource/);
  assert.match(source, /preservedPdfModelSource\(\)/);
});

test("default menu route imports only the preserved PDF and exposes no companion-format options", async () => {
  const main = await (await import("node:fs/promises")).readFile(
    new URL("../src/main.js", import.meta.url), "utf8",
  );
  const pane = await (await import("node:fs/promises")).readFile(
    new URL("../addon/content/preferences.xhtml", import.meta.url), "utf8",
  );
  assert.match(main, /async function translatePreservedPdfItem\(item, queuedTask = null\)/);
  assert.match(main, /function startPreservedPdfTranslation\(itemID\)/);
  assert.match(main, /startPreservedPdfTranslation,/);
  assert.match(main, /runPreservedPdfLauncher\(\["--check"\]/);
  const prefs = await (await import("node:fs/promises")).readFile(
    new URL("../addon/prefs.js", import.meta.url), "utf8",
  );
  assert.match(main, /CODEX_PDF_TRANSLATION_SIDE = task\.translationSide/);
  assert.match(main, /CODEX_PDF_DUAL_INNER_TRIM_PT = String\(dualInnerTrimPoints\(\)\)/);
  assert.match(main, /environment\.CODEX_PDF_EXPORTS = ""/);
  assert.match(prefs, /dualInnerTrimPoints", "80"/);
  assert.match(pane, /codex-bilingual-dual-inner-trim-points/);
  assert.doesNotMatch(pane, /label="保真 HTML"|label="可搜索 Markdown"|label="保真 DOCX"|可选转换|按需勾选额外格式/);
  assert.doesNotMatch(prefs, /exportHtml|exportMarkdown|exportDocx|optionalExportsDefaultVersion/);
  assert.doesNotMatch(main, /requestedCompanionFormats|writePreservedCompanions|getBooleanPref|migrateOptionalExportDefaults/);
  assert.match(main, /async function preservedPdfModelSource\(\)/);
  assert.match(main, /PDF 当前继承 config\.toml/);
  assert.match(main, /CODEX_PDF_BACKEND = pdfBackend/);
  assert.match(main, /CODEX_PDF_API_BASE_URL = apiBaseURL/);
  assert.match(main, /CODEX_PDF_API_MODEL = apiModel/);
  assert.match(main, /CODEX_PDF_API_KEY = apiKey/);
  assert.match(main, /backend: pdfBackend/);
  assert.match(pane, /codex-bilingual-preferred-open-attachment/);
  assert.match(pane, /优先打开双语 PDF（默认）/);
  assert.match(pane, /打开原始 PDF/);
});

test("preserved PDF launcher supports a local preflight check", async () => {
  const runner = await (await import("node:fs/promises")).readFile(
    new URL("../scripts/translate-preserved-pdf-cli.mjs", import.meta.url), "utf8",
  );
  assert.match(runner, /process\.argv\[2\] === "--check"/);
  assert.match(runner, /CODEX_PDF_ENGINE/);
  assert.match(runner, /export-bilingual-artifacts\.mjs/);
  assert.match(runner, /runtime", "pythonw\.exe/);
  assert.match(runner, /codex-cli-translator\.py/);
  assert.match(runner, /codex-batch-broker\.py/);
  assert.match(runner, /compact-dual-pdf\.py/);
  assert.match(runner, /CODEX_PDF_DUAL_INNER_TRIM_PT \|\| "80"/);
  assert.match(runner, /const dualPdf = compactedDualPdf/);
  assert.match(runner, /prepare-pdf2zh-runtime\.mjs/);
  assert.match(runner, /preparePdf2zhRuntime/);
  assert.match(runner, /CODEX_PDF_PAGES/);
  assert.match(runner, /CODEX_PDF_BROKER_PORT/);
  assert.match(runner, /CODEX_PDF_CLI_TIMEOUT_SECONDS \|\| "300"/);
  assert.match(runner, /Math\.min\(300, Math\.max\(1,/);
  assert.match(runner, /CODEX_PDF_QPS \|\| "64"/);
  assert.match(runner, /CODEX_PDF_WORKERS \|\| "64"/);
  assert.match(runner, /--clitranslator-command", `\\"\$\{bridgePython\}\\" \\"\$\{wrapper\}\\" --utf8-v2`/);
  assert.match(runner, /--disable-rich-text-translate/);
  assert.match(runner, /--skip-scanned-detection/);
  assert.match(runner, /if \(translationSide === "left"\) args\.push\("--dual-translate-first"\)/);
  assert.doesNotMatch(runner, /make-zotero-readable-bilingual-pdf\.py/);
  assert.doesNotMatch(runner, /"--enhance-compatibility"/);
  assert.doesNotMatch(runner, /"--skip-clean"/);
  assert.match(runner, /latestEngineDualPdf/);
  assert.match(runner, /CODEX_PDF_ENGINE_RECOVERY_IDLE_SECONDS/);
  assert.match(runner, /recoveredEngineHang/);
  assert.match(runner, /stable dual PDF but did not exit/);
  assert.match(runner, /codex-runner-result\.json/);
  assert.match(runner, /writeFile\(runnerResultPath/);
  assert.match(runner, /const codexHome = process\.env\.CODEX_PDF_CODEX_HOME/);
  assert.match(runner, /CODEX_PDF_CODEX_HOME: codexHome/);
  assert.match(runner, /status: "ready"/);
});

test("preferences provide one-click workspace configuration for the PDF runner", async () => {
  const main = await (await import("node:fs/promises")).readFile(
    new URL("../src/main.js", import.meta.url), "utf8",
  );
  const prefs = await (await import("node:fs/promises")).readFile(
    new URL("../addon/content/prefsPane-init.js", import.meta.url), "utf8",
  );
  assert.match(main, /async function selectPreservedPdfWorkspace/);
  assert.match(main, /modeGetFolder/);
  const bootstrap = await (await import("node:fs/promises")).readFile(
    new URL("../addon/bootstrap.js", import.meta.url), "utf8",
  );
  assert.match(bootstrap, /chrome:\/\/zotero\/content\/modules\/filePicker\.mjs/);
  assert.match(bootstrap, /const context = \{ rootURI, Subprocess, FilePicker \}/);
  assert.match(main, /new FilePicker\(\)/);
  assert.match(main, /picker\.init\(Zotero\.getMainWindow\(\), "选择 Codex 双语 PDF 工作目录", picker\.modeGetFolder\)/);
  assert.match(main, /await picker\.show\(\)/);
  assert.match(main, /pdf2zh\.exe/);
  assert.match(main, /async function parseRunnerResult/);
  assert.match(main, /codex-runner-result\.json/);
  assert.match(prefs, /selectPreservedPdfWorkspace\(\)/);
  assert.match(prefs, /已自动配置并完成保真 PDF 预检/);
});

test("preferences provide a verified one-click runtime installer", async () => {
  const main = await (await import("node:fs/promises")).readFile(
    new URL("../src/main.js", import.meta.url), "utf8",
  );
  const pane = await (await import("node:fs/promises")).readFile(
    new URL("../addon/content/preferences.xhtml", import.meta.url), "utf8",
  );
  const bridge = await (await import("node:fs/promises")).readFile(
    new URL("../addon/content/prefsPane-init.js", import.meta.url), "utf8",
  );
  const installer = await (await import("node:fs/promises")).readFile(
    new URL("../scripts/install-preserved-pdf-runtime.ps1", import.meta.url), "utf8",
  );
  const runner = await (await import("node:fs/promises")).readFile(
    new URL("../scripts/translate-preserved-pdf-cli.mjs", import.meta.url), "utf8",
  );
  assert.match(pane, /codex-bilingual-install-runtime/);
  assert.match(pane, /一键安装\/修复 PDF 翻译环境（约 600 MB）/);
  assert.match(bridge, /installPreservedPdfRuntime\(\)/);
  assert.match(main, /async function installPreservedPdfRuntime\(\)/);
  assert.match(main, /content\/runtime\/\$\{name\}/);
  assert.match(main, /installPreservedPdfRuntime,/);
  assert.match(installer, /PDFMathTranslate-next\/PDFMathTranslate-next\/releases\/download\/v2\.9\.0/);
  assert.match(installer, /6916a2f299b029cfb75803c780528088d93e7694d5597c4250ba2dcf5598f1d8/);
  assert.match(installer, /nodejs\.org\/dist\/v24\.19\.0\/win-x64\/node\.exe/);
  assert.match(installer, /3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237/);
  assert.match(installer, /INSTALL_JSON=/);
  assert.doesNotMatch(runner, /pdf-selectable-support/);
});

test("completed preserved PDFs are automatically imported into the selected Zotero item", async () => {
  const main = await (await import("node:fs/promises")).readFile(
    new URL("../src/main.js", import.meta.url), "utf8",
  );
  assert.match(main, /Zotero\.Attachments\.importFromFile\(/);
  assert.match(main, /async function importPreservedPdfWithRecovery/);
  assert.match(main, /Symbol\("import-timeout"\)/);
  assert.match(main, /const pdfAttachment = await importPreservedPdfWithRecovery/);
  assert.match(main, /parentItemID: parent\.id/);
  assert.match(main, /保真中英对照 PDF 已自动导入为子附件/);
  assert.match(main, /selectItem\?\.\(result\.id\)/);
  assert.match(main, /function finishProgressWindow\(progress, line, text\)/);
  assert.match(main, /A disposed window must not turn a successfully imported artifact into a failed task/);
  assert.match(main, /finishProgressWindow\(progress, line, "保真中英对照 PDF 已生成（100%）"\)/);
});

test("preserved PDF tasks defer token display and keep live progress visible", async () => {
  const main = await (await import("node:fs/promises")).readFile(
    new URL("../src/main.js", import.meta.url), "utf8",
  );
  assert.match(main, /async function addPreservedPdfDocumentEstimate/);
  assert.match(main, /Zotero\.FullText\.indexItems\(\[attachment\.id\], \{ ignoreErrors: true \}\)/);
  assert.doesNotMatch(main, /CodexTaskMetrics\.normalizeUsage\(null, sourceText, sourceText\)/);
  assert.match(main, /function taskTokenText/);
  assert.match(main, /function silentProgressLine\(\)/);
  assert.match(main, /const progress = null;\s+const line = silentProgressLine\(\)/);
  assert.match(main, /Token 将在任务结束后显示/);
  assert.match(main, /stage === "usage_actual"/);
  assert.match(main, /function liveTaskText/);
  assert.match(main, /function preservedProgressText/);
  assert.match(main, /初始文本估算 \$\{estimated\} 段偏小/);
  assert.match(main, /entry\.taskID === taskID && !entry\.failed/);
  assert.match(main, /estimatedSegments/);
  assert.match(main, /CodexBilingualPipeline\.segmentFullText\(sourceText\)/);
  assert.match(main, /async function readPreservedProgress/);
  assert.match(main, /codex-fragment-progress\.jsonl/);
  assert.match(main, /async function seedPreviousCheckpoint/);
  assert.match(main, /IOUtils\.copy\(source, destination\)/);
  assert.match(main, /status: "interrupted"/);
  assert.match(main, /refreshProgress\(\);/);
  assert.match(main, /setInterval\(\(\) => void refreshProgress\(\), 1000\)/);
  assert.match(main, /batchFragmentCount/);
  assert.match(main, /codexCalls/);
  assert.match(main, /已运行 \$\{elapsed\}/);
  assert.match(main, /body\._codexBilingualTimer/);
  assert.match(main, /已有正在运行的翻译任务/);
});

test("preserved PDF CLI writes resumable fragment checkpoints without polluting translation stdout", async () => {
  const launcher = await (await import("node:fs/promises")).readFile(
    new URL("../scripts/translate-preserved-pdf-cli.mjs", import.meta.url), "utf8",
  );
  const translator = await (await import("node:fs/promises")).readFile(
    new URL("../scripts/codex-cli-translator.py", import.meta.url), "utf8",
  );
  assert.match(launcher, /CODEX_PDF_CHECKPOINT_FILE/);
  assert.match(launcher, /CODEX_PDF_PROGRESS_FILE/);
  assert.match(launcher, /CODEX_PDF_FATAL_FILE/);
  assert.match(launcher, /await rm\(env\.CODEX_PDF_FATAL_FILE, \{ force: true \}\)/);
  assert.match(launcher, /Codex CLI is unavailable; PDF translation stopped/);
  assert.match(translator, /def is_fatal/);
  assert.match(translator, /def request_broker/);
  assert.match(translator, /socket\.create_connection/);
  assert.match(translator, /CODEX_PDF_BROKER_PORT/);
  assert.match(translator, /write_stdout\(answer\)/);
  assert.match(translator, /binary\.write\(payload\)/);
  const broker = await (await import("node:fs/promises")).readFile(
    new URL("../scripts/codex-batch-broker.py", import.meta.url), "utf8",
  );
  assert.match(broker, /CODEX_PDF_BATCH_MAX_FRAGMENTS/);
  assert.match(broker, /CODEX_PDF_BATCH_MAX_CHARS/);
  assert.match(broker, /CODEX_PDF_BATCH_MAX_FRAGMENTS", "32"/);
  assert.match(broker, /CODEX_PDF_BATCH_MAX_CHARS", "24000"/);
  assert.match(broker, /CODEX_PDF_BATCH_CONCURRENCY/);
  assert.match(broker, /def parse_batch_partial/);
  assert.match(broker, /batch_partial_fallback/);
  assert.match(broker, /await asyncio\.gather/);
  assert.match(broker, /"kind": "fragment"/);
  assert.match(broker, /CBR_RESULT_/);
  assert.match(broker, /CREATE_NO_WINDOW/);
  assert.match(broker, /def run_openai_compatible_api\(prompt: str\)/);
  assert.match(broker, /CODEX_PDF_API_BASE_URL/);
  assert.match(broker, /CODEX_PDF_API_MODEL/);
  assert.match(broker, /Authorization/);
  assert.match(broker, /urllib\.request\.urlopen/);
});

test("tasks retain attachment identity so the item pane can show live status", () => {
  const task = taskMetrics.createTask({ title: "Paper", attachmentID: 42 });
  assert.equal(task.attachmentID, 42);
});

test("task center offers persistent batch selection and direct cancellation", async () => {
  const source = await (await import("node:fs/promises")).readFile(
    new URL("../addon/content/task-center.js", import.meta.url), "utf8",
  );
  assert.match(source, /const selectedIDs = new Set\(\)/);
  assert.match(source, /createElementNS\("http:\/\/www\.w3\.org\/1999\/xhtml", "input"\)/);
  assert.match(source, /checkbox\.className = "task-select"/);
  assert.match(source, /task-center-select-all/);
  assert.match(source, /class="task-cancel"/);
  assert.match(source, /function taskAPI\(\)/);
  assert.match(source, /async function stopTask\(taskID\)/);
  assert.match(source, /async function refreshSafely\(\)/);
  assert.match(source, /async function localTasks\(\)/);
  assert.match(source, /async function markStoppedLocally\(taskID\)/);
  assert.match(source, /已由用户确认外部进程停止/);
  assert.match(source, /task-center-mark-stopped/);
  assert.match(source, /task-center-cancel"\)\.disabled/);
  assert.match(source, /function updateActionState\(selected\)/);
  assert.match(source, /const canMarkStopped/);
  assert.match(source, /row\.setAttribute\("aria-selected"/);
  assert.match(source, /已复制 \$\{selectedIDs\.size\} 个任务 ID/);
  assert.match(source, /copyTextToClipboard/);
  assert.doesNotMatch(source, /Services\.clipboard\.copyString/);
  assert.match(source, /该任务没有可查看的翻译结果/);
  assert.match(source, /Array\.from\(body\.children\).*\.focus\(\)/s);
  assert.match(source, /const progressText/);
  assert.match(source, /待翻译（批量队列）/);
  assert.match(source, /检查点已保存/);
  assert.match(source, /初始估算 \$\{estimated\} 段偏小/);
  assert.match(source, /正在提取版式与段落/);
  assert.match(source, /初始预计 \$\{estimated\} 段/);
  assert.match(source, /Date\.now\(\) - Date\.parse\(task\.startedAt\)/);
  assert.match(source, /disabled=\\"disabled\\"/);
  const layout = await (await import("node:fs/promises")).readFile(
    new URL("../addon/content/task-center.xhtml", import.meta.url), "utf8",
  );
  assert.match(layout, /id="task-center-scroll"/);
  assert.match(layout, /min-height:0; height:0; flex:1 1 auto/);
  assert.match(layout, /id="task-center-actions"/);
  assert.match(layout, /id="task-center-select-all"/);
  assert.match(layout, /取消选中任务/);
  assert.match(layout, /flex:0 0 auto/);
});

test("menus, item pane, and manual PDF width adjustment expose the requested controls", async () => {
  const main = await (await import("node:fs/promises")).readFile(
    new URL("../src/main.js", import.meta.url), "utf8",
  );
  assert.match(main, /function dualInnerTrimPoints/);
  assert.match(main, /async function adjustBilingualPdfWidth/);
  assert.match(main, /const engineDualPdf = String\(runnerResult\.engineDualPdf/);
  assert.match(main, /const sourceAttachmentIDs = new Set/);
  assert.match(main, /candidateResult = PathUtils\.join\(candidate\.outputDirectory/);
  assert.match(main, /不会重新翻译/);
  assert.match(main, /tasks\.textContent = "任务管理"/);
  assert.match(main, /widthButton\.textContent = "应用页面宽度"/);
  assert.match(main, /reopenButton\.textContent = "刷新并重新打开"/);
  assert.match(main, /async function refreshBilingualPdfReader\(item\)/);
  assert.match(main, /Zotero\.Reader\._readers\.filter\(\(entry\) => entry\.itemID === target\.id\)/);
  assert.match(main, /for \(const reader of readers\) \{\s+reader\.close\(\);/);
  assert.doesNotMatch(main, /win\.Zotero_Tabs\.close\(reader\.tabID\)/);
  assert.match(main, /pdfPreviewCache\.delete\(target\.id\)/);
  assert.match(main, /readers\.every\(\(entry\) => !Zotero\.Reader\._readers\.includes\(entry\)\)/);
  assert.match(main, /旧的双语 PDF 阅读器未能在 5 秒内关闭/);
  assert.match(main, /const reopened = await Zotero\.Reader\.open\([\s\S]*?\{ allowDuplicate: true \}/);
  assert.match(main, /const reopenedTab = reopened\?\.tabID \? ownerTabs\?\._getTab\(reopened\.tabID\)\?\.tab : null/);
  assert.match(main, /if \(!reopenedTab\) throw new Error\("Zotero 未能创建新的双语 PDF 阅读器标签。"\)/);
  assert.match(main, /ownerTabs\.select\(reopened\.tabID\)/);
  assert.match(main, /async function bilingualPdfPreviewDataURL\(attachment, doc, sourceReader = null\)/);
  assert.match(main, /const reader = sourceReader \|\| await Zotero\.Reader\.open/);
  assert.match(main, /if \(!sourceReader && reader\?\.tabID\) reader\.close\(\)/);
  assert.match(main, /const \{ reader \} = await refreshBilingualPdfReader\(item\)/);
  assert.match(main, /await refreshPreview\(reader\)/);
  assert.match(main, /await refreshBilingualPdfReader\(item\);/);
  assert.match(main, /item\.setAttribute\("image", "chrome:\/\/codex-bilingual\/content\/icons\/icon-16\.svg"\)/);
  assert.match(main, /adjustBilingualPdfWidth,/);
  assert.match(main, /refreshBilingualPdfReader,/);
  assert.match(main, /function isBilingualPdf\(item\)/);
  assert.match(main, /function registerPreferredBilingualOpen\(win\)/);
  assert.match(main, /tree\.addEventListener\("dblclick", handler, true\)/);
  assert.match(main, /closest\?\.\('\[role="treeitem"\]'\)/);
  assert.match(main, /closest\('\[id\^="zotero-items-tree-row-"\]'\)/);
  assert.match(main, /win\.ZoteroPane\.itemsView\?\.getRow\(rowIndex\)\?\.ref/);
  assert.match(main, /getPref\("preferredOpenAttachment", "bilingual"\).*=== "original"/);
  assert.match(main, /await win\.ZoteroPane\.viewAttachment\(bilingualPdf\.id, event\)/);
  assert.match(main, /await win\.ZoteroPane\.viewAttachment\(originalPdf\.id, event\)/);
  assert.match(main, /双语 PDF 暂时无法打开，已改为打开原始 PDF/);
  assert.match(main, /unregisterPreferredBilingualOpen\(win\)/);
  assert.match(main, /已有双语 PDF（不会重复生成）/);
  assert.match(main, /已检测到双语 PDF.*不会重复生成/s);
  assert.match(main, /function normalizeTranslationItems\(items\)/);
  assert.match(main, /async function translatePreservedPdfItems\(items\)/);
  assert.match(main, /const queuedTaskIDs = new Set\(\)/);
  assert.match(main, /const task = createPreservedPdfTask\(attachment\)/);
  assert.match(main, /queue\.push\(\{ item, task \}\)/);
  assert.match(main, /translatePreservedPdfItem\(entry\.item, current\)/);
  assert.match(main, /待翻译 \$\{queuedCount\} 篇/);
  assert.match(main, /function runSelectedTranslations\(win, items\)/);
  assert.match(main, /function registerMultiSelectionPaneRefresh\(win\)/);
  assert.match(main, /function syncMultiSelectionSidenav\(win\)/);
  assert.match(main, /function activateMultiSelectionPane\(win\)/);
  assert.match(main, /button\.dispatchEvent\(new win\.MouseEvent\("click"/);
  assert.match(main, /button\.parentElement\.hidden = false/);
  assert.match(main, /deck\.selectedPanel = details/);
  assert.match(main, /setTimeout\(showBatchPane, 0\)/);
  assert.match(main, /win\.document\.addEventListener\("click", clickHandler, true\)/);
  assert.match(main, /win\.document\.removeEventListener\("click", win\._codexBilingualMultiClickHandler, true\)/);
  assert.match(main, /_codexBilingualMultiClickHandler/);
  assert.match(main, /forceUpdateSideNav/);
  assert.match(main, /view\.onSelect\.addListener\(handler\)/);
  assert.match(main, /setTimeout\(applySelection, 150\)/);
  assert.match(main, /_codexBilingualSelectionTimer/);
  assert.match(main, /view\._codexBilingualSelectionCount > 1/);
  assert.match(main, /function unregisterMultiSelectionPaneRefresh\(win\)/);
  assert.match(main, /view\.onSelect\.removeListener\(handler\)/);
  assert.match(main, /function renderBatchPane\(\{ body, items, doc \}\)/);
  assert.match(main, /批量生成保真中英对照/);
  assert.match(main, /批量任务将逐篇执行/);
  assert.match(main, /selected\.length > 1 \|\| Boolean/);
  assert.match(main, /querySelectorAll\("item-pane-custom-section"\)/);
  assert.match(main, /void section\._handleRefresh\(\)/);
  assert.match(main, /translatePreservedPdfItems,/);
  assert.match(main, /async function bilingualPdfPreviewDataURL\(attachment, doc, sourceReader = null\)/);
  assert.match(main, /openInBackground: true, allowDuplicate: true/);
  assert.match(main, /\.page\[data-page-number="1"\] canvas/);
  assert.match(main, /previewImage\.alt = "双语 PDF 第一页预览"/);
  assert.match(main, /现有双语 PDF 预览/);
  assert.match(main, /previewImage\.src = dataURL/);
  assert.match(main, /void refreshPreview\(\);/);
});

test("artifact exporter only produces explicitly requested companion formats", async () => {
  const exporter = await (await import("node:fs/promises")).readFile(
    new URL("../scripts/export-bilingual-artifacts.mjs", import.meta.url), "utf8",
  );
  assert.match(exporter, /pdftoppm/);
  assert.match(exporter, /pdftotext/);
  assert.match(exporter, /render-pages-to-docx\.py/);
  assert.match(exporter, /requestedFormats\.has\("html"\)/);
  assert.match(exporter, /requestedFormats\.has\("markdown"\)/);
  assert.match(exporter, /requestedFormats\.has\("docx"\)/);
  assert.match(exporter, /EXPORTS_JSON/);
});

test("preserved PDF jobs have durable, resumable stage events", () => {
  const job = preservedPdfWorkflow.createJob({
    sourceFingerprint: "sha256:original",
    engine: "pdfmathtranslate-next",
    translationProvider: "codex-openai-bridge",
    createdAt: "2026-08-14T00:00:00.000Z",
  });
  const translating = preservedPdfWorkflow.appendEvent(job, {
    stage: "translation",
    completed: 4,
    total: 10,
  });
  assert.equal(translating.status, "translation");
  assert.equal(preservedPdfWorkflow.progressOf(translating), 0.4);
  assert.equal(preservedPdfWorkflow.canResume(translating, {
    sourceFingerprint: "sha256:original",
    engine: "pdfmathtranslate-next",
    translationProvider: "codex-openai-bridge",
  }), true);
  assert.equal(preservedPdfWorkflow.canResume(translating, {
    sourceFingerprint: "sha256:different",
    engine: "pdfmathtranslate-next",
    translationProvider: "codex-openai-bridge",
  }), false);
});

test("task metrics prefer provider usage and calculate configurable cost", () => {
  const usage = taskMetrics.normalizeUsage({ prompt_tokens: 1250, completion_tokens: 750 }, "ignored", "ignored");
  assert.deepEqual(usage, { inputTokens: 1250, outputTokens: 750, source: "actual" });
  let task = taskMetrics.createTask({
    id: "job-1", title: "Paper", pricing: { unit: "million", currency: "USD", inputPrice: 2, outputPrice: 8 },
    createdAt: "2026-08-14T00:00:00.000Z",
  });
  task = taskMetrics.updateTask(task, { startedAt: "2026-08-14T00:00:00.000Z", status: "running", stage: "translation" }, Date.parse("2026-08-14T00:00:01.000Z"));
  task = taskMetrics.addUsage(task, usage, Date.parse("2026-08-14T00:00:02.000Z"));
  assert.equal(task.elapsedMs, 2000);
  assert.equal(task.cost.totalCost, 0.0085);
  assert.equal(task.tokenUsage.source, "actual");
  assert.equal(task.pricing.currency, "USD");
  assert.equal(taskMetrics.calculateCost({
    inputTokens: 2, outputTokens: 3, pricing: { unit: "thousand", inputPrice: 1, outputPrice: 2 },
  }).totalCost, 0.008);
});

test("reader layout supports placing translation on the left", () => {
  const html = pipeline.renderBilingualHTML({
    title: "Paper", generatedAt: "now", translationSide: "left",
    segments: [{ id: "p1-s1", page: 1, source: "Source", translation: "译文" }],
  });
  assert.match(html, /translation-left/);
  assert.match(html, /中文翻译<\/span><span>Original/);
});

test("official provider prices parse into selected token units", () => {
  const openAI = officialPricing.parseOpenAIStandardPrice(
    "| Model | Input | Cached | Cache write | Output |\n| gpt-5-mini | $0.25 | $0.025 | - | $2.00 |", "gpt-5-mini",
  );
  assert.deepEqual(openAI, { inputPrice: 0.25, outputPrice: 2, unit: "million", currency: "USD" });
  assert.deepEqual(officialPricing.parseOpenRouterPrice({
    data: { pricing: { prompt: "0.0000025", completion: "0.00001" } },
  }), { inputPrice: 2.5, outputPrice: 10, unit: "million", currency: "USD" });
});

test("Codex OpenAI bridge accepts standard text messages without exposing a remote listener", () => {
  const options = parseArgs(["--port", "8765", "--model", "gpt-5.4-mini"]);
  assert.equal(options.port, 8765);
  assert.equal(options.model, "gpt-5.4-mini");
  assert.equal(options.allowRequestModel, false);
  assert.equal(requestText([
    { role: "system", content: "Keep <formula> unchanged." },
    { role: "user", content: [{ type: "text", text: "Translate this." }] },
  ]), "<system>\nKeep <formula> unchanged.\n</system>\n<user>\nTranslate this.\n</user>");
});
