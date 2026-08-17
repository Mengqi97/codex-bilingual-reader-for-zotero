/* global module */
(function (global) {
  "use strict";

  const MAX_SEGMENT_LENGTH = 4200;

  function cleanText(text) {
    return text
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function splitLongSegment(text) {
    if (text.length <= MAX_SEGMENT_LENGTH) return [text];
    const sentences = text.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [text];
    const chunks = [];
    let current = "";
    for (const sentence of sentences) {
      if (current && current.length + sentence.length > MAX_SEGMENT_LENGTH) {
        chunks.push(current.trim());
        current = sentence;
      } else {
        current += sentence;
      }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
  }

  function segmentFullText(rawText) {
    const pages = cleanText(rawText).split("\f");
    const segments = [];
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
      const paragraphs = pages[pageIndex]
        .split(/\n\s*\n/)
        .map(cleanText)
        .filter((paragraph) => paragraph.length > 0);
      for (const paragraph of paragraphs) {
        for (const part of splitLongSegment(paragraph)) {
          segments.push({
            id: `p${pageIndex + 1}-s${segments.length + 1}`,
            page: pageIndex + 1,
            source: part,
            translation: "",
          });
        }
      }
    }
    return segments;
  }

  function escapeHTML(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function renderBilingualHTML({ title, generatedAt, segments, translationSide = "right" }) {
    const translationLeft = translationSide === "left";
    const rows = segments.map((segment) => `
      <article class="segment" id="${escapeHTML(segment.id)}" data-page="${segment.page}">
        ${translationLeft
          ? `<div class="translation translation-left" lang="zh-CN"><span class="locator">p. ${segment.page}</span>${escapeHTML(segment.translation || "［未完成翻译］")}</div><div class="source" lang="en">${escapeHTML(segment.source)}</div>`
          : `<div class="source" lang="en"><span class="locator">p. ${segment.page}</span>${escapeHTML(segment.source)}</div><div class="translation" lang="zh-CN">${escapeHTML(segment.translation || "［未完成翻译］")}</div>`}
      </article>`).join("\n");
    return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHTML(title)} · 中英对照</title><style>
:root { color-scheme: light dark; --line:#d5d9de; --muted:#68707b; --paper:#fff; --ink:#18212b; }
* { box-sizing:border-box; } body { margin:0; background:#f3f5f7; color:var(--ink); font:16px/1.72 ui-sans-serif,system-ui,"Microsoft YaHei",sans-serif; }
header { position:sticky; top:0; z-index:2; padding:14px max(20px,calc((100vw - 1440px)/2)); border-bottom:1px solid var(--line); background:color-mix(in srgb,var(--paper) 92%,transparent); backdrop-filter:blur(10px); }
h1 { margin:0; font-size:17px; } header p { margin:2px 0 0; color:var(--muted); font-size:13px; }
main { max-width:1440px; margin:0 auto; padding:20px; } .legend { display:grid; grid-template-columns:1fr 1fr; gap:28px; padding:0 18px 8px; color:var(--muted); font-size:13px; }
.segment { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:28px; padding:20px 18px; background:var(--paper); border:1px solid var(--line); border-bottom:0; }
.segment:first-of-type { border-radius:10px 10px 0 0; }.segment:last-child { border-bottom:1px solid var(--line); border-radius:0 0 10px 10px; }
.source,.translation { white-space:pre-wrap; } .translation { border-left:1px solid var(--line); padding-left:28px; }
    .locator { display:block; color:var(--muted); font-size:12px; font-variant-numeric:tabular-nums; }.translation-left { border-left:0; border-right:1px solid var(--line); padding-left:0; padding-right:28px; }
@media (max-width:820px) { .legend,.segment { grid-template-columns:1fr; gap:10px; }.translation { border-left:0; border-top:1px solid var(--line); padding:14px 0 0; } }
@media (prefers-color-scheme:dark) { :root { --line:#3b424a; --paper:#20252b; --ink:#edf1f5; } body { background:#15191e; } }
</style></head><body><header><h1>${escapeHTML(title)} · English / 中文</h1><p>生成于 ${escapeHTML(generatedAt)} · 同一滚动容器保证段落对照</p></header><main><div class="legend">${translationLeft ? "<span>中文翻译</span><span>Original</span>" : "<span>Original</span><span>中文翻译</span>"}</div>${rows}</main></body></html>`;
  }

  const api = { MAX_SEGMENT_LENGTH, cleanText, segmentFullText, renderBilingualHTML };
  global.CodexBilingualPipeline = api;
  if (typeof module !== "undefined") module.exports = api;
}(this));
