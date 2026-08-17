# 保真 PDF 翻译工作流

## 目标与边界

本项目的目标不是把 PDF 提取为纯文本后重新排版，而是生成一个可在 Zotero 中作为子附件打开的**双语 PDF**：原有图片、矢量图、公式、页码、引文和大部分页面布局保持在 PDF 中，翻译只替换或补充可翻译的文本区域。

这与现有 HTML 对照阅读器互补：

| 阅读模式 | 适用场景 | 保留能力 |
| --- | --- | --- |
| HTML 段落对照 | 快速读、复制、检索、逐段比对 | 只保留全文索引里的文本 |
| 保真双语 PDF | 论文精读、公式、图表、版式 | 原 PDF 图形对象与布局尽可能保留 |

保真模式不能承诺“翻译图片内的一切文字”。图片和图表会原样保留；图注、正文、表格中的可提取文字由文档引擎翻译。图片内坐标轴、图例、流程图文字的翻译属于独立的图像 OCR + 局部覆盖能力，必须明确作为可选后处理，不能在普通保真模式中假称已翻译。

## 为什么采用 Harness 思路

借鉴 DeepSeek Harness (DSH) 的可组合设计，而不把 DSH 本体嵌入 Zotero：每项能力有稳定接口、可替换实现和可恢复状态。DSH 仍是 developer preview，直接依赖会将其破坏性升级风险带入 Zotero 插件。

```text
Zotero 命令 / 右侧栏
        |
        v
PDF Translation Job (持久化状态机)
        |
        +-- DocumentEngineProvider
        |     +-- pdfmathtranslate-next (首选外部后端)
        |     +-- future: 自研解析器 / 其他本地服务
        |
        +-- TranslationProvider
        |     +-- CodexOpenAICompatBridge (本机 Codex 登录态)
        |     +-- OpenAI-compatible API (用户自配密钥)
        |
        +-- ArtifactProvider
              +-- 验证 *_dual.pdf
              +-- 导入 Zotero 子附件
              +-- 记录产物、日志与可重试阶段
```

## Provider 契约

### DocumentEngineProvider

输入：原 PDF 绝对路径、输出目录、语言、翻译服务地址、模型名和兼容性选项。

输出必须包含：

```json
{
  "dualPdfPath": "C:/.../paper_dual.pdf",
  "translatedPdfPath": "C:/.../paper_mono.pdf",
  "engine": "pdfmathtranslate-next",
  "warnings": [],
  "stages": ["layout", "translate", "render", "validate"]
}
```

首选实现是将 `pdf2zh_next` 作为**外部进程**调用，而非复制其源码。它基于 BabelDOC，公开声明可保留公式、图表、目录和注释，并提供双语输出。其源码为 AGPL-3.0；当前 Zotero 插件为 MIT，因此只能通过用户安装的命令行程序或本地 HTTP 进程对接，不能把其代码复制、链接或打包进本项目。

保守的初始调用形态：

```text
pdf2zh_next <input.pdf> --output <job-output> --lang-in en --lang-out zh-CN \
  --openai --qps 1 --pool-max-workers 1 --enhance-compatibility
```

默认单并发是为 Codex Bridge 设计的。文档引擎的并发翻译池若直接设为几十，会同时创建大量 Codex 线程，导致超时、限流和结果难以恢复。

### TranslationProvider：Codex OpenAI-compatible Bridge

PDFMathTranslate 使用 OpenAI-compatible Chat Completions 服务。Codex App Server 使用 JSON-RPC 和本机登录态，二者不能直接连接。因此需要一个只监听 `127.0.0.1` 的 Bridge：

```text
POST /v1/chat/completions
  -> request queue (默认并发 1)
  -> Codex App Server: thread/start + turn/start
  -> 收集 agent message
  -> OpenAI Chat Completions JSON response
```

Bridge 的强制约束：

- 只绑定回环地址，不暴露局域网端口。
- 用随机本地 Bearer token；PDF 引擎通过环境变量提供该 token。
- 不读取、不导出 Codex 的 `auth.json`；只启动已登录的 `codex app-server`。
- 传入的 system prompt、术语表和原文按顺序拼入 Codex 请求；保留文档引擎的公式占位符与标记。
- 默认队列并发为 1、单请求超时为 120 秒、失败返回标准 OpenAI `error` 对象。
- 每个请求完成后归档临时 Codex thread；日志只保存阶段、耗时和错误摘要，不保存论文正文。

PDFMathTranslate 使用该 Bridge 时的环境变量概念如下：

```text
OPENAI_BASE_URL=http://127.0.0.1:<port>/v1
OPENAI_API_KEY=<bridge-local-token>
OPENAI_MODEL=<已验证的 Codex 模型，例如 gpt-5.4-mini>
```

