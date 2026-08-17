#!/usr/bin/env python3
"""Create the lightweight MIT runtime bundle (external engines are excluded)."""

from __future__ import annotations

import sys
import zipfile
from pathlib import Path


def main() -> int:
    if len(sys.argv) < 4:
        raise SystemExit("Usage: create-runtime-bundle.py <root> <output.zip> <script> [...]")
    root = Path(sys.argv[1]).resolve()
    output = Path(sys.argv[2]).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.unlink(missing_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in sys.argv[3:]:
            source = root / "scripts" / name
            archive.write(source, f"scripts/{name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
