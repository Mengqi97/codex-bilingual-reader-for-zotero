"""Create a page-faithful DOCX from rendered PDF page PNGs using only stdlib."""
from __future__ import annotations

import argparse
import shutil
import struct
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

EMU_PER_TWIP = 635


def png_size(path: Path) -> tuple[int, int]:
    with path.open("rb") as stream:
        header = stream.read(24)
    if header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise ValueError(f"Not a PNG file: {path}")
    return struct.unpack(">II", header[16:24])


def content_types(count: int) -> str:
    overrides = "".join(
        f'<Override PartName="/word/media/page-{index:03d}.png" ContentType="image/png"/>'
        for index in range(1, count + 1)
    )
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>{overrides}
</Types>'''


def image_paragraph(index: int, width: int, height: int) -> str:
    relationship = f"rId{index + 2}"
    doc_pr = index
    return f'''<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">
<wp:extent cx="{width}" cy="{height}"/><wp:docPr id="{doc_pr}" name="Page {index}"/>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
<pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="Page {index}"/><pic:cNvPicPr/></pic:nvPicPr>
<pic:blipFill><a:blip r:embed="{relationship}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{width}" cy="{height}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>
</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'''


def document_xml(images: list[Path]) -> str:
    png_width, png_height = png_size(images[0])
    page_width_twips = 12240
    image_width = page_width_twips * EMU_PER_TWIP
    page_height_twips = round((image_width * png_height / png_width) / EMU_PER_TWIP) + 80
    parts: list[str] = []
    for index, image in enumerate(images, start=1):
        width, height = png_size(image)
        image_height = round(image_width * height / width)
        parts.append(image_paragraph(index, image_width, image_height))
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<w:body>{''.join(parts)}<w:sectPr><w:pgSz w:w="{page_width_twips}" w:h="{page_height_twips}"/>
<w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/>
</w:sectPr></w:body></w:document>'''


def write_docx(images: list[Path], output: Path) -> None:
    relationships = [
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    ]
    relationships.extend(
        f'<Relationship Id="rId{index + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/page-{index:03d}.png"/>'
        for index in range(1, len(images) + 1)
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types(len(images)))
        archive.writestr("_rels/.rels", '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>''')
        archive.writestr("word/document.xml", document_xml(images))
        archive.writestr("word/styles.xml", '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>''')
        archive.writestr("word/_rels/document.xml.rels", f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{''.join(relationships)}</Relationships>''')
        archive.writestr("docProps/core.xml", '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Bilingual PDF companion</dc:title></cp:coreProperties>''')
        archive.writestr("docProps/app.xml", '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Codex Bilingual Reader</Application></Properties>''')
        for index, image in enumerate(images, start=1):
            archive.write(image, f"word/media/page-{index:03d}.png")


parser = argparse.ArgumentParser()
parser.add_argument("images_directory", type=Path)
parser.add_argument("output_docx", type=Path)
args = parser.parse_args()
pages = sorted(args.images_directory.glob("page-*.png"))
if not pages:
    raise SystemExit("No rendered PNG pages found")
write_docx(pages, args.output_docx)
print(f"DOCX_JSON={{\"docxPath\":{args.output_docx.as_posix()!r},\"pages\":{len(pages)}}}")
