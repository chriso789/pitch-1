## Goal
Make change orders feel like a first-class document — viewable as an official, branded PDF-style page (same header/footer treatment as estimates), with proper edit/delete/approve actions, and surfaced in the job's Documents tab the moment they are created.

## 1. Official Change Order document view

Create `src/components/change-orders/ChangeOrderDocumentView.tsx` — a full-page-style preview rendered inside a Dialog (same pattern as `EstimatePreviewPanel` / `EstimatePDFDocument`).

Header / footer reuse the same composition pieces estimates already use:
- Company logo + name + address + phone/email (pulled from `companies` for the project's tenant/location, mirroring `EstimatePDFDocument` lines 276–349).
- "CHANGE ORDER" title block with `co_number`, created date, status badge, and customer name/address.

Body sections:
- Reason for change
- Original scope vs. New scope (two-column block)
- Line items table grouped by Materials / Labor (uses `change_orders.line_items` jsonb)
- Totals block: Subtotal, Overhead %, Profit %, **Cost Impact (this CO)**, Time Impact (days)
- Optional signature line for customer approval

The view is opened from a new **"View"** button on each row in `ChangeOrdersTab.tsx`. A **"Download PDF"** button uses the existing `html2canvas + jsPDF` helper used by estimates (scale 1.5, JPEG 0.65 per project rules).

## 2. Edit / Delete / Add-to-Budget actions

Replace the current row footer (single Delete) with a proper action bar on each accordion row and inside the document view:

- **Edit** — opens `ChangeOrderForm` in edit mode (preload existing record, update instead of insert).
- **Delete** — existing behavior, kept.
- **Add to Project Budget** — flips `customer_approved=true`, stamps `customer_approved_at`, sets `status='approved'`, and bumps the project's contracted value. Because `projects` has no price column, the "project price" total is derived from `estimates.total` + Σ approved CO `cost_impact` (via a small helper `useProjectContractValue(projectId)`). The Profit Center / Financial bars already read estimates + invoices; this hook adds the approved-CO sum so the displayed contract value increases the moment the user clicks the button. No schema migration needed.

## 3. Auto-create a Documents row when a CO is created

In `ChangeOrderForm.tsx` and the inline create flow inside `ChangeOrdersTab.tsx`, after successful insert into `change_orders`:

1. Generate the Change Order PDF via the same html2canvas+jsPDF path used by estimates.
2. Upload to the `documents` storage bucket at `{tenant_id}/change-orders/{co_id}.pdf` (matches storage RLS path convention).
3. Insert into `documents` with:
   - `pipeline_entry_id` = the lead's pipeline entry
   - `document_type = 'change_order'` (new value added to `DOCUMENT_CATEGORIES` in `DocumentsTab.tsx` with a FileEdit icon)
   - `filename = '{co_number} — {title}.pdf'`
   - `file_path` = the uploaded path
   - `description` = CO reason
4. If the CO is later edited, regenerate the PDF and overwrite the same documents row (matched by a new nullable `change_orders.document_id` column → small migration).

A new `Documents` category tile labeled **Change Orders** will appear alongside Contracts / Estimates / Invoices in the Documents tab.

## 4. Small schema migration
Single migration adds `change_orders.document_id uuid references documents(id) on delete set null` so the generated PDF stays in sync with the CO record.

## Technical notes
- All queries continue to filter by `tenant_id` via `useEffectiveTenantId()`.
- PDF generation runs client-side (no edge function needed) — same scale 1.5 / JPEG 0.65 settings as estimates to keep <10MB.
- The "Add to Project Budget" button is gated to admins/managers only via the existing role hooks already used elsewhere in the lead view.
- No changes to the AI Measurement pipeline.