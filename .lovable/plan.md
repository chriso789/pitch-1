
Fix the remaining added-estimate formatting bug by correcting the page-wrapping logic in `EstimatePDFDocument.tsx`.

Problem found:
- The remaining issue is not the global font CSS anymore.
- In `EstimatePDFDocument.tsx`, the render loop does this:
  - `const isCoverPage = opts.showCoverPage && idx === 0`
- For added estimates, `skipCoverPage={true}` is passed from `EstimatePreviewPanel.tsx`.
- That means the first real content page of every added estimate is still being treated like a cover page whenever the cover-page option is enabled globally.
- Result: that first added-estimate page bypasses `PageShell`, so it loses the normal page width, margins, header/footer wrapper, font enforcement, and `data-report-page` marker.

Why previous fixes didn’t solve it:
- They targeted inherited font styles and table padding.
- But this remaining mismatch is caused by the first added-estimate page not being wrapped at all.

Implementation plan:
1. Update `src/components/estimates/EstimatePDFDocument.tsx`
   - Change cover-page detection so only an actually-rendered cover page is skipped from `PageShell`.
   - Use logic like:
     - `const hasRenderedCoverPage = opts.showCoverPage && !skipCoverPage`
     - `const isCoverPage = hasRenderedCoverPage && idx === 0`
2. Keep all non-cover pages wrapped in `PageShell`
   - This ensures the first page of each added estimate gets the same:
     - 816px page width
     - `px-6` margins
     - `pdf-render-container` font styling
     - header/footer layout
     - `data-report-page` marker
3. Verify page indexing behavior
   - Confirm added estimates now render their first page as a normal page, not raw `FirstPage` content.
   - Confirm page-count/export logic works correctly since `[data-report-page]` will now exist on that page too.
4. Regression check
   - Make sure the true cover page of the main estimate still renders without a duplicate wrapper.
   - Make sure continuation pages and attachments are unaffected.

Technical details:
- Root cause location: `src/components/estimates/EstimatePDFDocument.tsx`, inside the final `pages.pages.map(...)` render block.
- Current bug:
```text
opts.showCoverPage && idx === 0
```
- Correct behavior:
```text
only treat idx 0 as a cover page when this document actually rendered a cover page
```

Files to update:
- `src/components/estimates/EstimatePDFDocument.tsx`

Expected outcome:
- The first page of each added estimate will use the same font, margins, and page shell as the estimate shown in the main Preview Estimate window.
- Exported PDFs should also become more reliable because that page will regain its proper page marker and shell.
