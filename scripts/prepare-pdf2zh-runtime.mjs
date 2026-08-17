import { access, copyFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function preparePdf2zhRuntime(portableRoot) {
  const target = resolve(portableRoot, "site-packages", "babeldoc", "docvision", "doclayout.py");
  const backup = `${target}.codex-bilingual-reader.cpu-backup`;
  let source = await readFile(target, "utf8");
  let patchedProvider = false;
  const oldImports = "import logging\nimport platform\nimport re\n";
  const oldProvider = `        else:\n            for provider in available_providers:\n                # disable dml|cuda|\n                # directml/cuda may encounter problems under special circumstances\n                if re.match(r"cpu", provider, re.IGNORECASE):\n                    logger.info(f"Available Provider: {provider}")\n                    providers.append(provider)\n`;
  const newProvider = `        else:\n            preferred = os.environ.get("CODEX_PDF_LAYOUT_PROVIDER", "cpu").lower()\n            if preferred == "dml" and "DmlExecutionProvider" in available_providers:\n                providers = ["DmlExecutionProvider", "CPUExecutionProvider"]\n                logger.info("Available Provider: DmlExecutionProvider with CPU fallback")\n            else:\n                for provider in available_providers:\n                    if re.match(r"cpu", provider, re.IGNORECASE):\n                        logger.info(f"Available Provider: {provider}")\n                        providers.append(provider)\n`;
  if (!source.includes("CODEX_PDF_LAYOUT_PROVIDER")) {
    if (!source.includes(oldImports) || !source.includes(oldProvider)) {
      throw new Error("Installed BabelDOC doclayout.py does not match the supported DirectML patch");
    }
    source = source.replace(oldImports, `import logging\nimport os\nimport platform\nimport re\n`).replace(oldProvider, newProvider);
    try { await access(backup); } catch (_error) { await copyFile(target, backup); }
    await writeFile(target, source, "utf8");
    patchedProvider = true;
  }

  const mainTarget = resolve(portableRoot, "site-packages", "pdf2zh_next", "main.py");
  const mainBackup = `${mainTarget}.codex-bilingual-reader.encoding-backup`;
  let mainSource = await readFile(mainTarget, "utf8");
  let patchedEncoding = false;
  if (!mainSource.includes("CODEX_BILINGUAL_UTF8_STDIO")) {
    const anchor = /import sys\r?\nfrom pathlib import Path\r?\n/;
    const replacement = `import sys\nfrom pathlib import Path\n\n# CODEX_BILINGUAL_UTF8_STDIO\nfor _stream in (sys.stdout, sys.stderr):\n    try:\n        _stream.reconfigure(encoding="utf-8", errors="backslashreplace")\n    except (AttributeError, OSError):\n        pass\n`;
    if (!anchor.test(mainSource)) throw new Error("Installed pdf2zh_next/main.py does not match the UTF-8 patch");
    mainSource = mainSource.replace(anchor, replacement);
    try { await access(mainBackup); } catch (_error) { await copyFile(mainTarget, mainBackup); }
    await writeFile(mainTarget, mainSource, "utf8");
    patchedEncoding = true;
  }
  return { patchedProvider, patchedEncoding, target };
}
