<p align="center">
  <img src="addon/content/icons/icon.svg" width="112" alt="Codex Bilingual Reader logo">
</p>

<h1 align="center">Codex Bilingual Reader for Zotero</h1>

<p align="center">由 Codex 或 OpenAI 兼容 API 驱动的保排版中英论文翻译插件<br>Preserved-layout English/Chinese paper translation powered by Codex or OpenAI-compatible APIs</p>

<p align="center">
  <a href="https://github.com/Mengqi97/codex-bilingual-reader-for-zotero/releases/latest"><img src="https://img.shields.io/github/v/release/Mengqi97/codex-bilingual-reader-for-zotero" alt="Latest release"></a>
  <a href="https://github.com/Mengqi97/codex-bilingual-reader-for-zotero/actions/workflows/ci.yml"><img src="https://github.com/Mengqi97/codex-bilingual-reader-for-zotero/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Mengqi97/codex-bilingual-reader-for-zotero" alt="MIT license"></a>
</p>

<p align="center"><a href="#中文">简体中文</a> · <a href="#english">English</a></p>

## 中文

Codex Bilingual Reader 是一个适用于 Zotero 8/9 的 MIT 开源插件。它可通过本地已登录的 Codex CLI，或 OpenAI、DeepSeek 等 OpenAI 兼容 API，将 PDF 附件转换为**保留原排版的中英对照 PDF**。生成结果会作为独立的 Zotero 子附件自动导入，原始 PDF 始终不会被修改。

### 核心功能

- **保排版中英对照 PDF**：保留图片、公式、表格、可选择文字和页面几何结构，并将英文与中文并列排版。
- **Codex 与多种 API 后端**：支持本地 Codex CLI、OpenAI、DeepSeek 及其他 OpenAI 兼容接口。
- **单篇与批量翻译**：支持翻译单篇论文或批量加入队列，并显示运行、等待、取消和断点续传状态。
- **原生 Zotero 操作入口**：可从工具菜单、条目右键菜单或右侧面板启动；完成后自动导入双语 PDF。
- **任务与费用统计**：集中查看页数/片段进度、运行时间、实际 API Token 用量、可配置价格及失败信息。
- **双语 PDF 设置**：可选择译文位于左侧或右侧、默认打开原文或双语附件、预览输出，并可单独调整中缝宽度而无需重新翻译。

### 效果展示

![ActPlan-1K 保排版中英对照 PDF](docs/assets/actplan-bilingual-preview.png)

上图中英文位于左侧，可选择的中文译文位于右侧；图片、公式、表格和页面结构均得到保留。

### 安装

