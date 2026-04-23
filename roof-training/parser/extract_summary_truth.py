"""Pull ground-truth per-class lengths from the Report Summary page.

Looks for lines like:
    Ridges = 33 ft (4 Ridges)
    Hips = 218 ft (10 Hips)
    Valleys = 61 ft (5 Valleys)
    Rakes = 0 ft (0 Rakes)
    Eaves/Starter = 288 ft (14 Eaves)

Returns a dict {ridges, hips, valleys, rakes, eaves} in feet (ints).
"""
from __future__ import annotations
import pathlib, re
import pdfplumber

PATTERNS = {
    "ridges":  re.compile(r"Ridges\s*=\s*([\d,]+)\s*ft", re.I),
    "hips":    re.compile(r"Hips\s*=\s*([\d,]+)\s*ft", re.I),
    "valleys": re.compile(r"Valleys\s*=\s*([\d,]+)\s*ft", re.I),
    "rakes":   re.compile(r"Rakes\*?\s*=\s*([\d,]+)\s*ft", re.I),
    "eaves":   re.compile(r"Eaves(?:/Starter)?\*{0,2}\s*=\s*([\d,]+)\s*ft", re.I),
}


def extract_truth(pdf_path: pathlib.Path) -> dict[str, int] | None:
    out: dict[str, int] = {}
    with pdfplumber.open(str(pdf_path)) as pdf:
        full = "\n".join((p.extract_text() or "") for p in pdf.pages)
    for key, pat in PATTERNS.items():
        m = pat.search(full)
        if m:
            out[key] = int(m.group(1).replace(",", ""))
    if len(out) < 4:
        return None
    out.setdefault("rakes", 0)
    return out


if __name__ == "__main__":
    import sys, json
    print(json.dumps(extract_truth(pathlib.Path(sys.argv[1])), indent=2))
