# Changelog

## 1.4.6 - 2026-10-20

- Support Zotero 10: raise `strict_max_version` from `9.*` to `10.*` so the add-on installs and stays enabled on Zotero 10.0.x.
- Verified against Zotero 10.0.6 (Gecko 140): bootstrap startup, preference-pane registration and item-pane/custom-section hooks load without errors.
- Checked for API drift against the Zotero 10.0.6 source; `PreferencePanes`, `ItemPaneManager`, `Reader.open`, `Reader._readers`, `FullText`, `Attachments`, `ProgressWindow` and the `menu_ToolsPopup` / `zotero-itemmenu` anchors are unchanged.

## 1.3.71 - 2026-08-17

- Generate selectable preserved-layout English/Chinese PDFs and import them into Zotero.
- Translate with local Codex CLI or OpenAI-compatible APIs including OpenAI and DeepSeek.
- Batch selected papers with running and waiting task states, cancellation, checkpoints, and resumable translation.
- Track page/fragment progress, elapsed time, actual API token usage, and configurable cost.
- Add Zotero Tools, context-menu, and right-pane integrations with bilingual-PDF preview and center-gap adjustment.