1. 从[最新 GitHub Release](https://github.com/Mengqi97/codex-bilingual-reader-for-zotero/releases/latest)下载 `codex-bilingual-reader.xpi`。
2. 在 Zotero 中打开**工具 → 附加组件**，选择**从文件安装附加组件…**，然后选择下载的 XPI。
3. 克隆或下载本仓库，并单独安装 PDFMathTranslate-next。打开**工具 → Codex 中英对照设置…**，选择本仓库根目录。由于许可证边界，MIT 许可证的 XPI 不会捆绑 AGPL 翻译引擎。
4. 选择本地 Codex CLI 或 OpenAI 兼容 API，配置模型和凭据，并在翻译前点击**测试连接**。

### 保排版 PDF 配置

首次翻译前，打开**工具 → Codex 中英对照设置…**，点击**选择工作目录并自动配置…**，然后选择本仓库根目录。插件会自动填写启动器和 PDFMathTranslate 路径并执行本地预检，也支持手动配置自定义路径。

启动器还需要 Python 3、`pdftoppm` 和 `pdftotext`，当前 Windows 安装会被自动检测。PDFMathTranslate-next/BabelDOC 使用 AGPL 许可证，因此它作为独立外部引擎运行，MIT 插件不会复制、捆绑或链接其代码。关于调用协议、隐私边界、许可证边界和验收标准，请参阅[保排版 PDF 工作流](docs/PDF_PRESERVATION_WORKFLOW.md)。

### 使用入口与设置

选中论文后，可从以下任一入口启动翻译：

- **工具 → 使用 Codex 生成全文中英对照**
- 论文条目的右键菜单
- Zotero 右侧条目面板中的 **Codex 中英对照** 区域

可通过**编辑 → 设置 → Codex 中英对照**、**工具 → Codex 中英对照设置…**，或右侧面板的**翻译设置**按钮打开配置页面。

- **保排版 PDF（默认）**：Codex CLI 使用本地登录和所选推理强度；API 模式支持 OpenAI、DeepSeek 等 Chat Completions 兼容服务。
- **默认打开附件**：可选择双击论文时优先打开双语 PDF，或保持 Zotero 默认打开原始 PDF 的行为。
- **测试连接**：验证保排版启动器，并通过所选后端翻译一个最小测试句，不会发送论文正文。

### 安全与隐私

使用 Codex CLI 时，文本片段通过用户本地的 Codex 登录提交，插件不会读取或复制 Codex 凭据。使用 API 模式时，API Key 保存在本地 Zotero 首选项中，仅作为 Bearer 凭据发送到用户配置的 Base URL。无论使用哪种方式，论文文本都会发送给所选翻译服务商。

在 Windows 上，启动器通过标准输入将文档片段传给配置的 `codex.cmd` 或 `codex.exe`，不会把 PDF 文本拼接到 Shell 命令中。

### 已知限制

- 扫描型 PDF 不会由本插件执行 OCR，请先在 Zotero 或其他工具中完成 OCR。
- 保排版 PDF 需要单独安装 PDFMathTranslate-next，并具备可用的 Codex CLI 登录或 OpenAI 兼容 API 配置。
- 只有 API 服务返回标准 `usage` 对象时才能显示精确 Token 用量；Codex CLI 当前不提供权威 Token 统计。
- Zotero 全文缓存没有稳定的“段落到 PDF 坐标”映射，因此当前版本无法从双语内容精确跳转回 PDF 中的对应位置。
- Codex App Server 依赖有效的 `~/.codex/config.toml`；若出现 TOML 解析错误，需要先修复提示的配置行。

### 开发

环境要求：Node.js 20+、Python 3、Zotero 8+。

```powershell
npm run check
npm test
npm run build
```

构建产物位于 `build/codex-bilingual-reader.xpi`。

---

## English

Codex Bilingual Reader is an MIT-licensed plugin for Zotero 8/9. It converts PDF attachments into **preserved-layout English/Chinese PDFs** using either the locally authenticated Codex CLI or an OpenAI-compatible API such as OpenAI or DeepSeek. The generated PDF is imported automatically as a separate Zotero child attachment, and the original PDF is never modified.

### Core features

- **Preserved-layout bilingual PDF** — retains figures, formulas, tables, selectable text, and page geometry while placing English and Chinese side by side.
- **Codex and multiple API backends** — supports the local Codex CLI, OpenAI, DeepSeek, and other OpenAI-compatible endpoints.
- **Single and batch translation** — translates one paper or queues multiple selected papers with running, waiting, cancellation, and resumable checkpoint states.
- **Native Zotero entry points** — starts from the Tools menu, item context menu, or right-hand pane and automatically imports completed PDFs.
- **Task and cost tracking** — displays page/fragment progress, elapsed time, actual API token usage, configurable pricing, and failures in one task center.
- **Bilingual PDF controls** — selects the translation side, preferred attachment on open, output preview, and center-gap adjustment without retranslating.

### Preview

![ActPlan-1K preserved-layout English-Chinese PDF](docs/assets/actplan-bilingual-preview.png)

English is preserved on the left and the translated, selectable Chinese page is placed on the right while figures, formulas, tables, and page geometry remain intact.

### Installation

1. Download `codex-bilingual-reader.xpi` from the [latest GitHub Release](https://github.com/Mengqi97/codex-bilingual-reader-for-zotero/releases/latest).
2. In Zotero, open **Tools → Add-ons**, choose **Install Add-on From File…**, and select the downloaded XPI.
3. Clone or download this repository and install PDFMathTranslate-next separately. Open **Tools → Codex 中英对照设置…** and select the repository root. The external AGPL engine is intentionally not bundled in the MIT-licensed XPI.
4. Select the locally authenticated Codex CLI or an OpenAI-compatible API, configure the model and credentials, and run **Test connection** before translating a paper.

### Preserved-layout PDF setup

Before the first translation, open **Tools → Codex 中英对照设置…**, click **选择工作目录并自动配置…**, and select this repository's root folder. The plugin fills the launcher and PDFMathTranslate paths and runs a local preflight. Manual path entry remains available for custom layouts.

The launcher also requires Python 3, `pdftoppm`, and `pdftotext`; the current Windows installation is discovered automatically. PDFMathTranslate-next/BabelDOC runs as a separate external engine because it is AGPL-licensed. The MIT plugin does not copy, bundle, or link that engine. See [the preserved PDF workflow](docs/PDF_PRESERVATION_WORKFLOW.md) for provider contracts, privacy boundaries, license boundaries, and acceptance gates.

### Entry points and settings

With a paper selected, start translation from any of these entries:

- **Tools → 使用 Codex 生成全文中英对照**
- The paper item's context menu
- The **Codex 中英对照** section in Zotero's right-hand item pane

Open settings through **Edit → Settings → Codex 中英对照**, **Tools → Codex 中英对照设置…**, or the **翻译设置** button in the right-hand pane.

- **Preserved PDF (default)** — Codex CLI uses the local login and selected reasoning level; API mode supports OpenAI, DeepSeek, and other Chat Completions-compatible providers.
- **Default open attachment** — chooses whether double-clicking a paper prefers its bilingual PDF or retains Zotero's original-PDF behavior.
- **Test connection** — validates the preserved-PDF launcher and translates one minimal test sentence through the selected backend without sending a document.

### Security and privacy

With Codex CLI, source fragments are submitted through the user's local Codex login, and the plugin never reads or copies Codex credentials. With API mode, the API key remains in the local Zotero preference profile and is sent only as a Bearer credential to the configured Base URL. In either mode, document text is sent to the selected translation provider.

On Windows, the launcher sends document fragments through stdin to the configured `codex.cmd` or `codex.exe`; it never interpolates PDF text into a shell command.

### Known limitations

- Scanned PDFs are not OCRed by this plugin. Run OCR in Zotero or another tool first.
- Preserved PDF output requires a separately installed PDFMathTranslate-next engine and either a valid Codex CLI login or a working OpenAI-compatible API configuration.
- Exact token usage is displayed only when an API provider returns a standard `usage` object. Codex CLI tasks do not currently expose authoritative token counts.
- Zotero's full-text cache does not retain a robust paragraph-to-PDF coordinate map, so the current version cannot jump from bilingual content to the exact corresponding PDF location.
- The Codex App Server requires a valid `~/.codex/config.toml`. Fix the reported configuration line before retrying if a TOML parse error occurs.

### Development

Requirements: Node.js 20+, Python 3, and Zotero 8+.

```powershell
npm run check
npm test
npm run build
```

The distributable is `build/codex-bilingual-reader.xpi`.
