"""Pull ground-truth per-class lengths from the Report Summary page.

The Report Summary page (last text page) contains a "Lengths, Areas and Pitches"
block with separate per-class lines:

    Ridges = 33 ft (4 Ridges)
    Hips = 218 ft (10 Hips)
    Valleys = 61 ft (5 Valleys)
    Rakes* = 0 ft (0 Rakes)
    Eaves/Starter** = 288 ft (14 Eaves)

The cover page also has totals, but they are combined ("Total Ridges/Hips = 251 ft")
and must NOT be used as truth. We therefore search forward from the
"Lengths, Areas and Pitches" anchor.
"""
from __future__ import annotations
import pathlib, re
import pdfplumber

ANCHOR = re.compile(r"Lengths,\s*Areas\s*and\s*Pitches", re.I)

PATTERNS = {
    "ridges":  re.compile(r"^\s*\*?\s*Ridges\s*=\s*([\d,]+)\s*ft", re.I | re.M),
    "hips":    re.compile(r"^\s*\*?\s*Hips\s*=\s*([\d,]+)\s*ft",   re.I | re.M),
    "valleys": re.compile(r"^\s*\*?\s*Valleys\s*=\s*([\d,]+)\s*ft", re.I | re.M),
    "rakes":   re.compile(r"^\s*\*?\s*Rakes\*?\s*=\s*([\d,]+)\s*ft", re.I | re.M),
    "eaves":   re.compile(r"^\s*\*?\s*Eaves(?:/Starter)?\*{0,2}\s*=\s*([\d,]+)\s*ft", re.I | re.M),
}


def extract_truth(pdf_path: pathlib.Path) -> dict[str, int] | None:
    with pdfplumber.open(str(pdf_path)) as pdf:
        full = "\n".join((p.extract_text() or "") for p in pdf.pages)

    # Anchor at "Lengths, Areas and Pitches"; if absent, fall back to whole doc.
    m = ANCHOR.search(full)
    region = full[m.end():] if m else full

    out: dict[str, int] = {}
    for key, pat in PATTERNS.items():
        m2 = pat.search(region)
        if m2:
            out[key] = int(m2.group(1).replace(",", ""))

    if len(out) < 4:
        return None
    out.setdefault("rakes", 0)
    return out


if __name__ == "__main__":
    import sys, json
    print(json.dumps(extract_truth(pathlib.Path(sys.argv[1])), indent=2))
