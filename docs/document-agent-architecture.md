# Document Agent Architecture

Status: **Slice 1 shipped** (2026-05-22). Hybrid deterministic-first document parsing.

## Tier model

| Tier | Engine | Status | When it runs |
|---|---|---|---|
| 1 | Deterministic regex parsers (EagleView / Roofr roof report, blueprint classifier) | **Live** | Always first when selectable text exists |
| 2 | OCR fallback | **Deferred** | When `has_selectable_text=false` (currently → review queue) |
| 3 | Vendor/template rules | **Live (folded into Tier 1)** | n/a — vendor detection is part of Tier 1 |
| 4 | AI fallback (Lovable AI / OpenAI / Claude) | **DEFERRED — DO NOT ENABLE** | When `overall_confidence < 0.70` |
| 5 | Human review queue | **Live** | Whenever Tier 1 confidence < 0.70 or validation errors exist |

The Slice 1 contract is: **no AI provider is called.** Low-confidence runs enqueue a
`document_review_queue` row with `reason='low_confidence'` and return an envelope with
`requires_review: true`.

## Grouped functions

| Function | Routes shipped this slice |
|---|---|
| `pdf-api` | `POST /text`, `POST /extract-text` (alias), `POST /parse` (shim target) |
| `document-worker` | `POST /parse`, `POST /parse/roof-report`, `POST /classify`, `POST /ai-fallback` (501 by design) |
| `document-api` | scaffold-only — wired in Slice 2 |
| `roof-report-ingest` | scaffold-only — to be wired in Slice 2 |

## Persistence model

```
documents (existing)
   ├─ document_parser_runs        ← audit row per parser invocation
   ├─ document_extractions        ← current canonical extraction (1 per doc)
   ├─ document_extraction_versions ← immutable history of approved extractions
   └─ document_review_queue       ← human review backlog
```

Approved extractions (`approved_at IS NOT NULL`) are **never overwritten** —
reprocess creates a new version.

## Parsers shipped

| Parser | Vendor | File |
|---|---|---|
| `eagleview-roof v1.0.0` | EagleView roof reports | `_shared/parsers/eagleview-roof.ts` |
| `roofr-roof v1.0.0` | Roofr roof reports | `_shared/parsers/roofr-roof.ts` |
| `blueprint-classifier v1.0.0` | Architectural PDFs | `_shared/parsers/blueprint-classifier.ts` |

Both roof parsers run on every roof report; the higher `overall_confidence` wins.

## Confidence scoring

- 0.97 — exact labelled field ("Total Roof Area: 2,450")
- 0.88 — vendor summary section field
- 0.75 — table / repeated section
- 0.55 — single weak regex hit
- **< 0.70 → review queue** (Tier 5)

Overall = geometric mean of field confidences (one weak field drags the score).

## Validation rules

- `hips_ft + ridges_ft ≈ hips_ridges_combined_ft` (±1.5 ft)
- `eaves_ft + rakes_ft ≈ drip_edge_ft` (±1.5 ft)
- `total_area_sqft ≈ waste_table[0%]` (±0.5%)
- All length / area fields must be ≥ 0

Violations are persisted on the parser run but do **not** silently zero out fields.

## Legacy migration map (Slice 1)

| Old function | Status |
|---|---|
| `parse-roof-report` | **shimmed** → `document-worker /parse/roof-report` (when `document_id` is provided); legacy `measurements` / `pipeline_entry_id` paths fall through |
| `pdf-extract-text`, `pdf-parse`, `parse-blueprint-document`, `classify-blueprint-pages` | to be shimmed in Slice 2 |

## Tier 4 (AI) — future enablement contract

When AI fallback is eventually enabled it MUST:

1. Run **only** when `overall_confidence < 0.70` from Tier 1.
2. Persist its own `document_parser_runs` row with `parser_tier='ai'`.
3. Increment `current_version` — never overwrite Tier 1 evidence.
4. Refuse to fabricate missing fields; return `null` with a reason.
5. Respect approved extractions (`approved_at IS NOT NULL` → locked).