模型名由 Bridge 映射到 Codex App Server 模型。Bridge 在启动时探测模型；未知或未验证的模型不能自动用于整篇论文。

### 已验证的 Windows 运行细节

在此机器上使用 `pdf2zh-next 2.9.0` 已完成测试。该版本的服务开关是 `--openaicompatible`（无连字符），但其参数仍使用 `--openai-compatible-base-url`、`--openai-compatible-api-key` 和 `--openai-compatible-model`。

首次运行会下载 BabelDOC 的布局 ONNX 模型、字体和 CMap 资产。应单独执行预热并把 PDF 引擎的 `HOME` / `USERPROFILE` 指向一个可写缓存目录；**不要**把它同时用作 `CODEX_HOME`。Bridge 必须显式指向真实 Codex 登录目录（通常是 `C:\Users\<user>\.codex`）。

本项目中的 `scripts/run-preserved-pdf-smoke.mjs` 可在不接触用户 PDF 的前提下复现验证：它使用仓库内的双栏、公式、矢量图和表格样例，生成双语 PDF；`scripts/verify-preserved-pdf.py` 做结构核验。

### Job 与事件日志

每个 PDF 在 Zotero 附件存储目录中维护一个 JSON job 文件，采用追加阶段而不是“运行中内存状态”：

```json
{
  "schemaVersion": 1,
  "sourceFingerprint": "sha256:...",
  "status": "rendering",
  "engine": "pdfmathtranslate-next",
  "events": [
    {"at": "...", "stage": "queued"},
    {"at": "...", "stage": "layout"},
    {"at": "...", "stage": "translation", "completed": 37, "total": 124}
  ]
}
```

恢复规则：同一 PDF 指纹、同一 engine 与相同翻译配置可以恢复；源 PDF、模型或语言发生变化则新建 job。Zotero 重启后可以从 `events` 恢复右侧栏进度和“继续 / 查看日志 / 导入已生成 PDF”操作。

## PDF 处理策略

### 数字原生论文（首选）

1. 保持原 PDF，不修改、不删除。
2. Document engine 从 PDF 文本对象和布局区域建立中间表示。
3. 公式区域、引用编号、URL、DOI、代码、图片区域受保护，不发送给翻译模型。
4. 将正文、标题、图注和可用表格文字发往 TranslationProvider。
5. 根据原文字框和字体属性回写译文，生成单语 PDF 与双语 PDF。
6. 使用 PDF 解析库重新打开输出文件，验证页数、文件大小和 PDF 结构；成功后才导入 Zotero。

### 扫描 PDF

扫描件必须先取得高质量文本层。优先让用户使用 OCRmyPDF、ABBYY 或 Acrobat 生成一个新的、可检索的 PDF，再进入保真翻译流程。深度 OCR 也可作为可选识别 Provider，但不应默认替代原 PDF：把每页栅格化再重新拼成 PDF 会牺牲原生矢量公式、字体和链接层。

### 图中文字（后续可选 Provider）

若需要翻译图例、坐标轴、流程图文字，应添加 `FigureTextProvider`：区域检测 -> OCR -> 翻译 -> 用户审阅 -> 局部覆盖。此能力必须默认关闭，原因是会覆盖原图像素且可能改变科学图的语义；输出应标注“图中文字已覆盖翻译”。

## Zotero 交互

右侧栏使用以下状态，而不是只显示一个“翻译”按钮：

```text
未配置 -> 检测保真后端 -> 准备 PDF -> 解析布局 -> 翻译 37/124
        -> 回写 PDF -> 验证输出 -> 已导入双语 PDF / 失败可继续
```

完成后将 `*_dual.pdf` 作为原文条目的子附件导入；原 PDF 永远保留。HTML 对照页继续作为“快速阅读”选项，而不是保真模式的替代品。

## 验收门槛

一个后端只有同时满足以下条件才可以在插件中标记为“可用”：

1. Bridge 健康检查实际通过选定 Codex 模型的短翻译。
2. 用一篇含行内公式、显示公式、矢量图、位图、两栏文本和表格的 PDF 跑完端到端。
3. 生成并重新打开双语 PDF；页数与原件一致，所有页面可渲染。
4. 人工检查至少：公式未被译坏、图像仍存在、图注有译文、两栏阅读顺序未明显错乱。
5. Zotero 子附件导入成功，并且原 PDF 的 hash 未改变。
6. 中断后重启 Zotero，可从 job 状态查看失败阶段或继续，不会重复导入相同产物。

## 参考

- DeepSeek Harness architecture: https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md
- PDFMathTranslate-next: https://github.com/PDFMathTranslate/PDFMathTranslate-next
- PDFMathTranslate advanced options: https://pdf2zh-next.com/advanced/advanced.html
- BabelDOC: https://github.com/funstory-ai/BabelDOC
