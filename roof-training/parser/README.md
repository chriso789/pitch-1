# EagleView Length-Diagram Parser

Goal: turn vendor "Length Diagram" pages into structured roof-line labels
(`outline`, `eaves`, `rakes`, `ridges`, `hips`, `valleys`).
This is the **truth layer** consumed by downstream training (roof U-Net + topology
classifier). It does not look at aerial imagery.

## Pipeline

1. **Stage 1 — Cleanup**
   - Render the Length Diagram page at 300 DPI.
   - Crop diagram region (between the blue header band and the page footer line).
   - Strip OCR text labels (numbers + watermark) from the linework via inpainting.

2. **Stage 2 — Color split**
   EagleView uses a fixed pen palette on the Length Diagram. We mask by hue:
   - **Red solid**     → hip + ridge candidates
   - **Blue dashed**   → valleys
   - **Black solid**   → eave + rake candidates (perimeter)
   - Tan / brown rectangles (chimneys, step-flashing call-outs) → discarded

3. **Stage 3 — Vectorize**
   - Probabilistic Hough on each color mask.
   - Merge collinear segments, snap endpoints into a node graph.

4. **Stage 4 — Topology classification**
   - **Outline**       : closed polygon = union(black ∪ red-perimeter) outer ring.
   - **Eaves vs Rakes**: black perimeter edges; eaves = level (parallel to dominant
                         ridge axis), rakes = sloped (perpendicular).
   - **Ridges vs Hips**: red edges that **terminate at outline corners** = hips,
                         red edges that **terminate at two hip junctions** = ridges.
   - **Valleys**       : every blue-dashed segment.

## Calibration

Phase 1 (now): solve pixels-per-foot **once per report** by least-squares fitting
the per-class pixel totals against the Report Summary truth
(`Ridges = X ft`, `Hips = Y ft`, `Valleys = Z ft`, `Eaves = W ft`).

Phase 2 (later): OCR the per-segment foot labels and refine.

## Acceptance bar

Strict: per-class total length within **±3%** of Report Summary on **≥90%** of samples.

## Files

- `bucket_loader.py`        — pulls the 62 EagleView PDFs from `roof_vendor_reports`.
- `extract_length_page.py`  — finds the page containing "LENGTH DIAGRAM" and renders to PNG.
- `extract_summary_truth.py`— pulls `{ridges, hips, valleys, rakes, eaves}` ft from Report Summary.
- `parse_diagram.py`        — Stages 1–4, emits canonical JSON + overlay PNG.
- `validate.py`             — runs across all reports and prints per-class accuracy.
- `schema.py`               — canonical JSON contract.
