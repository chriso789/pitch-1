

# Fix Photo Upload Failures (No Limit on Photos Per Client)

## Root Cause

There is **no intentional 3-photo limit** in the code. The real problem is the `usePhotos` hook sends entire photos as **base64-encoded strings** inside the JSON body to the `photo-upload` edge function. iPhone gallery photos (5-10MB each) become ~13MB of base64 text, which crashes the Deno edge function with memory limit exceeded errors. After ~3 photos, the function's memory is exhausted and all subsequent uploads fail silently.

Edge function logs confirm: only "shutdown" entries — the function is killed before it can even log an error.

A secondary issue: the `customer_photos` RLS policy only checks `profiles.tenant_id`, not `active_tenant_id`. Master users operating as Tristate through context switching would also fail on direct DB inserts.

## Plan

### 1. Create client-side image compression utility
**New file**: `src/lib/imageCompression.ts`

- Canvas-based resize to max 2000px on longest side
- Output as JPEG at 0.85 quality (converts HEIC and all other formats)
- Reduces typical iPhone photos from 5-10MB to ~200-500KB
- Graceful fallback to original file if canvas fails

### 2. Rewrite `usePhotos.uploadPhoto` to use direct storage upload
**File**: `src/hooks/usePhotos.ts`

Instead of base64-encoding and calling the edge function:
1. Compress the image client-side
2. Upload directly to `customer-photos` storage bucket via `supabase.storage.upload()`
3. Insert record directly to `customer_photos` table via `supabase.from().insert()`

This matches the already-working pattern in `LeadPhotoUploader` and completely avoids the edge function memory issue. Keep the edge function for non-file actions (update, delete, reorder, set_primary, toggle_estimate).

### 3. Add compression to `LeadPhotoUploader`
**File**: `src/components/photos/LeadPhotoUploader.tsx`

- Add compression step before `supabase.storage.upload()` to benefit from smaller files
- Update `accept` attributes to include `.heic,.heif`

### 4. Fix `customer_photos` RLS policy
**Migration SQL**:

```sql
DROP POLICY "Tenant isolation for customer_photos" ON customer_photos;
CREATE POLICY "Tenant isolation for customer_photos" ON customer_photos
  FOR ALL TO authenticated
  USING (
    tenant_id IN (
      SELECT profiles.tenant_id FROM profiles WHERE profiles.id = auth.uid()
      UNION
      SELECT profiles.active_tenant_id FROM profiles WHERE profiles.id = auth.uid() AND profiles.active_tenant_id IS NOT NULL
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT profiles.tenant_id FROM profiles WHERE profiles.id = auth.uid()
      UNION
      SELECT profiles.active_tenant_id FROM profiles WHERE profiles.id = auth.uid() AND profiles.active_tenant_id IS NOT NULL
    )
  );
```

### Files Changed

| File | Change |
|------|--------|
| `src/lib/imageCompression.ts` | New — canvas resize + JPEG conversion |
| `src/hooks/usePhotos.ts` | `uploadPhoto` → direct storage + DB insert (no edge function) |
| `src/components/photos/LeadPhotoUploader.tsx` | Add compression + HEIC accept |
| Migration SQL | Fix `customer_photos` RLS for `active_tenant_id` |

### Expected Outcome
- Unlimited photos per client (no artificial or memory-based cap)
- iPhone gallery photos (including HEIC/Live) compressed and converted client-side
- No more edge function memory crashes
- Master users can upload photos when operating as any company

