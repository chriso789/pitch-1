# Blueprint Importer v2 — Trade Catalog

**Status:** Phase 0 contract doc. No DB, no code, no endpoint behavior changes.
**Scope:** Canonical list of trades the importer can recognize, classify, and (eventually) drive estimates from. Defines what is in-scope for the Phase 3 MVP and what is explicitly deferred.

---

## 1. Support status enum

Every trade carries one of four status values. The importer surface must respect them:

| Status | Meaning | UI behavior |
|---|---|---|
| `mvp_supported` | Auto-detect, auto-extract measurements, auto-populate materials + labor on user accept. | Selectable trade, "Populate Material List" + "Generate Labor Pricing" enabled. |
| `measurement_object_only` | Recognized and extracted as inputs/deductions to other trades. Never a standalone estimate. | Not selectable as a top-level trade. Surfaced as a measurement object referenced by other trades. |
| `future_supported` | On the roadmap. Detected (low confidence) and listed in the trade panel as "Coming soon — manual estimating only". No auto-populate. | Visible, disabled, with reason badge. |
| `unsupported` | Not detected, not estimated, not surfaced. | Hidden. |

A trade may **never** be silently promoted from `future_supported` to `mvp_supported` without a documented contract change here and corresponding regression tests.

---

## 2. Canonical trade IDs

Trade IDs are stable, lowercase, snake_case. They are the keys used in every downstream contract (`DetectedTrade.trade_id`, `MaterialRule.trade_id`, `LaborRule.trade_id`, `AssemblyTemplate.trade_id`).

| `trade_id` | Display name | Category | Status |
|---|---|---|---|
| `roofing` | Roofing | Envelope | `mvp_supported` |
| `exterior_walls_siding` | Exterior Walls / Siding | Envelope | `mvp_supported` |
| `paint_coatings` | Paint / Coatings | Finishes | `mvp_supported` |
| `gutters_fascia_trim` | Gutters / Fascia / Trim | Envelope | `mvp_supported` |
| `windows_doors` | Windows & Doors | Openings | `measurement_object_only` |
| `drywall` | Drywall | Interior | `future_supported` |
| `framing` | Framing | Structure | `future_supported` |
| `insulation` | Insulation | Envelope | `future_supported` |
| `flooring` | Flooring | Finishes | `future_supported` |
| `concrete` | Concrete | Structure | `future_supported` |
| `electrical` | Electrical | MEP | `future_supported` |
| `plumbing` | Plumbing | MEP | `future_supported` |
| `hvac` | HVAC | MEP | `future_supported` |

---

## 3. MVP trade specs

For each `mvp_supported` trade: required inputs, optional inputs, supported source document types, and user-review gates that block auto-populate.

### 3.1 `roofing`

**Supported source document types**
- `roofr_roof_report` (parser shipped — `_shared/parsers/roofr-roof.ts`)
- `eagleview_roof_report` (parser shipped — `_shared/parsers/eagleview-roof.ts`)
- `manual_roof_measurement` (existing `roof_measurements` table row, override-validated or customer_report_ready)

Blueprint sheet extraction is **out of scope** for roofing at MVP. Roof takeoff comes from vendor reports or the in-house measurement system only.

**Required measurement inputs** (any one source must supply all of these or the trade is downgraded to `needs_review`):
- `roof_area_sqft` (gross)
- `predominant_pitch`
- `eaves_lf`
- `rakes_lf`
- `valleys_lf`
- `hips_lf`
- `ridges_lf`

**Optional measurement inputs** (used when present, defaulted with a review flag otherwise):
- `pitched_area_sqft`, `flat_area_sqft`
- `facet_count`
- `pitch_areas_breakdown` (array of `{pitch, area_sqft}`)
- `step_flashing_lf`
- `wall_flashing_lf`
- `penetration_count`
- `waste_table` (array of `{waste_percent, suggested_area}`)
- `vendor_material_calculations` (shingles, starter, ice & water, underlayment, hip/ridge cap, valley metal, drip edge)

