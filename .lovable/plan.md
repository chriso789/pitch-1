
# Plan: Fix Document Scanner Upload Error and Improve Edge Detection

## Problems Identified

### Problem 1: Upload Failure - Missing `metadata` Column
**Error:** `"Could not find the 'metadata' column of 'documents' in the schema cache"`

The `handleBatchUpload` function in `DocumentScannerDialog.tsx` (line 349-354) attempts to insert a `metadata` JSONB object:
```typescript
metadata: {
  page_count: capturedPages.length,
  scan_timestamp: timestamp,
  generated_from: 'document_scanner',
  enhancement_mode: processingMode,
}
```

However, the `documents` table does NOT have a `metadata` column. Looking at the schema in `types.ts` (lines 9168-9194), the available columns are: `agreement_instance_id`, `contact_id`, `created_at`, `description`, `document_type`, `file_path`, `file_size`, `filename`, `id`, `mime_type`, `pipeline_entry_id`, `tenant_id`, `uploaded_by`, etc. - but NO `metadata` column.

**Solution:** Either add the `metadata` column to the database OR remove the `metadata` field from the insert and use the `description` column instead.

### Problem 2: Edge Detection Not Working Reliably
The current edge detection has issues:

1. **High downsampling (4x)** - Processing at 1/4 resolution loses fine edge details
2. **Threshold too low (15%)** - May miss faint document edges on light backgrounds  
3. **Minimum edge points too low (100)** - Doesn't require enough edges for confidence
4. **Confidence threshold too lenient (0.3)** - Returns corners even with low quality

**Solution:** Tune the edge detection parameters for better document detection on mobile cameras.

---

## Technical Implementation

### Part 1: Fix Database Insert (Critical Fix)

**File:** `src/components/documents/DocumentScannerDialog.tsx`

Remove the invalid `metadata` field and use `description` instead to store scan info:

```typescript
// Lines 338-355: Replace the insert statement

const { error: dbError } = await supabase
  .from('documents')
  .insert({
    tenant_id: profile.tenant_id,
    pipeline_entry_id: pipelineEntryId,
    document_type: documentType,
    filename: `${sanitizedLabel}.pdf`,
    file_path: fileName,
    file_size: pdfBlob.size,
    mime_type: 'application/pdf',
    uploaded_by: user.id,
    // Use description field instead of metadata (which doesn't exist)
    description: `Scanned document: ${capturedPages.length} page(s), ${processingMode} mode`,
  });
```

### Part 2: Improve Edge Detection Accuracy

**File:** `src/utils/documentEdgeDetection.ts`

#### 2.1 Reduce Downsampling for Better Edge Detection
The current 4x downsampling is too aggressive. Use 2x instead:

```typescript
// In DocumentScannerDialog.tsx, line 92:
// Change from:
const scale = 4;
// Change to:
const scale = 2;
```

#### 2.2 Increase Edge Threshold for Cleaner Detection
In `sobelEdgeDetection` function (line 108):

```typescript
// Change from:
const threshold = maxMag * 0.15; // 15% of max
// Change to:
const threshold = maxMag * 0.25; // 25% of max - filters out more noise
```

#### 2.3 Require More Edge Points for Detection
In `findDocumentQuadrilateral` function (line 134):

```typescript
// Change from:
if (edgePoints.length < 100) {
// Change to:
if (edgePoints.length < 200) { // Require more edge points
```

#### 2.4 Increase Minimum Confidence Threshold
In `findDocumentQuadrilateral` function (line 158):

```typescript
// Change from:
if (confidence < 0.3) {
// Change to:
if (confidence < 0.4) { // Require higher confidence
```

#### 2.5 Improve Coverage Scoring
In `calculateConfidence` function (lines 286-288):

```typescript
// Change from:
if (coverageRatio > 0.2 && coverageRatio < 0.95) {
  coverageScore = Math.min(1, coverageRatio / 0.5);
}
// Change to:
if (coverageRatio > 0.15 && coverageRatio < 0.85) {
  // Prefer 40-70% coverage (document fills most of frame but with margins)
  if (coverageRatio > 0.3 && coverageRatio < 0.75) {
    coverageScore = 1.0;
  } else {
    coverageScore = 0.7;
  }
}
```

### Part 3: Improve UI Detection Threshold

**File:** `src/components/documents/DocumentScannerDialog.tsx`

Update the UI to only apply perspective transform when confidence is good:

```typescript
// Line 194: Increase confidence threshold for applying transform
// Change from:
if (detectedCorners && detectedCorners.confidence > 0.5) {
// Change to:
if (detectedCorners && detectedCorners.confidence > 0.6) {
```

Update status indicator threshold (line 495-496):

```typescript
// Change from:
detectedCorners && detectedCorners.confidence > 0.6
// Change to:
detectedCorners && detectedCorners.confidence > 0.65
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/documents/DocumentScannerDialog.tsx` | Remove `metadata` from insert, use `description` instead; reduce downsampling scale from 4 to 2; increase confidence thresholds |
| `src/utils/documentEdgeDetection.ts` | Increase edge threshold, require more edge points, improve coverage scoring |

---

## Database Change Option (Alternative)

If you prefer to keep the `metadata` field, we can add the column to the database:

```sql
ALTER TABLE public.documents 
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
```

However, using the existing `description` column is simpler and doesn't require a schema change.

---

## Summary of Parameter Changes

| Parameter | Before | After | Reason |
|-----------|--------|-------|--------|
| Downsample scale | 4x | 2x | Preserve more edge detail |
| Sobel threshold | 15% | 25% | Filter out noise |
| Min edge points | 100 | 200 | Require more evidence |
| Min confidence | 0.3 | 0.4 | Higher quality detection |
| Transform threshold | 0.5 | 0.6 | Better perspective correction |
| UI indicator | 0.6 | 0.65 | Accurate feedback |

---

## Expected Results

1. **Upload will succeed** - No more "metadata column not found" error
2. **Better edge detection** - More accurate document boundary detection with clearer overlay
3. **Improved perspective correction** - Only applied when detection is confident
4. **Clearer user feedback** - Status indicator shows accurate detection state
