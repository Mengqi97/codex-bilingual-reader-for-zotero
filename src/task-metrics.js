/* global module */
(function (global) {
  "use strict";

  const PRICE_UNITS = Object.freeze({ thousand: 1000, million: 1000000 });

  function asNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
  }

  function estimateTokens(text) {
    const value = String(text || "").trim();
    if (!value) return 0;
    const cjk = (value.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
    const remaining = value.length - cjk;
    return Math.ceil(cjk * 1.5 + remaining / 4);
  }

  function normalizeUsage(usage, source, translation) {
    const input = Number(usage?.prompt_tokens ?? usage?.input_tokens);
    const output = Number(usage?.completion_tokens ?? usage?.output_tokens);
    if (Number.isFinite(input) && Number.isFinite(output)) {
      return { inputTokens: input, outputTokens: output, source: "actual" };
    }
    return {
      inputTokens: estimateTokens(source),
      outputTokens: estimateTokens(translation),
      source: "estimated",
    };
  }

  function calculateCost({ inputTokens = 0, outputTokens = 0, pricing = {} }) {
    const divisor = PRICE_UNITS[pricing.unit] || PRICE_UNITS.million;
    const inputPrice = asNumber(pricing.inputPrice);
    const outputPrice = asNumber(pricing.outputPrice);
    const inputCost = asNumber(inputTokens) / divisor * inputPrice;
    const outputCost = asNumber(outputTokens) / divisor * outputPrice;
    return { inputCost, outputCost, totalCost: inputCost + outputCost };
  }

  function createTask({ id, title, attachmentID, attachmentPath, backend, model, targetLanguage, translationSide, outputMode, pricing, createdAt }) {
    const at = createdAt || new Date().toISOString();
    return {
      id: id || `cbr-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
      title: String(title || "Untitled"),
      attachmentID: Number(attachmentID) || 0,
      attachmentPath: String(attachmentPath || ""),
      backend: String(backend || "cli"),
      model: String(model || "default"),
      targetLanguage: String(targetLanguage || "zh-CN"),
      translationSide: translationSide === "left" ? "left" : "right",
      outputMode: outputMode === "html-reader" ? "html-reader" : "preserved-pdf",
      status: "queued",
      stage: "queued",
      createdAt: at,
      startedAt: "",
      completedAt: "",
      elapsedMs: 0,
      completedSegments: 0,
      totalSegments: 0,
      processedFragmentChars: 0,
      currentFragmentChars: 0,
      currentFragmentElapsedMs: 0,
      codexCalls: 0,
      currentBatchFragmentCount: 0,
      currentBatchInputChars: 0,
      currentBatchElapsedMs: 0,
      activeBatchStatus: "",
      resumedSegments: 0,
      tokenUsage: { inputTokens: 0, outputTokens: 0, source: "none" },
      pricing: {
        unit: pricing?.unit === "thousand" ? "thousand" : "million",
        currency: pricing?.currency === "USD" ? "USD" : "CNY",
        inputPrice: asNumber(pricing?.inputPrice),
        outputPrice: asNumber(pricing?.outputPrice),
      },
      cost: { inputCost: 0, outputCost: 0, totalCost: 0 },
      error: "",
      resultAttachmentId: 0,
    };
  }

  function updateTask(task, patch, now = Date.now()) {
    const next = { ...task, ...patch };
    if (next.startedAt && !next.completedAt) next.elapsedMs = Math.max(0, now - Date.parse(next.startedAt));
    next.cost = calculateCost({ ...next.tokenUsage, pricing: next.pricing });
    return next;
  }

  function addUsage(task, usage, now = Date.now()) {
    const prior = task.tokenUsage || {};
    const hasPriorUsage = asNumber(prior.inputTokens) + asNumber(prior.outputTokens) > 0;
    const source = !hasPriorUsage || (prior.source === "actual" && usage.source === "actual")
      ? usage.source : "estimated";
    return updateTask(task, {
      tokenUsage: {
        inputTokens: asNumber(prior.inputTokens) + asNumber(usage.inputTokens),
        outputTokens: asNumber(prior.outputTokens) + asNumber(usage.outputTokens),
        source,
      },
    }, now);
  }

  function finishTask(task, { status = "completed", error = "", resultAttachmentId = 0 } = {}, now = Date.now()) {
    return updateTask(task, {
      status,
      stage: status,
      completedAt: new Date(now).toISOString(),
      error: String(error || ""),
      resultAttachmentId: Number(resultAttachmentId) || 0,
    }, now);
  }

  const api = { PRICE_UNITS, estimateTokens, normalizeUsage, calculateCost, createTask, updateTask, addUsage, finishTask };
  global.CodexTaskMetrics = api;
  if (typeof module !== "undefined") module.exports = api;
}(this));
