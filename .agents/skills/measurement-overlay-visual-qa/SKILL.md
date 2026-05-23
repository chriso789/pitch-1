---
name: measurement-overlay-visual-qa
description: Governs the visual QA surface for AI Measurement runs — the aerial-backed overlay that lets a human verify perimeter, mask, rejected regions, and roof-line diagnostics before any customer export. Triggers when a request touches MeasurementReportDialog, the AI Process Viewer, DSMDebugOverlay, debug_perimeter_overlay_svg, raster_url, perimeter overlay rendering, visual QA, manual perimeter verification, or roof diagram rendering. Enforces that aerial imagery is always the background, all required diagnostic layers are present, blocked-topology runs still show a perimeter debug view, and that manual perimeter edits unlock topology diagnostics only — never a customer-ready export by themselves.
---

# Measurement Overlay UI & Visual QA

## Role
Make AI Measurement diagnostics visually inspectable. The user must always be able to see the aerial image with the raw perimeter, refined perimeter, selected perimeter, target mask, rejected regions, and roof-line candidates overlaid together — even when topology fails.

## Applies when
A request touches:
- `MeasurementReportDialog`
- AI Process Viewer (`AIMeasurement3DDebugViewer` and successors)
- `DSMDebugOverlay`
- `debug_perimeter_overlay_svg`
- `raster_url`
- Perimeter overlay
- Visual QA
- Manual perimeter verification
- Roof diagram rendering

## Hard Rules

### 1. Aerial-first background
Never render a geometry-only SVG as the final diagnostic view. The aerial raster (`raster_url`, Google Static Maps tile, or persisted DSM-aligned RGB) MUST be the background whenever available. Geometry-only is a fallback with a visible "no aerial available" banner.

### 2. Required overlay layers
The overlay MUST be capable of showing, each as an independently toggleable layer:
- aerial raster (background)
- raw perimeter — **gray**
- refined perimeter — **green**
- selected/active perimeter — **blue**
- target roof mask — **translucent fill**
- global building mask — optional, **dashed**
- unsupported perimeter segments — **red**
- long-segment corner cuts — **orange**
- rejected regions (tree / patio / screen / pool) — distinct hatched fill
- corner snap points — small markers
- DSM ridge / valley / hip candidates — when available, distinct stroke per type

Toggles must reflect actual data availability; missing data shows an inline "not persisted" note rather than a silently empty layer.

### 3. Blocked-topology fallback
If topology is blocked (`result_state` in `ai_failed_perimeter` / `ai_failed_complex_topology` / `perimeter_only` / etc.), the report MUST render the **perimeter debug overlay** in place of a blank report. Never show an empty card.

### 4. Required metrics in the UI
The overlay panel MUST expose:
- `visual_edge_alignment_score`
- `aerial_edge_support_pct`
- `dsm_boundary_support_pct`
- `corner_snap_confidence`
- `shape_failure_reasons` (list)
- `visual_review_gate` (state)
- Manual **Approve** / **Edit** / **Reject** controls

Missing values render as "—" with a tooltip explaining which backend field is absent.

### 5. Manual perimeter tools
The manual editor MUST support:
- drag vertex
- add corner (click on edge)
- delete vertex
- snap-to-aerial-edge
- save verified perimeter
- "Rerun measurement with `user_verified_perimeter = true`" action that calls the canonical start function (never a legacy route)

### 6. Manual perimeter ≠ customer-ready
A manually verified perimeter MUST NOT, by itself, unlock customer-ready export. It only unlocks **topology diagnostics**. `customer_report_ready` still requires the full downstream gate (topology + typed roof_lines + valid pitch + vendor benchmark where applicable). On save, set `perimeter_source_locked = "user_verified_perimeter"` and explicitly hold `customer_report_ready = false` until the downstream pipeline passes.

## Required output (when this skill is invoked)
Before writing any code, return:

1. **Exact components to update** — file paths for the report dialog, debug viewer, overlay canvas, manual editor, and any hook that supplies the overlay state.
2. **Overlay layer contract** — a table: layer name → color/style → backend field(s) consumed → toggle id → fallback behavior.
3. **JSON fields consumed** — every field read from `geometry_report_json`, `overlay_debug`, `shape_validation`, `segment_diagnostics`, `target_mask_isolation`, `phase3_5`, etc. List required vs optional and what "missing" renders as.
4. **UI acceptance checklist** — concrete pass/fail items a reviewer can tick: aerial background visible, all 11 layer toggles present, blocked-topology row still shows overlay (not blank), all 6 metrics shown with units, manual editor save calls canonical rerun, manual save does not flip `customer_report_ready`.

Only after that output is on the table do you propose or write component changes.

## Refusal triggers
Refuse to mark complete and surface the gap if:
- The final report renders a geometry-only SVG when an aerial source is available.
- Any required layer is missing without an explicit "not persisted" note.
- A blocked-topology run shows a blank report instead of the perimeter debug overlay.
- The manual editor's rerun action calls anything other than the canonical `start-ai-measurement` route.
- Saving a manual perimeter flips `customer_report_ready = true` without re-running downstream gates.
