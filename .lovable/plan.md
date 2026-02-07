
## Summary of what’s actually failing (based on Edge Function logs)
The estimate lookup is now working. The real failure happens immediately after, when `send-quote-email` tries to insert a row into `quote_tracking_links`.

Edge logs show:
- Estimate lookup: `found: true` (estimate id `94749505-332e-4d82-9beb-7037b72f07f7`)
- Then database error:
  - `insert or update on table "quote_tracking_links" violates foreign key constraint "quote_tracking_links_estimate_id_fkey"`
  - `Key (estimate_id)=(...) is not present in table "estimates".`

That means **your database schema still enforces `quote_tracking_links.estimate_id → estimates(id)`**, but the system now uses **`enhanced_estimates`** as the authoritative source.

So the UI message “Estimate not found” is misleading; the estimate exists, but the tracking-link insert is blocked by the FK.

---

## Part 1 — Fix sending the quote (database schema + small function hardening)

### 1) Update the foreign key on `quote_tracking_links`
Current constraints confirm:
- `quote_tracking_links_estimate_id_fkey` references `estimates(id)`.

We will migrate it to:
- `quote_tracking_links.estimate_id` → `enhanced_estimates(id)`.

Because `quote_tracking_links` currently has **0 rows** (verified), this change is safe in Test.

**SQL to run (Test environment first):**
```sql
alter table public.quote_tracking_links
  drop constraint if exists quote_tracking_links_estimate_id_fkey;

alter table public.quote_tracking_links
  add constraint quote_tracking_links_estimate_id_fkey
  foreign key (estimate_id)
  references public.enhanced_estimates(id)
  on delete cascade;
```

### 2) Improve error mapping in `send-quote-email`
After the FK fix, this should work; but we’ll also harden the function so failures return clearer errors:
- If tracking-link insert fails, return a 500 with a helpful message (and keep detailed error in logs).
- Ensure we don’t incorrectly return 404 for downstream failures.

### 3) Verify end-to-end
After applying the SQL and redeploying (if needed):
- Open an existing saved estimate (the one you’re previewing/editing).
- Click Share → Send Quote.
- Confirm:
  - Email sends successfully
  - A `quote_tracking_links` row is created
  - The generated link opens `/view-quote/:token` successfully
  - `track-quote-view` can read the estimate data (it currently selects `enhanced_estimates(...)`)

---

## Part 2 — Fix cover page title + the underline rendering issue in exported PDFs

### What’s causing the “ROOFING ESTIMATE” title to appear
Your PDF export pipeline in `MultiTemplateSelector` renders a hidden `<EstimatePDFDocument />` for capture.
That hidden render **does not pass `estimateName`**, so `EstimateCoverPage` falls back to `'ROOFING ESTIMATE'` even when you have a proper estimate display name.

### 1) Pass the estimate name into the hidden PDF document
We will:
- Extend the `pdfData` object in `MultiTemplateSelector` to include `estimateName`
- When rendering `<EstimatePDFDocument />` in the hidden template, pass `estimateName={pdfData.estimateName}`

For the value, we’ll use a robust fallback order so the cover page always has something meaningful:
1) `estimateDisplayName` (what you typed / saved)
2) selected template name (e.g., “Owens Corning Duration”)
3) final fallback “ROOFING ESTIMATE”

### 2) Fix underline placement so it never crosses the text
Your screenshot shows the decorative line visually intersecting the title text in the exported PDF.
To make this deterministic across html2canvas/PDF rendering, we’ll adjust the cover page title styling to avoid “separate block line” positioning issues:
- Replace the separate line `<div className="w-24 ...">` with a more stable underline approach (for example: a `border-b` on an inline-block wrapper, or a dedicated block with safe spacing + line-height constraints).
- Add `leading-tight` (or explicit line-height) to the title to reduce baseline/overlap anomalies.

### 3) Fix incorrect estimate number in preview/export (if present)
In `MultiTemplateSelector`, `EstimatePreviewPanel` currently receives an `estimateNumber` derived from `existingEstimateId.slice(0, 8)` which is not the real `estimate.estimate_number`.
We will adjust it to use:
- `editingEstimateNumber` when editing a saved estimate
- otherwise a draft number

This ensures the cover page and header display the correct “EST-xxxxx” number consistently.

---

## Files we will change
### Backend
- `supabase/functions/send-quote-email/index.ts`
  - clearer error handling for tracking-link insert failures
  - (after schema fix) confirm inserts succeed and response is 200

### Frontend
- `src/components/estimates/MultiTemplateSelector.tsx`
  - include `estimateName` in `pdfData`
  - pass `estimateName` into `<EstimatePDFDocument />` in the hidden PDF template
  - use the correct estimate number (`editingEstimateNumber`) when available

- `src/components/estimates/EstimateCoverPage.tsx`
  - adjust title underline rendering to be stable in exported PDFs
  - ensure title uses the passed estimate name cleanly

---

## Step-by-step execution order (important)
1) Apply SQL FK migration in **Test** (so emails can be sent).
2) Update frontend export pipeline to pass the estimate name (fix “ROOFING ESTIMATE” issue).
3) Update cover page underline styling for stable rendering.
4) Re-test:
   - Export PDF: verify title and underline look correct
   - Share → Send Quote: verify it sends and link works
5) If everything works in Preview/Test, repeat the SQL change in **Live** before publishing (only if Live still has the old FK).

---

## Notes / risk checks
- The FK change is the critical blocker for sending quotes.
- Because `quote_tracking_links` currently has 0 rows in Test, we won’t hit data-migration complications there.
- If Live has existing `quote_tracking_links` rows pointing to legacy `estimates`, we’ll handle that carefully (either migrate rows or use `NOT VALID` constraint strategy). We’ll check Live counts before altering Live.

