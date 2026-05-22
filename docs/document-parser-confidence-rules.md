# Document Parser Confidence Rules (Slice 2A)

## Scoring (per field)
- `0.97` exact labelled field (`"Total Roof Area: 2,450"`)
- `0.88` vendor summary section field
- `0.75` table / repeated section hit
- `0.55` single weak regex hit

## Aggregation
`overall_confidence = geometric_mean(field_confidences)` — one weak field drags the score down hard.

## Gating
- `overall_confidence >= 0.70` → `status='succeeded'`, no review row.
- `overall_confidence < 0.70` → `status='low_confidence'`, `requires_review=true`, `document_review_queue` row inserted with `reason='low_confidence'`.
- `has_selectable_text=false` → `status='failed'`, review row `reason='no_text_extracted'`. OCR (Tier 2) deferred.
- AI fallback (Tier 4) is **not** invoked this slice. Low-confidence rows wait for human review or future AI enablement.

## Approval lock
- `document_extractions.approved_at IS NOT NULL` blocks reprocess (`document-api /documents/reprocess` returns `409 extraction_approved_locked`).
- Approving snapshots the current row into `document_extraction_versions` first, then sets `approved_at` on the live row.

## Vendor selection (roof report)
Both EagleView and Roofr parsers run. The winner is the one with higher `overall_confidence`. Vendor stored on the run + extraction rows.
