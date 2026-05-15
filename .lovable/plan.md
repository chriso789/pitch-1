## Xactimate Comparison Tool — Insurance Tab

A new **Insurance** tab on the Project (Job) page that lets users upload the carrier's Xactimate PDF, attach or build the company's own Xactimate, run a full line-by-line diff, and export a supplement-ready report explaining every addition, removal, and price change for the carrier.

### What gets reused (already in the codebase)

- `scope_documents` + `scope_line_items` + `scope_headers` tables and the `scope-document-ingest` edge function (PDF → parsed Xactimate line items, carrier/format detection).
- `scope-comparison-analyze` edge function (existing matched/missing/discrepancy logic — extended for two-document compare).
- `XactScopeBuilder`, `XactAreaManager`, `XactScopeItemEditor`, `roofingScopeCatalog.ts` for company-built scope.
- `canonicalItems.ts` taxonomy for cross-side mapping.
- `xactimate-exporter` for ESX export of the supplement.
- `InsuranceClaimManager`, `ScopeDocumentBuilder`, `InsuranceSection`.

### New work

#### 1. Project "Insurance" tab
- Add `<TabsTrigger value="insurance">Insurance</TabsTrigger>` to `ProjectDetails.tsx` (after Estimate).
- New component `src/features/projects/components/ProjectInsuranceTab.tsx`:
  - **Carrier Estimate** card: upload Xactimate PDF → calls `scope-document-ingest` with `document_type: 'estimate'` and links `job_id`.
  - **Company Estimate** card: pick from existing company `scope_documents` for that job, OR launch `XactScopeBuilder` to build one in-app (saved as `document_type: 'company_scope'`).
  - **Run Comparison** button → opens `<XactComparisonView>`.

#### 2. Two-document comparison engine
- New edge function `xact-compare-documents`:
  - Inputs: `carrier_document_id`, `company_document_id`.
  - Joins line items by `canonical_item_id` (fall back to fuzzy `xactimate_code` + description match using existing mapping logic).
  - Emits a `ComparisonResult` with four buckets:
    - `added_by_company` (in company, not in carrier) — supplement candidates.
    - `removed_by_company` (in carrier, not in company) — flag for review.
    - `quantity_changes` (qty delta with %).
    - `price_changes` (unit price / RCV delta with %).
  - Persists to a new `scope_comparisons` table with `comparison_lines` child rows so reports are reproducible and auditable.

#### 3. Side-by-side review UI
- `XactComparisonView.tsx`:
  - Header with totals: carrier RCV vs company RCV, net delta, supplement amount.
  - Tabs/filters: All • Added • Removed • Qty Δ • Price Δ.
  - Each row: code, description, carrier qty/unit/price/RCV, company qty/unit/price/RCV, delta, justification textarea (required for Added/Price Δ rows before report can be generated).
  - Bulk-justify with AI button → calls existing AI rewriter to suggest justifications grounded in the line description, photos, and measurement report.
  - "Approve all" / per-row approve toggles.

#### 4. Supplement report generator
- New edge function `generate-supplement-report` (uses jsPDF/pdf-lib, same pattern as estimate PDFs):
  - Cover page: carrier, claim #, adjuster, property, deductible, totals.
  - Executive summary: counts of added/removed/changed + net supplement $.
  - Line-by-line section, grouped by category (Roofing / Gutters / Flashing / Charges):
    - Carrier line vs Company line shown side-by-side.
    - Δ qty, Δ unit price, Δ RCV.
    - Justification text + reference to evidence (photos, measurement report area, code requirement).
  - Appendix: full carrier estimate summary, full company estimate summary, signature block for adjuster.
  - Stored in Storage `{tenant_id}/projects/{project_id}/supplements/`.
- Optional: ESX export via existing `xactimate-exporter` so the carrier can re-import.

#### 5. Insurance tab also surfaces
- History of past comparisons / supplement versions (v1, v2…) from `scope_comparisons`.
- Status pill: Draft → Sent to Carrier → Approved/Denied/Partial (manual stage update + log to existing `insurance_claims` table).
- "Send to adjuster" action → existing email/SMS flow with the supplement PDF attached.

### Database changes
- New `scope_comparisons` table: `id, tenant_id, project_id, carrier_document_id, company_document_id, totals_json, status, created_by, created_at`.
- New `comparison_lines` table: one row per diff with `change_type`, carrier/company snapshots, `delta_qty`, `delta_price`, `delta_rcv`, `justification`, `approved`.
- RLS scoped by `tenant_id` (use `useEffectiveTenantId` pattern).
- New `supplement_reports` table: `id, comparison_id, version, pdf_url, esx_url, sent_at, status`.

### Files to create
- `src/features/projects/components/ProjectInsuranceTab.tsx`
- `src/components/insurance/XactComparisonView.tsx`
- `src/components/insurance/ComparisonLineRow.tsx`
- `src/components/insurance/SupplementReportPreview.tsx`
- `src/hooks/useXactComparison.ts`
- `supabase/functions/xact-compare-documents/index.ts`
- `supabase/functions/generate-supplement-report/index.ts`

### Files to edit
- `src/features/projects/components/ProjectDetails.tsx` — add Insurance tab + content.
- `src/components/xact-scope/XactScopeBuilder.tsx` — accept `job_id` and persist as a `scope_documents` row tagged `company_scope`.

### Open questions before I build

1. **Company estimate source** — should the "Company Xactimate" side accept (a) an uploaded Xactimate PDF the company already exported from Xactimate desktop, (b) a scope built with the in-app `XactScopeBuilder`, or (c) both? Default plan is both.
2. **Approval gate** — must every Added / Price-changed line have a typed justification before the report can be generated, or allow AI-only justifications without manual review?
3. **Send to carrier** — do you want the report delivered via email from inside the app (auto-attach + tracked), or just downloadable PDF + ESX for now?
