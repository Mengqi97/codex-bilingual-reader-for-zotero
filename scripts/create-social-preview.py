#!/usr/bin/env python3
"""Generate the repository's deterministic GitHub social preview image."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "docs" / "assets" / "github-social-preview.png"
W, H = 1280, 640


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(Path("C:/Windows/Fonts") / name), size)


def rounded(draw: ImageDraw.ImageDraw, box, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def main() -> int:
    image = Image.new("RGB", (W, H), "#071426")
    draw = ImageDraw.Draw(image)
    for y in range(H):
        t = y / (H - 1)
        color = (
            int(7 + 10 * t),
            int(20 + 24 * t),
            int(38 + 42 * t),
        )
        draw.line((0, y, W, y), fill=color)
    draw.ellipse((-180, -220, 530, 490), fill="#102f62")
    draw.ellipse((850, 250, 1500, 900), fill="#0d505e")

    # Logo: the same open-book visual language as the Zotero add-on icon.
    rounded(draw, (72, 64, 168, 160), 23, "#2364d7")
    draw.polygon([(90, 88), (116, 84), (120, 92), (120, 142), (91, 137)], fill="#ffffff")
    draw.polygon([(150, 88), (124, 84), (120, 92), (120, 142), (149, 137)], fill="#dbe9ff")
    draw.line((120, 91, 120, 143), fill="#0d3e98", width=3)
    for y, length in [(103, 18), (114, 14), (125, 18)]:
        draw.line((96, y, 96 + length, y), fill="#2967d8", width=3)
        draw.line((128, y, 145, y), fill="#174aaf", width=3)
    draw.line((132, 136, 138, 142, 149, 130), fill="#f6a623", width=4, joint="curve")

    bold = font("seguisb.ttf", 59)
    regular = font("segoeui.ttf", 29)
    small = font("segoeui.ttf", 20)
    tag = font("seguisb.ttf", 19)
    cjk = font("msyh.ttc", 16)
    draw.text((72, 194), "Codex Bilingual", font=bold, fill="#ffffff")
    draw.text((72, 258), "Reader for Zotero", font=bold, fill="#ffffff")
    draw.text((75, 346), "Preserved-layout bilingual PDFs", font=regular, fill="#bbd5ff")
    draw.text((75, 385), "for academic reading", font=regular, fill="#bbd5ff")

    tags = ["Codex CLI", "OpenAI", "DeepSeek"]
    x = 74
    for label in tags:
        width = int(draw.textlength(label, font=tag)) + 34
        rounded(draw, (x, 451, x + width, 489), 19, "#143b70", "#397bd8", 1)
        draw.text((x + 17, 458), label, font=tag, fill="#e9f3ff")
        x += width + 12
    draw.text((76, 531), "Figures  ·  Formulas  ·  Tables  ·  Selectable text", font=small, fill="#78d9d0")

    # Abstract paper pair: clearly illustrative, not a fabricated product screenshot.
    shadow = (748, 79, 1205, 572)
    rounded(draw, shadow, 18, "#06101e")
    rounded(draw, (725, 58, 1182, 551), 18, "#eaf1f8")
    draw.rectangle((750, 91, 950, 523), fill="#ffffff")
    draw.rectangle((957, 91, 1157, 523), fill="#f8fbff")
    rounded(draw, (765, 105, 811, 130), 12, "#dbe9ff")
    rounded(draw, (972, 105, 1023, 130), 12, "#d9f4ef")
    draw.text((777, 108), "EN", font=tag, fill="#2459ae")
    draw.text((980, 108), "中文", font=cjk, fill="#137567")
    for yy, ratio in [(150, .85), (166, .72), (182, .9), (198, .64), (330, .9), (346, .76), (362, .84), (378, .58)]:
        draw.rounded_rectangle((765, yy, 765 + int(165 * ratio), yy + 7), radius=3, fill="#c5cfda")
        draw.rounded_rectangle((972, yy, 972 + int(165 * ratio), yy + 7), radius=3, fill="#9bcfc6")
    # Shared figure/formula bands preserve the visual relationship across languages.
    rounded(draw, (770, 225, 935, 303), 7, "#e8eff8", "#cad8e9")
    rounded(draw, (977, 225, 1142, 303), 7, "#e8eff8", "#cad8e9")
    for base in (770, 977):
        draw.line((base + 18, 285, base + 48, 258, base + 82, 273, base + 118, 242, base + 147, 255), fill="#2967d8", width=4)
        for px, py in [(18, 285), (48, 258), (82, 273), (118, 242), (147, 255)]:
            draw.ellipse((base + px - 4, py - 4, base + px + 4, py + 4), fill="#f6a623")
    draw.text((794, 412), "E = mc²", font=font("cambria.ttc", 25), fill="#26384d")
    draw.text((1001, 412), "E = mc²", font=font("cambria.ttc", 25), fill="#26384d")
    for xx in (765, 972):
        rounded(draw, (xx, 458, xx + 165, 502), 5, "#edf3f8", "#d5e0e9")
        draw.line((xx + 12, 472, xx + 151, 472), fill="#b7c7d6", width=2)
        draw.line((xx + 12, 487, xx + 151, 487), fill="#b7c7d6", width=2)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    image.save(OUTPUT, "PNG", optimize=True)
    print(OUTPUT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
