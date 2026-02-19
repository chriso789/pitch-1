

# Fix: Job Photos Toggle + Photo Visibility in Estimate Preview

## Problem 1: Job Photos toggle does nothing
The "Job Photos" toggle in the Estimate Preview panel correctly sets `options.showJobPhotos = true`, but the `EstimatePDFDocument` component is rendered **without any `jobPhotos` data**. Line 855 of `EstimatePreviewPanel.tsx` passes all other props but omits `jobPhotos`.

The PDF template checks `opts.showJobPhotos && jobPhotos && jobPhotos.length > 0` -- since `jobPhotos` is undefined, the page never renders regardless of the toggle.

## Problem 2: Where are uploaded photos?
Good news -- the photos uploaded from mobile are saved correctly:
- **Storage:** `customer-photos` bucket, path: `{tenant_id}/leads/{lead_id}/...`
- **Database:** `customer_photos` table with `lead_id` matching this lead
- 2 drone photos visible with `include_in_estimate: false`

The upload fix from earlier (changing `file_path` to `file_name`) is working.

## Fix

### `src/components/estimates/EstimatePreviewPanel.tsx`

**1. Add state and fetch logic for job photos**

Import `useEffect` and add a state variable + fetch function that loads photos from `customer_photos` where `lead_id = pipelineEntryId`:

```typescript
const [jobPhotos, setJobPhotos] = useState<Array<{
  id: string;
  file_url: string;
  description?: string | null;
  category?: string | null;
}>>([]);

useEffect(() => {
  if (!pipelineEntryId || !open) return;

  const fetchPhotos = async () => {
    const { data } = await supabase
      .from('customer_photos')
      .select('id, file_url, description, category')
      .eq('lead_id', pipelineEntryId)
      .order('display_order');
    if (data) setJobPhotos(data);
  };
  fetchPhotos();
}, [pipelineEntryId, open]);
```

**2. Pass `jobPhotos` to `EstimatePDFDocument`**

Add the missing prop on line ~874:

```tsx
<EstimatePDFDocument
  ...existing props...
  jobPhotos={jobPhotos}
/>
```

**3. Update the toggle row to show photo count**

Update the "Job Photos" toggle row to display a count badge so users know how many photos are available:

```tsx
<ToggleRow
  label="Job Photos"
  checked={options.showJobPhotos}
  onChange={(v) => updateOption('showJobPhotos', v)}
  badge={jobPhotos.length > 0 ? `${jobPhotos.length}` : undefined}
  disabled={jobPhotos.length === 0}
/>
```

## Result
- Toggling "Job Photos" ON will render a photos page in the estimate preview showing photos from the lead
- The toggle shows a count badge (e.g., "2") so users know photos exist
- If no photos are uploaded, the toggle is disabled with a visual indicator
- Photos uploaded from mobile are now connected to the estimate export flow
