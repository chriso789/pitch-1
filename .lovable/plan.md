## Supplement Scope Analyzer Accuracy Fix

The root cause is that `scope-document-ingest` hands merged PDF text to AI and then relies on fuzzy matching downstream. We will flip the architecture: **deterministic parsing first, AI only as fallback/explainer**, and build a dedicated comparison engine with auditable results. Existing UI (`SupplementEngine`, `SupplementWorkflow`, `ScopeUploader`, `ScopeDocumentBrowser`, `useScopeIntelligence`) will be wired into the new engine, not replaced.

### Phase 1 — Database migration
New migration `scope_compare_accuracy.sql`:
- `scope_compare_runs` — per-run summary (totals, deltas, counts, analysis_json)
- `scope_compare_results` — one row per matched/missing/delta line with carrier+contractor snapshots, confidence, evidence
- `scope_parse_debug_rows` — every raw line attempted with accepted/rejected reason
- Add columns to `insurance_scope_line_items` if missing: `remove_price`, `replace_price`, `effective_unit_price`, `parser_layout`
- Indexes on tenant_id, job_id, claim_id, compare_run_id, document_id, result_type
- RLS scoped via active tenant pattern already used in the project

### Phase 2 — Shared normalization library
`supabase/functions/_shared/scope-normalizer.ts` exports:
- `normalizeMoney`, `normalizeQuantity`, `normalizeUnit`, `normalizeDescription`
- `stripActionPrefix` (Remove / R&R / R/R / replace / clean / paint)
- `canonicalScopeKey` with curated mappings for laminated shingles, tear-off, felt, drip edge, starter, hip/ridge, pipe jack, valley metal, dumpster, water barrier tape, re-nailing, butyl caulk, gutter/downspout, tarp, pressure cleaning, stucco seal/paint, gooseneck vent, etc.
- `classifyTrade`, `classifyScopeGroup` → roofing / demolition / moisture_protection / ventilation / flashing / exterior_painting / stucco / gutter / temporary_repair / cleaning / other
- `calculateLineTotal`, `nearlyEqual`
- Raw `raw_description` is never mutated; normalization is only used for matching keys.

### Phase 3 — Deterministic Xactimate line parser
`supabase/functions/_shared/xactimate-line-parser.ts`:
- Walk page text line-by-line; detect section/room headers (Roof, Dwelling Roof, elevations, Tarp, Exterior, CONTINUED sections).
- Detect Layout A (`DESCRIPTION QUANTITY UNIT PRICE TAX RCV DEPREC. ACV`) vs Layout B (`DESCRIPTION QTY REMOVE REPLACE TAX TOTAL`).
- Parse numbered rows, **merging wrapped description lines** into the active line until the next numbered row or Totals.
- Capture quantity, unit, remove_price, replace_price, unit_price, tax, total_rcv, depreciation, total_acv, page, section, layout_type.
- Reject non-line rows (headers, recap, disclaimers, drawings, policy letters) and persist them to `scope_parse_debug_rows` with rejection_reason.
- Parse document totals (Line Item Total, Material Sales Tax, RCV, ACV, Net Claim, deductible, recoverable depreciation).
- Compute effective_unit_price for Layout B (REMOVE / REPLACE / REMOVE+REPLACE depending on action).

### Phase 4 — Rework `scope-document-ingest`
1. Extract PDF text via existing `unpdf` flow.
2. Run `parseXactimateLines`.
3. If parser returns ≥1 item AND reconciles within ~2% of document RCV → use as source of truth, AI cannot overwrite numbers.
4. Otherwise call existing AI extraction as fallback, tag `fallback_used: true`.
5. Insert parsed lines into `insurance_scope_line_items` (with new columns).
6. Insert debug rows.
7. Update `insurance_scope_documents.raw_json_output` with `parser_version`, `parser_type` (deterministic | ai_fallback | hybrid), `layout_detected`, `warnings`, counts.
8. Existing AI path is preserved as fallback only.

### Phase 5 — Comparison edge function
`supabase/functions/compare-scope-documents/index.ts`:
- Body: `{ carrier_document_id, contractor_document_id, job_id?, claim_id? }`
- Auth + active tenant resolution.
- Load both sides' line items, normalize via shared lib.
- Weighted match scoring:
  - canonical key exact +0.50, same unit +0.15, same group +0.10, qty close +0.10, token-similarity>0.75 +0.15, action match +0.05
  - action-mismatch penalty unless contractor R&R ↔ carrier remove+replace split
