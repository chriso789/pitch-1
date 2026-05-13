## Goal

Enable uploading a vendor material quote (PDF) **on an estimate template**. When the template is used to create an estimate for a project, the quote is copied into that project's documents, parsed by AI (any vendor), and used to update the line-item costs on **that estimate only** (not the template).

## Architecture

```text
TEMPLATE EDITOR                   ESTIMATE / PROJECT
─────────────                     ──────────────────
[Attach Quote PDF] ── upload ──► documents (template-scoped)
        │                          │
        │                          └─ estimate_template_attachments (link)
        │
        │  (when template applied to project)
        ▼
   copy document  ──────────────► documents (project-scoped, document_type='vendor_quote')
                                   │
                                   ▼
                         parse-vendor-quote edge fn (Gemini)
                                   │
                                   ▼
                         vendor_quote_line_items (qty, unit, unit_cost, sku, name)
                                   │
                                   ▼
                         match to estimate line items → propose cost updates
                                   │
                                   ▼
                         user confirms → estimate line_items.unit_cost updated
                                   │
                                   ▼
                         line_total recalculated (existing engine standard)
```

## Database changes

1. **New table `vendor_quote_line_items`** — one row per parsed line on a quote PDF.
   - `id`, `tenant_id`, `document_id` (→ documents), `estimate_id` (nullable, set when applied to estimate)
   - `line_number`, `raw_text`, `sku`, `manufacturer`, `description`, `qty`, `unit`, `unit_cost`, `line_total`
   - `match_status` (`unmatched` | `matched` | `applied` | `ignored`), `matched_template_item_id`, `matched_estimate_line_id`
   - RLS: tenant-scoped via `useEffectiveTenantId()` rules.
2. **Reuse** existing `documents` table — already has `vendor_name`, `invoice_number`, `invoice_amount`. Add `document_type='vendor_quote'`. No schema change needed there.
3. **Reuse** existing `estimate_template_attachments` — already links `template_id` ↔ `document_id`. No schema change.
4. **Storage bucket** `vendor-quotes` (private, tenant-scoped path `{tenant_id}/templates/{template_id}/{filename}` and `{tenant_id}/projects/{project_id}/{filename}`) with RLS per the storage path conventions memory.

## Edge function

`parse-vendor-quote` (new):
- Input: `{ document_id }`.
- Loads the PDF from Storage, calls Gemini vision (same pattern as the existing AI Invoice Processing memory) to extract `{ vendor_name, quote_number, line_items[] }`.
- Updates the `documents` row (`vendor_name`, `invoice_number`).
- Inserts rows into `vendor_quote_line_items`.
- Returns the parsed payload for the UI to review.

## Frontend changes

1. **`SmartTemplateEditor.tsx`** — replace the stub `handleUpdateCosts` and add a real "Attach Vendor Quote" button:
   - Opens a file picker (PDF only).
   - Uploads to `vendor-quotes` storage, creates `documents` row, inserts `estimate_template_attachments` row.
   - Shows attached quotes list with download/remove.
2. **Template-to-estimate flow** — in the existing "create estimate from template" path, copy each template attachment into the new project's `documents` (cloned file or same path with new `documents` row scoping `project_id`), then invoke `parse-vendor-quote` for each.
3. **Estimate editor** — new "Vendor Quote Costs" panel (only visible when the estimate's project has parsed `vendor_quote_line_items`):
   - Lists parsed lines next to the matched estimate line items (match by `sku` first, then fuzzy name via existing `material_item_match_rules`).
   - Per-row "Apply" updates the estimate line's `unit_cost`; recalculation uses the existing engine standard (don't touch `selling_price`, recalc `line_total`).
   - "Apply all matched" bulk action.

## Out of scope (intentionally)

- The template's own `template_items.unit_cost` is **not** modified — quotes apply to the project/estimate only, per the user's instruction.
- No supplier-API integration in this feature; parsing is vendor-agnostic via Gemini.

## Verification

1. Open a template, attach a sample SRS/ABC PDF — confirm document appears in attachments list and in `documents` table with `document_type='vendor_quote'`.
2. Create an estimate from that template on a real project — confirm the document is duplicated into project documents and `parse-vendor-quote` runs (check edge logs).
3. Open the estimate, verify the Vendor Quote Costs panel shows extracted lines with matches.
4. Apply a row, confirm `unit_cost` updates on the estimate line and `line_total` recalculates; template `unit_cost` is unchanged.
5. Re-open the template — attached quote still listed; template costs untouched.
