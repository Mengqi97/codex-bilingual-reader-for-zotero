/* global Zotero, Services, IOUtils, PathUtils, window, document */
(function () {
  const selectedIDs = new Set();
  const formatDuration = (milliseconds) => {
    const seconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return hours ? `${hours}时${minutes}分` : `${minutes}分${seconds % 60}秒`;
  };
  const currency = (value, code) => `${code === "USD" ? "$" : "￥"}${Number(value || 0).toFixed(4)}`;
  const side = (value) => value === "left" ? "左侧" : "右侧";
  const escape = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;",
  }[char]));
  const canCancel = (task) => ["queued", "running"].includes(task?.status);
  const canMarkStopped = (task) => ["queued", "running", "interrupted"].includes(task?.status);
  const hasResult = (task) => Number(task?.resultAttachmentId) > 0;
  const terminal = (task) => ["completed", "failed", "cancelled", "interrupted"].includes(task?.status);
  const tokenText = (task) => {
    if (!terminal(task)) return "完成后显示";
    const usage = task?.tokenUsage || {};
    return usage.source === "actual"
      ? `${usage.inputTokens || 0} / ${usage.outputTokens || 0}（实际）`
      : "-";
  };
  const costText = (task) => task?.tokenUsage?.source === "actual"
    ? currency(task.cost?.totalCost, task.pricing?.currency)
    : "-";
  const liveElapsedMs = (task) => task.status === "running" && task.startedAt
    ? Math.max(0, Date.now() - Date.parse(task.startedAt))
    : task.elapsedMs;
  const progressText = (task) => {
    if (task.status === "queued") return "待翻译（批量队列）";
    if (task.status !== "running") return "-";
    if (task.stage === "preflight") return "正在预检环境";
    if (task.stage === "translation") {
      const completed = Number(task.completedSegments) || 0;
      const estimated = Number(task.estimatedSegments) || 0;
      const declared = Number(task.totalSegments) || 0;
      const latest = Number(task.currentFragmentChars) > 0
        ? `；最近 ${task.currentFragmentChars} 字符，累计 ${Number(task.processedFragmentChars) || 0} 字符；批次 ${Number(task.codexCalls) || 0}：${Number(task.currentBatchFragmentCount) || 1} 段 / ${Number(task.currentBatchInputChars) || task.currentFragmentChars} 字符`
        : "";
      if (declared > 0) return `${completed}/${declared}${latest}（检查点已保存）`;
      if (completed > estimated && estimated > 0) {
        return `已完成 ${completed} 个片段；初始估算 ${estimated} 段偏小，当前至少 ${completed} 个片段${latest}（检查点已保存）`;
      }
      return completed > 0
        ? `已完成 ${completed} 个片段${estimated > 0 ? ` / 初始预计 ${estimated} 段` : ""}${latest}（检查点已保存）`
        : `正在提取版式与段落：0${estimated > 0 ? ` / 初始预计 ${estimated} 段` : ""}${Number(task.totalPages) > 0 ? `（全文约 ${task.totalPages} 页）` : ""}`;
    }
    if (task.stage === "import") return "正在导入 Zotero";
    return "正在处理";
  };

  function mainWindow() {
    try { return window.opener || null; } catch (_error) {}
    return null;
  }

  function taskAPI() {
    if (typeof Zotero !== "undefined" && Zotero.CodexBilingual) return Zotero.CodexBilingual;
    const main = mainWindow();
    if (main?.Zotero?.CodexBilingual) return main.Zotero.CodexBilingual;
    return null;
  }

  function copyText(value) {
    const zotero = (typeof Zotero !== "undefined" && Zotero) || mainWindow()?.Zotero;
    if (typeof zotero?.Utilities?.Internal?.copyTextToClipboard === "function") {
      zotero.Utilities.Internal.copyTextToClipboard(String(value));
      return;
    }
    Components.classes["@mozilla.org/widget/clipboardhelper;1"]
      .getService(Components.interfaces.nsIClipboardHelper)
      .copyString(String(value));
  }

  function taskStorePath() {
    return PathUtils.join(PathUtils.profileDir || PathUtils.tempDir, "codex-bilingual-reader-tasks.json");
  }

  async function localTasks() {
    const file = taskStorePath();
    if (!(await IOUtils.exists(file))) return [];
    const value = JSON.parse(await IOUtils.readUTF8(file));
    return Array.isArray(value?.tasks) ? value.tasks : [];
  }

  async function loadTasks() {
    const api = taskAPI();
    return api ? api.listTasks() : localTasks();
  }

  async function markStoppedLocally(taskID) {
    const tasks = await localTasks();
    const now = Date.now();
    const next = tasks.map((task) => {
      if (task.id !== taskID || !["queued", "running", "interrupted"].includes(task.status)) return task;
      return {
        ...task,
        status: "cancelled",
        stage: "cancelled",
        completedAt: new Date(now).toISOString(),
        elapsedMs: task.startedAt ? Math.max(0, now - Date.parse(task.startedAt)) : task.elapsedMs,
        error: "已由用户确认外部进程停止",
      };
    });
    await IOUtils.writeUTF8(taskStorePath(), JSON.stringify({ version: 1, tasks: next }, null, 2));
    return true;
  }

  async function stopTask(taskID) {
    const api = taskAPI();
    return api ? api.cancelTask(taskID) : markStoppedLocally(taskID);
  }

  async function refreshSafely() {
    try {
      await refresh();
    } catch (error) {
      document.getElementById("task-center-summary").textContent = `读取任务失败：${error.message || String(error)}`;
    }
  }

  function setFeedback(message, isError = false) {
    const feedback = document.getElementById("task-center-feedback");
    feedback.textContent = message || "";
    feedback.style.color = isError ? "#b42318" : "var(--color-accent-blue,#0060df)";
  }

  function updateActionState(selected) {
    document.getElementById("task-center-cancel").disabled = !selected.some(canCancel);
    document.getElementById("task-center-mark-stopped").disabled = !selected.some(canMarkStopped);
    document.getElementById("task-center-copy").disabled = selected.length === 0;
    document.getElementById("task-center-open-result").disabled = selected.length !== 1 || !hasResult(selected[0]);
    const selection = document.getElementById("task-center-selection");
    if (!selected.length) {
      selection.textContent = "尚未选择任务。可勾选多行或使用表头全选。";
      return;
    }
    if (selected.length > 1) {
      selection.textContent = `已选择 ${selected.length} 条任务。批量操作只作用于状态允许的任务。`;
      return;
    }
    const task = selected[0];
    const result = hasResult(task) ? "已有翻译结果" : "尚无可查看结果";
    selection.textContent = `已选择：${task.title || "未命名任务"} / ${task.status || "未知状态"} / ${task.id}；${result}`;
  }

  function renderSelection(tasks) {
    for (const row of document.getElementById("task-center-body").children) {
      const isSelected = selectedIDs.has(row.dataset.id);
      row.style.background = isSelected ? "#e8f1ff" : "";
      row.setAttribute("aria-selected", String(isSelected));
      const checkbox = row.querySelector(".task-select");
      if (checkbox) checkbox.checked = isSelected;
    }
    const selectAll = document.getElementById("task-center-select-all");
    selectAll.checked = tasks.length > 0 && tasks.every((task) => selectedIDs.has(task.id));
    selectAll.indeterminate = selectedIDs.size > 0 && !selectAll.checked;
    updateActionState(tasks.filter((task) => selectedIDs.has(task.id)));
  }

  function selectTask(taskID, selected, tasks) {
    if (selected) selectedIDs.add(taskID);
    else selectedIDs.delete(taskID);
    renderSelection(tasks);
  }

  async function refresh() {
    const tasks = await loadTasks();
    const body = document.getElementById("task-center-body");
    const focusedID = document.activeElement?.dataset?.id || "";
    body.replaceChildren();
    for (const task of tasks) {
      const row = document.createElementNS("http://www.w3.org/1999/xhtml", "tr");
      row.dataset.id = task.id;
      row.tabIndex = 0;
      row.setAttribute("aria-selected", String(selectedIDs.has(task.id)));
      row.style.cursor = "pointer";
      row.style.background = selectedIDs.has(task.id) ? "#e8f1ff" : "";
      row.innerHTML = [
        task.title, task.targetLanguage, side(task.translationSide), task.model,
        task.id.slice(-12), task.status, task.stage,
        progressText(task),
        formatDuration(liveElapsedMs(task)),
        tokenText(task), costText(task), task.error || "-",
      ].map((value) => `<td style="padding:8px;border-top:1px solid #e5e7eb;vertical-align:top;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escape(value)}</td>`).join("") +
        `<td style="padding:5px;border-top:1px solid #e5e7eb;"><button class="task-cancel" ${canCancel(task) ? "" : "disabled=\"disabled\""}>取消</button></td>`;
      const selectionCell = document.createElementNS("http://www.w3.org/1999/xhtml", "td");
      selectionCell.style.cssText = "padding:8px;border-top:1px solid #e5e7eb;text-align:center;";
      const checkbox = document.createElementNS("http://www.w3.org/1999/xhtml", "input");
      checkbox.className = "task-select";
      checkbox.type = "checkbox";
      checkbox.setAttribute("aria-label", "选择任务");
      checkbox.checked = selectedIDs.has(task.id);
      selectionCell.append(checkbox);
      row.insertBefore(selectionCell, row.firstChild);
      checkbox.addEventListener("click", (event) => event.stopPropagation());
      checkbox.addEventListener("change", () => selectTask(task.id, checkbox.checked, tasks));
      row.addEventListener("click", (event) => {
        if (event.target.closest("button,input")) return;
        selectTask(task.id, !selectedIDs.has(task.id), tasks);
      });
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectTask(task.id, !selectedIDs.has(task.id), tasks);
        }
      });
      row.querySelector(".task-cancel")?.addEventListener("click", async (event) => {
        event.stopPropagation();
        if (canCancel(task)) await stopTask(task.id);
        await refreshSafely();
      });
      body.append(row);
    }
    const currentIDs = new Set(tasks.map((task) => task.id));
    for (const id of selectedIDs) if (!currentIDs.has(id)) selectedIDs.delete(id);
    renderSelection(tasks);
    if (focusedID) Array.from(body.children).find((row) => row.dataset.id === focusedID)?.focus();
    document.getElementById("task-center-summary").textContent = `共 ${tasks.length} 条任务；运行中不估算 Token，任务结束后仅显示 API 返回的实际 usage。`;
    return tasks;
  }

  async function selectedTasks() {
    const tasks = await loadTasks();
    return tasks.filter((task) => selectedIDs.has(task.id));
  }

  window.addEventListener("load", () => {
    document.getElementById("task-center-refresh").addEventListener("command", () => void refreshSafely());
    document.getElementById("task-center-select-all").addEventListener("change", async (event) => {
      const tasks = await loadTasks();
      selectedIDs.clear();
      if (event.target.checked) for (const task of tasks) selectedIDs.add(task.id);
      renderSelection(tasks);
    });
    const cancelSelected = async () => {
      const tasks = (await selectedTasks()).filter(canCancel);
      if (!tasks.length) return setFeedback("所选任务中没有可取消的运行任务。", true);
      let failed = 0;
      for (const task of tasks) if (await stopTask(task.id) === false) failed += 1;
      setFeedback(`已向 ${tasks.length - failed} 条任务发送取消请求${failed ? `；${failed} 条失败` : ""}。`, failed > 0);
      await refreshSafely();
    };
    document.getElementById("task-center-cancel").addEventListener("command", cancelSelected);
    const markStopped = async () => {
      const tasks = (await selectedTasks()).filter(canMarkStopped);
      if (!tasks.length) return setFeedback("所选任务中没有可标记停止的任务。", true);
      for (const task of tasks) await markStoppedLocally(task.id);
      setFeedback(`已将 ${tasks.length} 条任务标记为停止。原有检查点不会删除。`);
      await refreshSafely();
    };
    document.getElementById("task-center-mark-stopped").addEventListener("command", markStopped);
    document.getElementById("task-center-copy").addEventListener("command", () => {
      if (!selectedIDs.size) return setFeedback("请先选择任务。", true);
      copyText(Array.from(selectedIDs).join("\n"));
      setFeedback(`已复制 ${selectedIDs.size} 个任务 ID。`);
    });
    document.getElementById("task-center-open-result").addEventListener("command", async () => {
      const [task] = await selectedTasks();
      if (!task || selectedIDs.size !== 1) return setFeedback("请只选择一条任务查看结果。", true);
      if (!hasResult(task)) return setFeedback("该任务没有可查看的翻译结果。", true);
      await mainWindow()?.ZoteroPane?.selectItem(task.resultAttachmentId);
      setFeedback("已在 Zotero 中定位翻译结果。 ");
    });
    document.getElementById("task-center-close").addEventListener("command", () => window.close());
    void refreshSafely();
    window.setInterval(() => void refreshSafely(), 1000);
  });
}());