- Thresholds: ≥0.86 accept, 0.70–0.85 possible (warning), <0.70 missing.
- One-to-one assignment; carrier line can only match one contractor line unless action-split logic triggers.
- Produce result rows: `exact_match`, `fuzzy_match`, `missing_from_carrier`, `missing_from_contractor`, `quantity_delta`, `price_delta`, `total_delta`, `tax_delta`.
- Severity: critical if missing_from_carrier total ≥ $250 or total_delta ≥ $250; warning for smaller deltas; info for exact.
- Insert `scope_compare_runs` + `scope_compare_results`, return full report JSON.
- Encode the special-case canonical mappings called out (tear-off ↔ Remove Laminated, drip edge ↔ R&R drip edge, pipe jack lead, hip/ridge cap variants, pressure clean, seal & paint stucco, etc.).

### Phase 6 — UI wiring (no replacement)
In `SupplementEngine.tsx`, `SupplementWorkflow.tsx`, `useScopeIntelligence.ts`:
- Carrier + contractor document selectors.
- "Run Scope Comparison" button → `supabase.functions.invoke('compare-scope-documents', ...)`.
- Results table grouped: Missing From Carrier / Qty Diffs / Price Diffs / Total Diffs / Matched.
- Summary cards: Carrier RCV, Contractor RCV, Difference, Missing-from-carrier total, Qty delta total, Tax delta, Avg match confidence.
- Debug drawer: parsed rows, rejected rows, layout, warnings, AI fallback flag.
- Export buttons: JSON, CSV, Generate Supplement Report (reuses existing `generate-supplement-report`).

### Phase 7 — Report output
Sections: Claim/Property Summary → Totals Comparison → Missing Items From Carrier → Qty Differences → Unit Price Differences → Tax/Total Differences → Matched Items → Parser Audit Log. Each row carries description, qty, unit, prices, totals, section, reason, evidence, and (for deltas) both sides + match confidence + explanation.

### Phase 8 — Acceptance tests against provided documents
Hard-coded expectations validated in a Deno test for `compare-scope-documents`:
- Carrier: RCV 14,718.16; ACV 9,906.11; deductible 5,760.00; net 4,146.11; roof subtotal ~10,970.08; 21 line items.
- Contractor: RCV 29,417.87; net 29,417.87; roof subtotal 16,363.21; tarp subtotal 1,704.60; 35 line items.
- Total RCV difference 14,699.71.
- Missing-from-carrier must include: water barrier joint taping, 20-yd dumpster, gooseneck vent R&R, re-nailing sheathing, butyl caulking, R&R gutter/downspout 6", tarp poly, final cleaning, stucco patch.
- Quantity deltas must surface: valley metal 22→42 LF, hip/ridge cap 88→118 LF, pipe jack 2→3 EA, drip edge 224→227.95 LF.

### Phase 9 — Quality gates
- Parsed totals must reconcile within 2% of document RCV or attach warning.
- Zero items parsed → fail with clear error.
- Layout undetected → mark `parser_layout = unknown`, fall back to AI.
- AI fallback can never overwrite a deterministic number; AI value stored separately.
- Duplicate line numbers preserved + flagged `duplicate_line_number`.
- Best-match-only enforcement, with action-split exception.
- Same description across elevations stays separate by `section_name`; only grouped in summary rollups.

### Phase 10 — Deployment
- Add migrations + deploy `scope-document-ingest`, `compare-scope-documents`.
- TypeScript + Supabase linter checks.
- Verify RLS policies on the three new tables.
- Structured logs prefixed `[scope-parser]`, `[scope-compare]`, `[scope-debug]`.
- Surface clear UI errors; do not regress existing supplement workflow.

### Technical notes
- All new tables tenant-scoped via the existing `useEffectiveTenantId` / profile-based pattern; never bypass RLS.
- Edge functions use `npm:` specifiers and explicit `Deno.serve(handler)` per project rules.
- Description normalization is matching-only; persisted `raw_description` always preserved exactly as parsed.
- Existing AI extraction path stays intact behind a fallback flag — no functional regression for documents the deterministic parser cannot handle.

### Open questions
1. Should "possible match" (0.70–0.85) rows appear in the main results table by default or only in the debug drawer?
2. For action-split (carrier separate Remove + Replace vs contractor R&R), should we collapse into one delta row or keep two linked rows?
3. Do you want the Supplement Report PDF auto-generated at the end of a comparison run, or only when the user clicks Generate?
