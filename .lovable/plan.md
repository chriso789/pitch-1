
# Fix: Duplicate Cover Page and Missing Attachments in Preview Export

## Problems Identified

### Problem 1: Cover Page Appears Twice in PDF

**Root Cause**: Double `data-report-page` nesting

In `EstimatePDFDocument.tsx` (lines 500-509), ALL page content is wrapped in `PageShell`:

```tsx
{pages.pages.map((pageContent, idx) => (
  <PageShell key={idx} {...commonProps} pageNumber={idx + 1}>
    {pageContent}
  </PageShell>
))}
```

But the `EstimateCoverPage` component ALREADY has its own `data-report-page` attribute (EstimateCoverPage.tsx line 71). This creates:

```text
<PageShell data-report-page>     ← Captured as Page 1
  <EstimateCoverPage data-report-page>   ← Captured as Page 2
    [cover content]
  </EstimateCoverPage>
</PageShell>
```

The PDF generator captures BOTH elements, resulting in the cover appearing twice.

### Problem 2: Attachments Captured While Still Loading

**Root Cause**: The loading spinner element still has `data-report-page` attribute

In `AttachmentPagesRenderer.tsx` (lines 143-157), the loading state returns a page with the spinner:

```tsx
if (loading) {
  return (
    <div data-report-page className="...">  ← This gets captured!
      <Loader2 className="animate-spin" />
      <p>Loading attachments...</p>
    </div>
  );
}
```

When the PDF export polls and finds `.animate-spin`, it keeps waiting. BUT when it finally captures, if attachments haven't finished loading, this "Loading attachments..." page is captured as a full PDF page instead of the actual attachments.

---

## Solution

### Fix 1: Skip PageShell for Cover Page

Modify `EstimatePDFDocument.tsx` to render the cover page WITHOUT wrapping it in `PageShell`:

```typescript
// Line 500-516 - render pages
return (
  <div id="estimate-pdf-pages" className="flex flex-col gap-4">
    {pages.pages.map((pageContent, idx) => {
      // Cover page already has its own data-report-page, don't wrap
      const isCoverPage = opts.showCoverPage && idx === 0;
      
      if (isCoverPage) {
        // Render cover page directly without PageShell wrapper
        return <React.Fragment key="cover">{pageContent}</React.Fragment>;
      }
      
      // Wrap other pages in PageShell
      return (
        <PageShell
          key={idx}
          {...commonProps}
          pageNumber={idx + 1}
        >
          {pageContent}
        </PageShell>
      );
    })}
    
    {/* Attachment pages */}
    {templateAttachments && templateAttachments.length > 0 && (
      <AttachmentPagesRenderer attachments={templateAttachments} />
    )}
  </div>
);
```

### Fix 2: Loading State Should NOT Have data-report-page

Modify `AttachmentPagesRenderer.tsx` - the loading spinner should NOT be captured as a PDF page:

```typescript
// Lines 143-158 - Loading state should not have data-report-page
if (loading) {
  return (
    <div
      // REMOVED: data-report-page - loading spinner should not be captured
      className="bg-white flex flex-col items-center justify-center"
      style={{
        width: `${PAGE_WIDTH}px`,
        minHeight: `${PAGE_HEIGHT}px`,
        maxHeight: `${PAGE_HEIGHT}px`,
      }}
    >
      <Loader2 className="h-12 w-12 animate-spin text-muted-foreground mb-4" />
      <p className="text-muted-foreground text-sm">Loading attachments...</p>
    </div>
  );
}
```

This ensures:
1. While loading, the spinner is visible in preview but NOT counted as a PDF page
2. The polling mechanism still detects `.animate-spin` and waits
3. Once attachments finish loading, the actual attachment pages (with `data-report-page`) appear and get captured

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/estimates/EstimatePDFDocument.tsx` | Skip PageShell wrapper for cover page (lines 500-509) |
| `src/components/estimates/AttachmentPagesRenderer.tsx` | Remove `data-report-page` from loading state (line 146) |

---

## Expected Result After Fix

1. **Cover page appears once** - no duplication
2. **Attachments are captured correctly** - actual PDF pages, not "Loading..." spinner
3. **Page count is accurate** - only real content pages are numbered

---

## Testing Steps

1. Open an estimate with attachments in Preview
2. Wait for "Loading attachments..." to finish
3. Click Export PDF
4. Verify:
   - Cover page appears exactly once
   - All attachment pages are included
   - No "Loading attachments..." page in final PDF
