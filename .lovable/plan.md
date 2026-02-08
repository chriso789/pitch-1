
## Goal
Change the "Share" button (external link icon) on each saved estimate card to **open the Preview Estimate modal** instead of just viewing the PDF, so users can access the full sharing workflow with email and "Quote Opened" SMS notifications.

## Current Behavior
In `src/components/estimates/SavedEstimatesList.tsx`, the ExternalLink button:
- Only appears if an estimate has a `pdf_url`
- Clicking it opens the PDF directly in a new tab via `handleViewPDF()`
- **No access to the email sharing or tracking system**

## Proposed Solution
Replace the "View PDF" button with a "Share Estimate" button that triggers a callback to open the Preview Estimate modal with the selected estimate pre-loaded.

### Changes

#### 1. Update `SavedEstimatesList.tsx`

**Add new prop:**
```typescript
interface SavedEstimatesListProps {
  // ... existing props
  onShareEstimate?: (estimateId: string) => void;  // NEW
}
```

**Replace the ExternalLink button logic:**
- Change from: Only show if `pdf_url` exists, opens PDF directly
- Change to: Always show for all estimates, calls `onShareEstimate(estimate.id)` to open Preview panel

**Update button:**
```tsx
<Button
  variant="ghost"
  size="sm"
  onClick={(e) => {
    e.stopPropagation();
    onShareEstimate?.(estimate.id);
  }}
  className="h-8 px-2"
  title="Share Estimate"
>
  <ExternalLink className="h-4 w-4" />
</Button>
```

#### 2. Update `LeadDetails.tsx`

**Pass the `onShareEstimate` callback to `SavedEstimatesList`:**
```tsx
<SavedEstimatesList 
  pipelineEntryId={id!}
  onShareEstimate={(estimateId) => {
    // Navigate to the estimate in edit mode and trigger preview panel
    navigate(`/lead/${id}?tab=estimate&editEstimate=${estimateId}&showPreview=true`);
  }}
  // ... existing props
/>
```

#### 3. Update `MultiTemplateSelector.tsx`

**Read URL param and auto-open Preview panel:**
- On mount, check for `showPreview=true` in URL
- If present (and estimate is loaded), automatically call `setShowPreviewPanel(true)`
- Clear the URL param after opening

### User Flow After Fix
1. User sees list of saved estimates
2. Clicks the "Share" (ExternalLink) button on any estimate
3. System navigates to that estimate in edit mode AND opens the Preview Estimate modal
4. User can then click "Share" button in the Preview panel to email the quote with tracking

### Files to Modify
| File | Change |
|------|--------|
| `src/components/estimates/SavedEstimatesList.tsx` | Add `onShareEstimate` prop, update ExternalLink button to use it |
| `src/pages/LeadDetails.tsx` | Pass `onShareEstimate` handler to navigate with `showPreview=true` |
| `src/components/estimates/MultiTemplateSelector.tsx` | Read `showPreview` URL param and auto-open preview panel |

### Benefits
- One-click access to the full sharing workflow from the saved estimates list
- Users can email quotes with tracking without manually finding the Preview button
- "Quote Opened" SMS notifications work because users go through the proper share flow
