

# Multi-Estimate Preview + Cover Page & Layout Updates

## Summary
Four changes: (1) add multi-estimate selector inside the preview panel, (2) make cover page logo 100% larger, (3) add estimate name in bold at top of estimate content pages, (4) change cover page title to "O'Brien Contracting Estimate".

## Changes

### 1. Cover Page — Logo 100% Larger
**`src/components/estimates/EstimateCoverPage.tsx`**
- Change logo `className` from `h-20` to `h-40` (line 95)

### 2. Cover Page — Title Change
**`src/components/estimates/EstimateCoverPage.tsx`**
- Change line 112 from `{estimateName || 'ROOFING ESTIMATE'}` to `"O'Brien Contracting Estimate"` (hardcoded per user preference)

### 3. Estimate Name at Top of Content Pages
**`src/components/estimates/EstimatePDFDocument.tsx`**
- In `FirstPage` component (~line 690), add a bold estimate name banner before the "Prepared For" section:
  ```
  {estimateName && (
    <div className="text-center mb-2">
      <h2 className="text-xl font-bold text-gray-900">{estimateName}</h2>
    </div>
  )}
  ```
- Thread `estimateName` prop through `FirstPage` component (add to interface and usage at line 542-557)

### 4. Multi-Estimate Selector Inside Preview Panel
**`src/components/estimates/EstimatePreviewPanel.tsx`**
- Add new props: `pipelineEntryId` (already exists), plus a new `allEstimates` array prop with `{id, display_name, estimate_number}[]`
- Add state for `selectedEstimateIds: string[]` (defaults to current estimate)
- In the left sidebar, add a collapsible "Estimates to Include" section with checkboxes for each saved estimate
- When multiple estimates are selected, fetch their data from `enhanced_estimates` + `estimate_line_items` and render multiple `EstimatePDFDocument` components sequentially in the preview area (each with its own cover page)

**`src/components/estimates/MultiTemplateSelector.tsx`**
- Fetch the saved estimates list and pass it to `EstimatePreviewPanel` as `allEstimates`

**New: Data fetching for additional estimates**
- When a user checks an additional estimate, query `enhanced_estimates` by ID to get pricing breakdown, then query `estimate_line_items` to get materials/labor
- Render each selected estimate as a separate `EstimatePDFDocument` block in the preview scroll area

### Technical Details

**Multi-estimate preview architecture:**
- The preview panel already receives all data for the "current" estimate via props
- For additional selected estimates, fetch their data on-demand from Supabase (`enhanced_estimates` + `estimate_line_items`)
- Store fetched estimate data in a `Map<string, EstimateData>` state
- Render: iterate over `selectedEstimateIds`, for the current estimate use props, for others use fetched data
- Each estimate renders its own full `EstimatePDFDocument` (cover page + scope pages + terms)
- PDF export: the existing `data-report-page` selector captures all pages across all estimates

