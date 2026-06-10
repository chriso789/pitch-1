# Build Plan

Four independent slices. Ship in this order so each one is testable before the next.

## 1. Server-side page rasterization (fixes empty Preview + Plan Data)

**Why it's empty today:** PDFs are uploaded but no process turns each page into an image. `plan_pages.image_url` stays null, so Preview shows "No rendered preview image" and the page detail shows "No page image".

**Approach:**
- New Storage bucket `blueprint-page-images` (private, tenant-scoped path `{tenant_id}/{document_id}/page-{n}.jpg`).
- New edge function `rasterize-blueprint-pages` that:
  - Downloads the PDF from `blueprint-source-documents`.
  - Uses `pdfjs-dist` (via `npm:` specifier) + `@napi-rs/canvas` substitute (`pdfjs-dist/legacy` headless render) to rasterize each page at ~150 DPI to JPEG 0.7.
  - Uploads each page image, updates `plan_pages.image_url` and `plan_pages.thumbnail_url`.
  - Idempotent: skips pages that already have `image_url`.
- Called automatically at the end of `upload-blueprint-document` (fire-and-forget, non-blocking).
- "Render this page" button in the page detail view to retry a single page on demand.

**UI:**
- Preview dialog and BlueprintDocumentDetail page already read `image_url`; just need it populated. Add a small "Rendering…" badge per page while `image_url` is null and a job is in-flight.

## 2. Expanded trade taxonomy (kills "unknown")

**Two-stage classifier in `_shared/blueprint-importer/document-classifier.ts`:**

**Stage A — Rule-based (deterministic, free):**
Map by sheet-number prefix + title keywords. New taxonomy:
```
A-### + keyword "framing"       → interior_framing
A-### + keyword "drywall|gwb"   → drywall
A-### + keyword "finish"        → interior_finishes
A-### + keyword "reflected"     → rcp_ceiling
A-### default                   → architectural
S-###                           → structural_framing
M-###                           → mechanical
E-###                           → electrical
P-###                           → plumbing
FP-### / F-### + fire           → fire_protection
+ keywords: "flashing", "stucco", "siding", "roofing", "waterproofing",
            "insulation", "millwork", "casework", "door schedule", "window schedule"
```

**Stage B — AI fallback (only on remaining `unknown`):**
Extend `describe-blueprint-document` to also send each unknown page's title + sheet number (and image if rendered) to Gemini Flash with a strict enum and write back `page_type` + `page_subtype` + `trades_present[]`.

**UI changes in `BlueprintPageList.tsx`:**
- Show **Sheet # · Page title** as the primary label (use `page_title` from DB; back-fill via AI when missing).
- Replace single `Detected Type` badge with `Detected Type` + `Sub-type` badges (e.g. `architectural` / `interior framing`).
- Trade-to-quote dropdown options expanded to match new taxonomy.

## 3. Auto-extracted scale (replace input with editable display)

- Extend `describe-blueprint-document` to also extract `scale_text` per page (regex first on extracted PDF text — `1/4" = 1'-0"`, `1:50`, etc.; AI fallback if not found).
- In `BlueprintPageList.tsx`, replace the always-on `<Input>` with a read-only display chip that:
  - Shows the extracted scale, or "—" if not found.
  - Hover → "Edit" icon button → flips that single cell into an inline `<Input>` (manual override).
  - Saves on blur to `plan_pages.scale_text` (already supported).

## 4. Estimates: multi-select toggle + separate per-estimate orders

**Top "Estimate & Materials" bar (`src/features/estimates/...`):**
- Add a "Combine selected" toggle in the Saved Estimates header.
- When ON, ticking the circles on the left of each saved estimate adds it to the budget rollup at top: `Σ(Estimate)`, `Σ(Materials)`, `Σ(Labor)`, `Σ(Overhead)`, `Σ(Profit)`, `Σ(Total)`.
- The currently-Active estimate is always included; other ticks add to it.
- When OFF, behavior reverts to today (only Active estimate counts).

**Per-estimate isolation for orders (important):**
Material orders and labor orders are scoped to the *individual* estimate, not the combined view. The combined bar is presentation only — clicking "Send Material Order" or "Send Labor Order" still opens the per-estimate workflow so each estimate's PO/labor order goes out separately to the right vendor/crew. No data merging at the order layer.

## Database changes

```sql
-- 1. Storage bucket created via tool (not SQL)

-- 2. plan_pages additions
ALTER TABLE public.plan_pages
  ADD COLUMN IF NOT EXISTS thumbnail_url text,
  ADD COLUMN IF NOT EXISTS page_subtype text,
  ADD COLUMN IF NOT EXISTS scale_source text  -- 'pdf_text' | 'ai' | 'manual'
  ;

-- 3. plan_documents additions
ALTER TABLE public.plan_documents
  ADD COLUMN IF NOT EXISTS rasterization_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS rasterization_error text;
```

No new tables, no RLS changes needed (existing `plan_pages` / `plan_documents` policies cover the new columns).

## Files touched (summary)

**New:**
- `supabase/functions/rasterize-blueprint-pages/index.ts`

**Edited:**
- `supabase/functions/upload-blueprint-document/index.ts` — kick off rasterization
- `supabase/functions/describe-blueprint-document/index.ts` — extract scale + classify unknowns
- `supabase/functions/_shared/blueprint-importer/document-classifier.ts` — expanded taxonomy
- `src/components/blueprint/BlueprintPageList.tsx` — sheet+title display, sub-type badge, scale display+edit
- `src/components/blueprint/BlueprintPerPageBreakdown.tsx` — new trade labels
- `src/pages/BlueprintDocumentDetail.tsx` — "Rendering…" state, retry button
- `src/features/estimates/...` (Saved Estimates list + top bar) — combine toggle + summed bar

## Out of scope (explicit)

- No changes to the order/PO submission flow itself — only adding the multi-select rollup view above it.
- No changes to measurement/geometry pipelines.
- No new auth or RLS.

Reply "go" and I'll implement in the order above (rasterization first, since that fixes the most visible bug).