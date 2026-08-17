import json
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "tests" / "fixtures" / "preserved-layout-sample.pdf"
OUTPUT = ROOT / ".runtime" / "pdf-smoke-output" / "preserved-layout-sample.no_watermark.zh-CN.dual.pdf"
REPORT = ROOT / ".runtime" / "pdf-smoke-output" / "verification.json"

with fitz.open(SOURCE) as source, fitz.open(OUTPUT) as output:
    text = "".join(page.get_text() for page in output)
    report = {
        "source_pages": len(source),
        "output_pages": len(output),
        "output_drawings": sum(len(page.get_drawings()) for page in output),
        "output_images": sum(len(page.get_images(full=True)) for page in output),
        "contains_formula": "E = mc" in text or "E=mc" in text,
        "contains_chinese": any("\u4e00" <= character <= "\u9fff" for character in text),
        "text_preview": text[:800],
    }

REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(REPORT)
