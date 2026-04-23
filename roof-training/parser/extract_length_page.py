"""Find the LENGTH DIAGRAM page in an EagleView PDF and render it at 300 DPI.

Returns (image_path, page_index) or (None, None) if not found.
"""
from __future__ import annotations
import pathlib
import pdfplumber
import pypdfium2 as pdfium

LENGTH_HEADER = "LENGTH DIAGRAM"


def _is_toc_match(line: str) -> bool:
    """The Table of Contents lists `LENGTH DIAGRAM........ 4` — i.e. the
    header is followed by a long dot-leader and a page number."""
    s = line.upper()
    if "LENGTH DIAGRAM" not in s:
        return False
    after = s.split("LENGTH DIAGRAM", 1)[1]
    # TOC pattern: many dots then a number
    return after.count(".") >= 5 or "..." in after


def find_length_page_index(pdf_path: pathlib.Path) -> int | None:
    """Find the actual Length Diagram page (skip TOC entry).

    Strategy: pick the page where 'LENGTH DIAGRAM' appears as a real header
    (top portion of page) and NOT inside a TOC dot-leader line.
    """
    with pdfplumber.open(str(pdf_path)) as pdf:
        candidates = []
        for i, page in enumerate(pdf.pages):
            text = page.extract_text() or ""
            if "LENGTH DIAGRAM" not in text.upper():
                continue
            # Skip pages where the only match is a TOC line
            real_lines = [
                ln for ln in text.splitlines()
                if "LENGTH DIAGRAM" in ln.upper() and not _is_toc_match(ln)
            ]
            if not real_lines:
                continue
            # Prefer pages where the header sits in the top 30% of the page
            words = page.extract_words() or []
            header_words = [w for w in words
                            if "LENGTH" in w["text"].upper()
                            and w["top"] < page.height * 0.30]
            score = 2 if header_words else 1
            candidates.append((score, i))
        if not candidates:
            return None
        candidates.sort(key=lambda x: (-x[0], x[1]))
        return candidates[0][1]


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
