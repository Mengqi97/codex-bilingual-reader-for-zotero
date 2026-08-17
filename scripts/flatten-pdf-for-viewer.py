"""Create a viewer-compatible PDF that does not depend on local fonts."""

from __future__ import annotations

import argparse
from pathlib import Path

import fitz


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input_pdf", type=Path)
    parser.add_argument("output_pdf", type=Path)
    parser.add_argument("--dpi", type=int, default=220)
    args = parser.parse_args()
    if args.dpi < 144:
        raise ValueError("dpi must be at least 144")

    scale = args.dpi / 72
    args.output_pdf.parent.mkdir(parents=True, exist_ok=True)
    with fitz.open(args.input_pdf) as source, fitz.open() as output:
        for page in source:
            pixmap = page.get_pixmap(
                matrix=fitz.Matrix(scale, scale), alpha=False, colorspace=fitz.csRGB
            )
            flattened_page = output.new_page(width=page.rect.width, height=page.rect.height)
            flattened_page.insert_image(flattened_page.rect, pixmap=pixmap)
        output.set_metadata(source.metadata)
        output.save(args.output_pdf, garbage=4, deflate=True, deflate_images=True)


if __name__ == "__main__":
    main()
