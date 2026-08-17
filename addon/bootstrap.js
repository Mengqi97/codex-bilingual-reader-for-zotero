function startup(data, reason) {
  const rootURI = data.rootURI || data.resourceURI.spec;
  const { Subprocess } = ChromeUtils.importESModule(
    "resource://gre/modules/Subprocess.sys.mjs",
  );
  const { FilePicker } = ChromeUtils.importESModule(
    "chrome://zotero/content/modules/filePicker.mjs",
  );
  const aomStartup = Cc["@mozilla.org/addons/addon-manager-startup;1"]
    .getService(Ci.amIAddonManagerStartup);
  globalThis.codexBilingualChromeHandle = aomStartup.registerChrome(
    Services.io.newURI(`${rootURI}manifest.json`),
    [["content", "codex-bilingual", `${rootURI}content/`]],
  );
  const context = { rootURI, Subprocess, FilePicker };
  Services.scriptloader.loadSubScript(
    `${rootURI}content/scripts/pipeline.js`,
    context,
  );
  Services.scriptloader.loadSubScript(
    `${rootURI}content/scripts/preserved-pdf-workflow.js`,
    context,
  );
  Services.scriptloader.loadSubScript(
    `${rootURI}content/scripts/task-metrics.js`,
    context,
  );
  Services.scriptloader.loadSubScript(
    `${rootURI}content/scripts/official-pricing.js`,
    context,
  );
  Services.scriptloader.loadSubScript(
    `${rootURI}content/scripts/main.js`,
    context,
  );
  globalThis.codexBilingualContext = context;
  Zotero.CodexBilingual = context.CodexBilingual;
  context.CodexBilingual.startup();
}

function shutdown(data, reason) {
  globalThis.codexBilingualContext?.CodexBilingual?.shutdown();
  globalThis.codexBilingualChromeHandle?.destruct();
  delete globalThis.codexBilingualContext;
  delete globalThis.codexBilingualChromeHandle;
  delete Zotero.CodexBilingual;
}

function onMainWindowLoad({ window }, reason) {
  globalThis.codexBilingualContext?.CodexBilingual?.onMainWindowLoad(window, reason);
}

function onMainWindowUnload({ window }, reason) {
  globalThis.codexBilingualContext?.CodexBilingual?.onMainWindowUnload(window, reason);
}

function onPrefsLoad({ window }, reason) {
  globalThis.codexBilingualContext?.CodexBilingual?.onPrefsLoad(window, reason);
}

function install(data, reason) {}

function uninstall(data, reason) {}
