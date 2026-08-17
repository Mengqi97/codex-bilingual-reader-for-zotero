/* global Zotero, window, document */
(function () {
  function load() {
    const prefix = "extensions.zotero.codex-bilingual-reader.";
    const get = (key, fallback = "") => {
      try { return Zotero.Prefs.get(prefix + key, true) ?? fallback; } catch (_error) { return fallback; }
    };
    const set = (key, value) => Zotero.Prefs.set(prefix + key, value, true);
    const asBoolean = (value) => value === true || value === 1 || value === "1" || value === "true";
    const fields = [
      ["codex-bilingual-backend", "backend"],
      ["codex-bilingual-preserved-pdf-launcher", "preservedPdfLauncherPath"],
      ["codex-bilingual-preserved-pdf-engine", "preservedPdfEnginePath"],
      ["codex-bilingual-preserved-pdf-python", "preservedPdfPythonPath"],
      ["codex-bilingual-preserved-pdf-reasoning", "preservedPdfReasoning"],
      ["codex-bilingual-cli-path", "cliPath"],
      ["codex-bilingual-node-path", "cliNodePath"],
      ["codex-bilingual-home-path", "cliHomePath"],
      ["codex-bilingual-cli-model", "cliModel"],
      ["codex-bilingual-app-server-model", "appServerModel"],
      ["codex-bilingual-app-server-reasoning", "appServerReasoningEffort"],
      ["codex-bilingual-api-base-url", "apiBaseURL"],
      ["codex-bilingual-api-provider", "apiProvider"],
      ["codex-bilingual-api-format", "apiFormat"],
      ["codex-bilingual-api-model", "apiModel"],
      ["codex-bilingual-api-key", "apiKey"],
      ["codex-bilingual-translation-side", "translationSide"],
      ["codex-bilingual-preferred-open-attachment", "preferredOpenAttachment"],
      ["codex-bilingual-dual-inner-trim-points", "dualInnerTrimPoints"],
      ["codex-bilingual-price-unit", "priceUnit"],
      ["codex-bilingual-price-currency", "priceCurrency"],
      ["codex-bilingual-input-token-price", "inputTokenPrice"],
      ["codex-bilingual-output-token-price", "outputTokenPrice"],
    ];
    const providers = {
      openai: { url: "https://api.openai.com/v1", models: ["gpt-5.1", "gpt-5-mini", "gpt-4.1"] },
      openrouter: { url: "https://openrouter.ai/api/v1", models: ["openai/gpt-5.1", "anthropic/claude-sonnet-4", "deepseek/deepseek-chat"] },
      deepseek: { url: "https://api.deepseek.com", models: ["deepseek-chat", "deepseek-reasoner"] },
      qwen: { url: "https://dashscope.aliyuncs.com/compatible-mode/v1", models: ["qwen-plus", "qwen-turbo", "qwen-max"] },
      ollama: { url: "http://127.0.0.1:11434/v1", models: ["qwen2.5:14b", "llama3.3", "deepseek-r1"] },
      lmstudio: { url: "http://127.0.0.1:1234/v1", models: [] },
      custom: { url: "", models: [] },
    };
    const provider = () => document.getElementById("codex-bilingual-api-provider")?.value || "custom";
    const setStatus = (text, color = "var(--fill-secondary, #666)") => {
      const status = document.getElementById("codex-bilingual-api-status");
      status.textContent = text;
      status.style.color = color;
    };
    const renderModelOptions = (models) => {
      const options = document.getElementById("codex-bilingual-api-model-options");
      options.replaceChildren();
      for (const model of ["", ...models]) {
        const option = document.createXULElement("menuitem");
        option.value = model;
        option.label = model || "手动填写模型名称";
        options.append(option);
      }
    };
    const applyProvider = () => {
      const selected = providers[provider()];
      const endpoint = document.getElementById("codex-bilingual-api-base-url");
      const format = document.getElementById("codex-bilingual-api-format");
      if (provider() !== "custom") endpoint.value = selected.url;
      format.value = "chat-completions";
      set("apiBaseURL", endpoint.value);
      set("apiFormat", format.value);
      renderModelOptions(selected.models);
      const model = document.getElementById("codex-bilingual-api-model");
      if (!model.value && selected.models[0]) {
        model.value = selected.models[0];
        set("apiModel", model.value);
      }
      setStatus(provider() === "custom" ? "请输入服务商提供的 Base URL、模型和密钥。" : "已应用服务商预设；可手动修改。", "var(--fill-secondary, #666)");
    };
    const updateVisibility = () => {
      const isAPI = document.getElementById("codex-bilingual-backend")?.value === "api";
      document.getElementById("codex-bilingual-cli-settings").hidden = isAPI;
      document.getElementById("codex-bilingual-api-settings").hidden = !isAPI;
      document.getElementById("codex-bilingual-app-server-settings").hidden =
        document.getElementById("codex-bilingual-backend")?.value !== "app-server";
      document.getElementById("codex-bilingual-preserved-pdf-settings").hidden = false;
    };
    const refreshPreservedPdfModelSource = async () => {
      const status = document.getElementById("codex-bilingual-preserved-pdf-model-source");
      if (!status) return;
      try {
        const source = await Zotero.CodexBilingual.preservedPdfModelSource();
        status.textContent = source.label;
        status.style.color = source.configured ? "var(--color-green-50, #238636)" : "var(--color-red-60, #c01c28)";
      } catch (error) {
        status.textContent = `无法读取 PDF 模型来源：${error.message || String(error)}`;
        status.style.color = "var(--color-red-60, #c01c28)";
      }
    };
    let appServerModels = [];
    const appServerStatus = (text, color = "var(--fill-secondary, #666)") => {
      const status = document.getElementById("codex-bilingual-app-server-status");
      status.textContent = text;
      status.style.color = color;
    };
    let officialPriceSource = String(get("officialPriceSource", ""));
    const officialPriceStatus = (text, color = "var(--fill-secondary, #666)") => {
      const status = document.getElementById("codex-bilingual-official-price-status");
      status.textContent = text;
      status.style.color = color;
      document.getElementById("codex-bilingual-open-official-price").disabled = !officialPriceSource;
    };
    const renderAppServerReasoning = () => {
      const model = appServerModels.find((entry) => entry.id === get("appServerModel"));
      const select = document.getElementById("codex-bilingual-app-server-reasoning");
      const options = document.getElementById("codex-bilingual-app-server-reasoning-options");
      options.replaceChildren();
      const efforts = model?.efforts?.length ? model.efforts : ["low", "medium", "high", "xhigh"];
      for (const effort of efforts) {
        const option = document.createXULElement("menuitem");
        option.value = effort;
        option.label = effort;
        options.append(option);
      }
      const saved = String(get("appServerReasoningEffort"));
      select.value = efforts.includes(saved) ? saved : (model?.defaultEffort || efforts[0]);
      set("appServerReasoningEffort", select.value);
    };
    const renderAppServerModels = (models) => {
      appServerModels = models;
      const select = document.getElementById("codex-bilingual-app-server-model");
      const options = document.getElementById("codex-bilingual-app-server-model-options");
      options.replaceChildren();
      for (const model of models) {
        const option = document.createXULElement("menuitem");
        option.value = model.id;
        option.label = model.label === model.id ? model.id : `${model.label} (${model.id})`;
        options.append(option);
      }
      const saved = String(get("appServerModel"));
      select.value = models.some((model) => model.id === saved) ? saved : models[0]?.id || "";
      set("appServerModel", select.value);
      renderAppServerReasoning();
    };
    for (const [id, key] of fields) {
      const field = document.getElementById(id);
      if (!field) continue;
      if (field.type === "checkbox") field.checked = asBoolean(get(key, false));
      else field.value = String(get(key));
      const persist = () => {
        set(key, field.type === "checkbox" ? field.checked : field.value);
        updateVisibility();
        if (["backend", "cliHomePath", "cliModel", "apiProvider", "apiBaseURL", "apiModel"].includes(key)) {
          void refreshPreservedPdfModelSource();
        }
      };
      field.addEventListener("change", persist);
      field.addEventListener("command", persist);
      field.addEventListener("input", () => {
        if (id !== "codex-bilingual-backend") persist();
      });
    }
    renderModelOptions(providers[provider()]?.models || []);
    document.getElementById("codex-bilingual-api-provider")?.addEventListener("command", () => {
      set("apiProvider", provider());
      applyProvider();
      void refreshPreservedPdfModelSource();
    });
    document.getElementById("codex-bilingual-api-model-preset")?.addEventListener("command", () => {
      const model = document.getElementById("codex-bilingual-api-model");
      const preset = document.getElementById("codex-bilingual-api-model-preset");
      if (preset.value) {
        model.value = preset.value;
        set("apiModel", model.value);
        void refreshPreservedPdfModelSource();
      }
    });
    document.getElementById("codex-bilingual-app-server-model")?.addEventListener("command", () => {
      const select = document.getElementById("codex-bilingual-app-server-model");
      set("appServerModel", select.value);
      renderAppServerReasoning();
    });
    document.getElementById("codex-bilingual-app-server-reasoning")?.addEventListener("command", () => {
      set("appServerReasoningEffort", document.getElementById("codex-bilingual-app-server-reasoning").value);
    });
    document.getElementById("codex-bilingual-install-runtime")?.addEventListener("command", async () => {
      const button = document.getElementById("codex-bilingual-install-runtime");
      const status = document.getElementById("codex-bilingual-runtime-install-status");
      button.disabled = true;
      const support = Zotero.CodexBilingual.platformSupport();
      status.textContent = support.platform === "macos"
        ? "正在检测 macOS 的 Node、Python、Codex 和 pdf2zh_next…"
        : "正在下载并安装官方 PDF 引擎（约 600 MB），请保持 Zotero 运行…";
      status.style.color = "var(--fill-secondary, #666)";
      try {
        const result = await Zotero.CodexBilingual.installPreservedPdfRuntime();
        document.getElementById("codex-bilingual-preserved-pdf-launcher").value = result.launcher;
        document.getElementById("codex-bilingual-preserved-pdf-engine").value = result.engine;
        document.getElementById("codex-bilingual-node-path").value = result.node;
        if (result.python) document.getElementById("codex-bilingual-preserved-pdf-python").value = result.python;
        if (result.codex) document.getElementById("codex-bilingual-cli-path").value = result.codex;
        status.textContent = result.platform === "macos" ? "macOS 依赖已自动识别并通过本地预检。" : "安装完成，路径已填写并通过本地预检。";
        status.style.color = "var(--color-green-50, #238636)";
      } catch (error) {
        status.textContent = `安装失败：${error.message || String(error)}`;
        status.style.color = "var(--color-red-60, #c01c28)";
      } finally {
        button.disabled = false;
      }
    });
    document.getElementById("codex-bilingual-select-pdf-workspace")?.addEventListener("command", async () => {
      const button = document.getElementById("codex-bilingual-select-pdf-workspace");
      const status = document.getElementById("codex-bilingual-pdf-workspace-status");
      button.disabled = true;
      status.textContent = "正在选择并检查工作目录…";
      status.style.color = "var(--fill-secondary, #666)";
      try {
        const result = await Zotero.CodexBilingual.selectPreservedPdfWorkspace();
        if (!result) {
          status.textContent = "已取消。";
          return;
        }
        document.getElementById("codex-bilingual-preserved-pdf-launcher").value = result.launcher;
        document.getElementById("codex-bilingual-preserved-pdf-engine").value = result.engine;
        if (result.python) document.getElementById("codex-bilingual-preserved-pdf-python").value = result.python;
        status.textContent = "已自动配置并完成保真 PDF 预检。";
        status.style.color = "var(--color-green-50, #238636)";
      } catch (error) {
        status.textContent = `自动配置失败：${error.message || String(error)}`;
        status.style.color = "var(--color-red-60, #c01c28)";
      } finally {
        button.disabled = false;
      }
    });
    document.getElementById("codex-bilingual-fetch-app-server-models")?.addEventListener("command", async () => {
      const button = document.getElementById("codex-bilingual-fetch-app-server-models");
      button.disabled = true;
      appServerStatus("正在加载 Codex 模型目录…");
      try {
        for (const [id, key] of fields) {
          const field = document.getElementById(id);
          if (field) set(key, field.value);
        }
        const models = await Zotero.CodexBilingual.fetchAppServerModels();
        renderAppServerModels(models);
        appServerStatus(`已加载 ${models.length} 个模型。`, "var(--color-green-50, #238636)");
      } catch (error) {
        appServerStatus(`加载失败：${error.message || String(error)}`, "var(--color-red-60, #c01c28)");
      } finally {
        button.disabled = false;
      }
    });
    document.getElementById("codex-bilingual-fetch-models")?.addEventListener("command", async () => {
      const button = document.getElementById("codex-bilingual-fetch-models");
      button.disabled = true;
      setStatus("正在获取模型…");
      try {
        for (const [id, key] of fields) {
          const field = document.getElementById(id);
          if (field) set(key, field.value);
        }
        const models = await Zotero.CodexBilingual.fetchModels();
        renderModelOptions(models);
        setStatus(`已获取 ${models.length} 个模型，请从“模型预设”选择或手动填写。`, "var(--color-green-50, #238636)");
      } catch (error) {
        setStatus(`获取失败：${error.message || String(error)}`, "var(--color-red-60, #c01c28)");
      } finally {
        button.disabled = false;
      }
    });
    document.getElementById("codex-bilingual-fetch-official-price")?.addEventListener("command", async () => {
      const button = document.getElementById("codex-bilingual-fetch-official-price");
      button.disabled = true;
      officialPriceStatus("正在读取官方价格…");
      try {
        for (const [id, key] of fields) {
          const field = document.getElementById(id);
          if (field) set(key, field.value);
        }
        const result = await Zotero.CodexBilingual.fetchOfficialPrice();
        officialPriceSource = result.sourceURL;
        set("officialPriceSource", result.sourceURL);
        if (result.manualOnly) {
          officialPriceStatus(`${result.sourceLabel}：${result.reason}`, "var(--fill-secondary, #666)");
        } else {
          document.getElementById("codex-bilingual-price-unit").value = result.unit;
          document.getElementById("codex-bilingual-price-currency").value = result.currency;
          document.getElementById("codex-bilingual-input-token-price").value = result.inputPrice;
          document.getElementById("codex-bilingual-output-token-price").value = result.outputPrice;
          set("priceUnit", result.unit);
          set("priceCurrency", result.currency);
          set("inputTokenPrice", result.inputPrice);
          set("outputTokenPrice", result.outputPrice);
          officialPriceStatus(`已填入 ${result.sourceLabel}；抓取于 ${new Date(result.fetchedAt).toLocaleString()}。`, "var(--color-green-50, #238636)");
        }
      } catch (error) {
        officialPriceStatus(`获取失败：${error.message || String(error)}`, "var(--color-red-60, #c01c28)");
      } finally {
        button.disabled = false;
      }
    });
    document.getElementById("codex-bilingual-open-official-price")?.addEventListener("command", () => {
      if (officialPriceSource) Zotero.launchURL(officialPriceSource);
    });
    const testButton = document.getElementById("codex-bilingual-test-connection");
    const status = document.getElementById("codex-bilingual-test-status");
    testButton?.addEventListener("command", async () => {
      for (const [id, key] of fields) {
        const field = document.getElementById(id);
        if (field) set(key, field.value);
      }
      testButton.disabled = true;
      status.textContent = "正在测试连接…";
      status.style.color = "var(--fill-secondary, #666)";
      try {
        const result = await Zotero.CodexBilingual.testConnection();
        const backend = result.backend === "api"
          ? `API（${result.provider || provider()}）`
          : result.backend === "app-server" ? "Codex App Server" : "Codex CLI";
        status.textContent = `连接成功：${backend}，耗时 ${(result.elapsedMs / 1000).toFixed(1)} 秒；返回“${result.preview}”`;
        status.style.color = "var(--color-green-50, #238636)";
      } catch (error) {
        status.textContent = `连接失败：${error.message || String(error)}`;
        status.style.color = "var(--color-red-60, #c01c28)";
      } finally {
        testButton.disabled = false;
      }
    });
    updateVisibility();
    const support = Zotero.CodexBilingual.platformSupport();
    if (support.platform === "macos") {
      document.getElementById("codex-bilingual-install-runtime").label = "自动检测/配置 macOS PDF 环境";
      document.getElementById("codex-bilingual-runtime-install-status").textContent = "先按官方推荐用 uv 安装 pdf2zh-next，然后点击自动检测。";
    }
    void refreshPreservedPdfModelSource();
    if (officialPriceSource) officialPriceStatus("已保存上次使用的官方价格来源。");
  }
  globalThis.CodexBilingualPrefs = { load };
  let attempts = 0;
  function bridge() {
    if (typeof Zotero !== "undefined" && document.getElementById("codex-bilingual-backend")) {
      load();
      return;
    }
    if (attempts++ < 60) setTimeout(bridge, 50);
  }
  bridge();
}());