**User-review gates (block auto-populate until resolved):**
- `shingle_brand_unselected`
- `underlayment_type_unselected`
- `tear_off_layers_unspecified`
- `waste_factor_defaulted` (only blocks if measurement source did not supply a waste table)
- `permit_disposal_warranty_unconfirmed`

### 3.2 `exterior_walls_siding`

**Supported source document types**
- `eagleview_wall_report`
- `roofr_wall_report` (if/when shipped — currently `future_supported` source)

**Required measurement inputs**
- `gross_wall_area_sqft`
- `window_door_area_sqft`
- `window_door_count`
- `window_door_perimeter_lf`
- `outside_corners_lf` *or* `outside_corners_count`
- `inside_corners_lf` *or* `inside_corners_count`

**Derived (computed, not extracted):**
- `net_wall_area_sqft = gross_wall_area_sqft − window_door_area_sqft`

**Optional measurement inputs**
- `wall_area_by_elevation` (array of `{elevation_id, area_sqft, direction}`)
- `wall_facet_count`
- `top_of_wall_lf`, `bottom_of_wall_lf`
- `fascia_lf`, `eaves_lf`, `rakes_lf` (shared with roofing / gutter source data)
- `wall_height_by_elevation`

**User-review gates**
- `siding_product_unselected`
- `wrb_type_unselected`
- `wall_height_assumed` (only when not supplied by source)
- `accessory_assumptions_unconfirmed` (trim profile, corner trim style, J-channel, etc.)

### 3.3 `paint_coatings`

Paint is a **derived trade**: it cannot run unless `exterior_walls_siding` measurements are present (or, in a future phase, drywall measurements). Paint never extracts its own measurements at MVP.

**Required inputs (sourced from `exterior_walls_siding`):**
- `gross_wall_area_sqft`
- `window_door_area_sqft`

**Derived:**
- `paintable_area_sqft_gross = gross_wall_area_sqft`
- `paintable_area_sqft_net = gross_wall_area_sqft − window_door_area_sqft`

The estimate-mapping contract decides which (gross vs net) is used per template; the importer never silently picks one.

**User-review gates**
- `coats_count_unspecified` (template must declare or user must answer)
- `primer_required_unspecified`
- `paint_product_unselected`
- `gross_vs_net_paintable_area_unselected`

### 3.4 `gutters_fascia_trim`

**Supported source document types**
- `eagleview_wall_report` (fascia, eaves, rakes, corners)
- `eagleview_roof_report` (eaves, rakes)
- `roofr_roof_report` (eaves, rakes)

**Required measurement inputs (any combination that produces eaves_lf and fascia_lf):**
- `eaves_lf`
- `fascia_lf` *or* fallback `eaves_lf` with `fascia_assumed_equal_to_eaves` review flag

**Optional measurement inputs**
- `rakes_lf`
- `outside_corners_count`, `inside_corners_count`
- `wall_facet_count` (proxy for downspout candidate count)
- `gutter_runs_breakdown` (array of `{elevation_id, length_lf}`) — rare in vendor reports

**User-review gates**
- `gutter_profile_unselected` (5", 6", K-style, half-round, box)
- `downspout_spacing_unspecified` (defaults to template, flagged)
- `downspout_count_unconfirmed`
- `elbow_outlet_accessory_assumptions_unconfirmed`
- `fascia_assumed_equal_to_eaves` (only when fascia_lf was not directly supplied)

### 3.5 `windows_doors` (measurement-object-only)

Not a standalone trade. Provides typed measurement objects consumed by `exterior_walls_siding`, `paint_coatings`, `gutters_fascia_trim`, and (future) `drywall`.

Extracted objects:
- `window_door_count`
- `window_door_area_sqft`
- `window_door_perimeter_lf`
- Optional schedule rows from blueprint window/door schedules (future phase only)

