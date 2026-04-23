"""Canonical JSON contract emitted by parse_diagram.py.

One file per vendor report. All coordinates are in **diagram pixels** of the
cropped Length Diagram. `pixels_per_foot` lets you convert to feet.

{
  "report_id": "8c2e6e38-...",
  "vendor": "eagleview",
  "address": "823 Rose Ct, ...",
  "source_pdf": "documents/vendor-diagrams/<id>/diagram.pdf",
  "diagram_image": "<id>/length_diagram.png",
  "image_size": [W, H],
  "pixels_per_foot": 9.41,
  "summary_truth_ft": {
      "ridges": 33, "hips": 218, "valleys": 61, "rakes": 0, "eaves": 288
  },
  "outline": [[x,y], ...],          # closed polygon, clockwise
  "edges": [
      {"id": 0, "class": "eave",   "p1": [x,y], "p2": [x,y], "length_ft": 43.1},
      {"id": 1, "class": "rake",   ...},
      {"id": 2, "class": "ridge",  ...},
      {"id": 3, "class": "hip",    ...},
      {"id": 4, "class": "valley", ...}
  ],
  "totals_ft": {
      "ridges": 33.4, "hips": 215.8, "valleys": 60.2, "rakes": 0, "eaves": 287.1
  },
  "accuracy_pct_per_class": {
      "ridges": 1.2, "hips": 1.0, "valleys": 1.3, "rakes": 0, "eaves": 0.3
  },
  "passes_strict_3pct": true
}
"""

EDGE_CLASSES = ("eave", "rake", "ridge", "hip", "valley")
