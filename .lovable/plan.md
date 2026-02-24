

# Fix: Measurement Report Save Failures for Chris Riegler

## Root Cause Analysis

Two errors occur when Chris clicks "Confirm & Save" on a measurement report for property `ca2f595e`:

### Error 1: PDF Too Large (413)
The generated multi-page measurement report PDF (with embedded satellite imagery, diagrams, photos) exceeds the storage bucket's file size limit. The `documents` bucket has no explicit `file_size_limit`, inheriting a default that is being exceeded.

**Crash log evidence:**
```
POST .../documents/14de934e.../measurement-report-1771965161665.pdf - 400
{"statusCode":"413","error":"Payload too large","message":"The object exceeded the maximum allowed size"}
```

### Error 2: Missing RLS Policy (403)
A second upload to the `measurement-reports` bucket fails because no INSERT policy exists for that bucket.

**Crash log evidence:**
```
POST .../measurement-reports/reports/9cb8216b.../roof-report-*.pdf - 400
{"statusCode":"403","error":"Unauthorized","message":"new row violates row-level security policy"}
```

## Fixes

### Fix 1: Increase `documents` bucket file size limit

Run a SQL migration to set a generous file size limit (e.g., 100MB) on the `documents` bucket:

```sql
UPDATE storage.buckets 
SET file_size_limit = 104857600  -- 100MB
WHERE id = 'documents';
```

### Fix 2: Add INSERT RLS policy for `measurement-reports` bucket

```sql
CREATE POLICY "Authenticated users can upload measurement reports"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'measurement-reports' 
  AND auth.role() = 'authenticated'
);
```

Also add SELECT policy so they can read back the reports:

```sql
CREATE POLICY "Authenticated users can read measurement reports"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'measurement-reports' 
  AND auth.role() = 'authenticated'
);
```

### Fix 3: Optimize PDF size in `RoofrStyleReportPreview.tsx`

To prevent this from recurring, compress images before embedding them in the PDF:
- Reduce satellite/overlay image quality to 0.7 (from default 1.0) when calling `html2canvas`
- Cap image dimensions to 1200px max width before embedding
- This should reduce typical report PDFs from 50MB+ down to 10-20MB

### Fix 4: Add user-friendly error handling

In `RoofrStyleReportPreview.tsx`, catch the 413 error specifically and show a helpful toast message instead of a generic failure.

## Files to Modify

| File | Action |
|------|--------|
| SQL Migration | Set `file_size_limit` on `documents` bucket, add RLS policies for `measurement-reports` |
| `src/components/measurements/RoofrStyleReportPreview.tsx` | Reduce image quality in PDF generation, add 413 error handling |

## Technical Details

### Image Compression in PDF Generation

The `generateMultiPagePDF` function uses `html2canvas` which captures at full resolution. By passing `scale: 1.5` instead of `2` and `quality: 0.7` for JPEG encoding, the PDF size drops significantly without visible quality loss on screen or print.

### Why This Only Affects Some Properties

Properties with more complex roofs generate more facet diagrams, more satellite zoom levels, and more measurement detail pages. Simpler roofs produce smaller PDFs that stay under the limit.

