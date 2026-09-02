# Blueprint Roofing Trade Engine

Status: implemented on top of Blueprint F1 foundation. Preview/review only; no CRM estimate writes.

## Canonical entrypoint

Use `buildSafeRoofingTakeoff()` from `supabase/functions/_shared/parsers/blueprint-roofing-engine.ts`.

It consumes F1 page layouts, drawing viewports, calibrated/reviewed geometry evidence, and F1 spec candidates.

## Quantities emitted

Only calibrated/reviewed geometry may emit SF/LF. The engine supports:

- total roof area (facet polygons preferred; outline area excluded when facets exist)
- eaves
- rakes
- ridges
- hips
- valleys
- roof-to-wall
- parapet
- generic flashing
- step flashing

Discrete, short PDF labels may emit review-required counts for:

- roof drains
- scuppers
- roof curbs / labeled rooftop equipment
- penetrations / vents

Pitch/slope labels emit `predominant_pitch` candidates using the existing importer pitch-ratio convention (rise over 12, quantity = rise).

## Specifications emitted

F1 roofing/insulation/deck spec candidates are bridged into `blueprint_trade_specifications`. Roofing warranty text is also normalized with year + NDL fields when deterministically detected.

## Provenance

Every measurement/spec candidate carries a deterministic PlanPath key pointing back to page, viewport, source text/coordinates, and source document. `persistRoofingTakeoff()` resolves these keys to `blueprint_plan_paths` and upserts measurements/specs idempotently.

## Safety rules

- Missing architectural scale blocks polygon area.
- Linear geometry requires an already calibrated/reviewed `length_ft`.
- Text bounding boxes are never converted to SF/LF.
- Count labels remain review-required and are not treated as symbol recognition.
- No waste factor is inferred.
- No material SKU/product selection is inferred.
- No pricing, proposal, purchase-order, production, or CRM estimate write is enabled.
- `ROOF_AREA_NOT_AVAILABLE` blocks area-driven material generation.

## Next integration

Wire the canonical engine after F1 persistence for accepted/detected roofing sessions. Persist engine review flags into `blueprint_review_flags`, then teach Phase 4 material generation to consume confirmed `blueprint_trade_specifications` in addition to roofing measurement objects.
