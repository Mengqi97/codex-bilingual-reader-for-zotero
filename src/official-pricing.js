/* global module */
(function (global) {
  "use strict";

  const SOURCES = Object.freeze({
    openai: "https://developers.openai.com/api/docs/pricing.md",
    openrouter: "https://openrouter.ai/api/v1/model/",
    deepseek: "https://api-docs.deepseek.com/quick_start/pricing",
    qwen: "https://help.aliyun.com/en/model-studio/model-pricing",
  });

  function parseDollar(value) {
    const match = String(value || "").match(/\$\s*([0-9]+(?:\.[0-9]+)?)/);
    return match ? Number(match[1]) : NaN;
  }

  function parseOpenAIStandardPrice(markdown, model) {
    const target = String(model || "").trim().toLowerCase();
    for (const line of String(markdown || "").split("\n")) {
      if (!line.startsWith("|")) continue;
      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
      if (cells.length < 5 || cells[0].toLowerCase().replace(/\s*\(.+\)$/, "") !== target) continue;
      const inputPrice = parseDollar(cells[1]);
      const outputPrice = parseDollar(cells[4]);
      if (Number.isFinite(inputPrice) && Number.isFinite(outputPrice)) {
        return { inputPrice, outputPrice, unit: "million", currency: "USD" };
      }
    }
    return null;
  }

  function parseOpenRouterPrice(payload) {
    const pricing = payload?.data?.pricing || payload?.pricing;
    const inputPrice = Number(pricing?.prompt);
    const outputPrice = Number(pricing?.completion);
    if (!Number.isFinite(inputPrice) || !Number.isFinite(outputPrice)) return null;
    return { inputPrice: inputPrice * 1000000, outputPrice: outputPrice * 1000000, unit: "million", currency: "USD" };
  }

  const api = { SOURCES, parseOpenAIStandardPrice, parseOpenRouterPrice };
  global.CodexOfficialPricing = api;
  if (typeof module !== "undefined") module.exports = api;
}(this));
