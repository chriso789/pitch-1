"""Find the LENGTH DIAGRAM page in an EagleView PDF and render it at 300 DPI.

Returns (image_path, page_index) or (None, None) if not found.
"""
from __future__ import annotations
import pathlib
import pdfplumber
import pypdfium2 as pdfium

LENGTH_HEADER = "LENGTH DIAGRAM"


def find_length_page_index(pdf_path: pathlib.Path) -> int | None:
    with pdfplumber.open(str(pdf_path)) as pdf:
        for i, page in enumerate(pdf.pages):
            text = (page.extract_text() or "").upper()
            if LENGTH_HEADER in text:
                return i
    return None


def render_page(pdf_path: pathlib.Path, page_index: int, out_png: pathlib.Path,
                dpi: int = 300) -> pathlib.Path:
    doc = pdfium.PdfDocument(str(pdf_path))
    page = doc[page_index]
    scale = dpi / 72.0
    bitmap = page.render(scale=scale).to_pil()
    out_png.parent.mkdir(parents=True, exist_ok=True)
    bitmap.save(str(out_png), "PNG")
    return out_png


def extract(pdf_path: pathlib.Path, out_png: pathlib.Path) -> int | None:
    idx = find_length_page_index(pdf_path)
    if idx is None:
        return None
    render_page(pdf_path, idx, out_png)
    return idx


if __name__ == "__main__":
    import sys
    p = pathlib.Path(sys.argv[1])
    out = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else p.with_suffix(".length.png")
    idx = extract(p, out)
    print(f"page_index={idx}  out={out}")
