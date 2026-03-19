

# Fix: Photos Not Displaying in Estimate Preview

## Problem
The photos from the `documents` table are found but render as broken images. The code uses `getPublicUrl()` to generate URLs, but the `documents` storage bucket is **not public** — it requires signed URLs. Every other place in the codebase that accesses files from this bucket uses `createSignedUrl()`.

## Fix

### `src/components/estimates/EstimatePreviewPanel.tsx`

Replace the synchronous `getPublicUrl` call with an async `createSignedUrl` call when mapping document photos:

1. Make the document photo mapping async — use `Promise.all` to generate signed URLs for each photo
2. Use `createSignedUrl(file_path, 3600)` (1-hour expiry) instead of `getPublicUrl`
3. Filter out any photos where signed URL generation failed

### Technical Detail

Current (broken):
```typescript
const bucket = resolveStorageBucket(d.document_type, d.file_path);
const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(d.file_path!);
return { id: d.id, file_url: urlData.publicUrl, ... };
```

Fixed:
```typescript
const bucket = resolveStorageBucket(d.document_type, d.file_path);
const { data: urlData } = await supabase.storage.from(bucket).createSignedUrl(d.file_path!, 3600);
return { id: d.id, file_url: urlData?.signedUrl || '', ... };
```

The mapping needs to become async (`Promise.all`) since `createSignedUrl` is asynchronous, unlike `getPublicUrl`.

| File | Change |
|------|--------|
| `src/components/estimates/EstimatePreviewPanel.tsx` | Switch from `getPublicUrl` to `createSignedUrl` for document-table photos |

