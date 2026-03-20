

# Fix Document Placement + Increase Font Sizes

## Problem 1: Documents Appear Mid-Report
When multiple estimates are selected, attachments (added documents) render at the end of the **primary** estimate's `EstimatePDFDocument`, but additional estimate pages follow after — so documents end up in the middle of the combined PDF instead of at the very end.

## Problem 2: Font Sizes Too Small
Customer info section and content text across the PDF pages use small font classes (`text-xs`, `text-sm`, `text-[10px]`). Need ~15% increase across the board.

---

## Changes

### File: `src/components/estimates/EstimatePreviewPanel.tsx`

**Move attachments to render after ALL estimates:**
- Remove `templateAttachments={allAttachments}` from the primary `EstimatePDFDocument` (line 1264) — pass nothing or empty array
- After the additional estimates loop (after line 1307), render `AttachmentPagesRenderer` directly:
  ```tsx
  {allAttachments.length > 0 && (
    <AttachmentPagesRenderer attachments={allAttachments} />
  )}
  ```
- Import `AttachmentPagesRenderer` at the top of the file

This ensures documents always appear at the very end of the combined output, regardless of how many estimates are selected.

### File: `src/components/estimates/EstimatePDFDocument.tsx`

**Font size increases (~15% bump) in FirstPage and related components:**

| Element | Current | New |
|---|---|---|
| "Prepared For" label | `text-[10px]` | `text-xs` (12px) |
| Customer name | `text-sm` (14px) | `text-base` (16px) |
| Customer address | `text-xs` (12px) | `text-sm` (14px) |
| Customer phone/email | `text-xs` (12px) | `text-sm` (14px) |
| Estimate name banner | `text-xl` | `text-2xl` |
| Item descriptions | `text-[10px]` | `text-xs` |
| Item notes | `text-[10px]` | `text-xs` |
| Item name in table | (no class → inherits ~14px) | `text-sm` explicitly |
| "Project Investment" label | `text-sm` | `text-base` |
| "Scope continues" hint | `text-[10px]` | `text-xs` |
| Table header cells | `text-xs` | `text-sm` |
| Table body row text | inherits small | `text-sm` |

These changes apply to: `FirstPage`, `ItemsTable`, `ItemsContinuationPage`, `PricingSummary`, and `TermsSection` components within the file.

