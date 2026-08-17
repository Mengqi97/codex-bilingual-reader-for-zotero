#!/usr/bin/env python3
"""Reduce the duplicated inner margins of a side-by-side BabelDOC PDF."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path


def load_pymupdf():
    portable_root = Path(sys.executable).resolve().parents[1]
    sys.path.insert(0, str(portable_root / "site-packages"))
    import pymupdf  # type: ignore

    return pymupdf


def compact(input_path: Path, output_path: Path, trim_points: float) -> None:
    pymupdf = load_pymupdf()
    source = pymupdf.open(input_path)
    destination = pymupdf.open()
    try:
        for page_number, source_page in enumerate(source):
            width = source_page.rect.width
            height = source_page.rect.height
            half_width = width / 2
            trim = min(max(0.0, trim_points), half_width * 0.2)
            if width < height * 1.2 or trim <= 0:
                page = destination.new_page(width=width, height=height)
                page.show_pdf_page(page.rect, source, page_number)
                continue

            compact_half = half_width - trim
            page = destination.new_page(width=width - 2 * trim, height=height)
            left_clip = pymupdf.Rect(0, 0, compact_half, height)
            right_clip = pymupdf.Rect(half_width + trim, 0, width, height)
            page.show_pdf_page(
                pymupdf.Rect(0, 0, compact_half, height),
                source,
                page_number,
                clip=left_clip,
                keep_proportion=False,
            )
            page.show_pdf_page(
                pymupdf.Rect(compact_half, 0, width - 2 * trim, height),
                source,
                page_number,
                clip=right_clip,
                keep_proportion=False,
            )

        destination.set_metadata(source.metadata)
        if table_of_contents := source.get_toc():
            destination.set_toc(table_of_contents)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        destination.save(output_path, garbage=4, deflate=True)
    finally:
        destination.close()
        source.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input_pdf", type=Path)
    parser.add_argument("output_pdf", type=Path)
    parser.add_argument("--trim-points", type=float, default=80.0)
    args = parser.parse_args()
    compact(args.input_pdf, args.output_pdf, args.trim_points)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