The importer must not surface "Windows & Doors" as a selectable estimate trade in the Phase 3 UI.

---

## 4. Future-supported trades (explicit exclusions for Phase 3)

The following trades MUST remain `future_supported` until the corresponding capabilities are contract-locked. The importer may display them in the trade panel with a disabled state and a reason badge, but **must not** auto-populate materials or labor for them.

| Trade | Blocking capability gap |
|---|---|
| `drywall` | Requires scaled floor-plan + reflected-ceiling-plan extraction, wall-type schedule parsing, finish-level schedule parsing, opening-deduction logic. No sheet intelligence shipped. |
| `framing` | Requires structural sheet parsing (S-series), wall-type schedules, header/beam/post schedules, truss/rafter schedules, connector schedules. No structural parser shipped. |
| `insulation` | Requires wall-type + assembly extraction (R-value by assembly), ceiling/floor area extraction. |
| `flooring` | Requires room-area extraction from floor plans + finish schedule parsing. |
| `concrete` | Requires foundation-plan parsing, slab-area extraction, footing schedules. |
| `electrical`, `plumbing`, `hvac` | Require MEP sheet parsing (E/P/M series), schedule extraction (panel, fixture, equipment), discipline-specific symbol recognition. |

Re-classifying any of these as `mvp_supported` requires:
1. A new spec section in this document with required inputs and review gates.
2. Source-document parser(s) shipped and regression-tested.
3. Material + labor rules added to `blueprint-estimate-mapping-contract.md`.
4. Phase plan amendment in `blueprint-mvp-phase-plan.md`.

---

## 5. Trade detection signals

The trade detector maps document content to candidate trades. Each signal carries a per-trade confidence contribution; total confidence is normalized and surfaced in the UI.

| Signal source | Signals (examples) | Contributes to |
|---|---|---|
| Document classifier | `document_type=roofr_roof_report` | `roofing` (high) |
| Document classifier | `document_type=eagleview_wall_report` | `exterior_walls_siding` (high), `gutters_fascia_trim` (medium), `paint_coatings` (medium via wall-area dependency) |
| Blueprint sheet index | Sheet prefix `A` + title containing "Roof Plan" | `roofing` (low — supplementary only at MVP) |
| Blueprint sheet index | Sheet prefix `A` + title containing "Elevations" | `exterior_walls_siding` (low) |
| Blueprint sheet index | Sheet prefix `A6` + "Wall Types" / `A9` + "Finish Schedule" | `drywall` (future), `framing` (future) |
| Blueprint sheet index | Sheet prefix `S` | `framing` (future), `concrete` (future) |
| Blueprint sheet index | Sheet prefix `M` / `P` / `E` / `FP` | `hvac`/`plumbing`/`electrical` (all future) |
| Spec book | CSI Division 07 sections | `roofing`, `exterior_walls_siding`, `insulation` |
| Spec book | CSI Division 09 sections | `paint_coatings`, `drywall` (future), `flooring` (future) |

For Phase 3, only `mvp_supported` trades may be surfaced as ready-to-estimate. `future_supported` trades may be listed with detected confidence but must not enable auto-populate actions.

---

## 6. Confidence floor

A trade is only surfaced as `ready_for_user_selection` when:
- Status is `mvp_supported`, AND
- All required measurement inputs are available from at least one supported source, AND
- Detection confidence ≥ 0.70.

Otherwise the trade is surfaced as `needs_review` with the missing inputs listed. The user may still accept it, but auto-populate is gated until the gaps are resolved.

---

## 7. Non-goals (Phase 3)

- No blueprint sheet intelligence (sheet-index navigation, schedule parsing, dimension-string extraction, scaled measurement).
- No structural schedule parsing.
- No MEP parsing.
- No automatic wall-type or assembly inference.
- No automatic finish-level inference.
- No OCR fallback for scanned-only blueprint sets (review queue only).

These remain on the roadmap and are scoped in `blueprint-mvp-phase-plan.md`.
