
# Save Imported Measurement Reports & Insurance Scopes to Job Documents

## Problem Summary

When a user imports a measurement report from Roofr, EagleView, Xactimate, etc., or uploads an insurance scope, the system extracts the data but **doesn't save the original PDF to the job's Documents tab**. This means users can't access the original source document later.

---

## What Needs to Change

### 1. Measurement Report Imports → Save to "Other" folder

**File:** `supabase/functions/roof-report-ingest/index.ts`

After successfully parsing and storing the report (around line 1314), add logic to:
1. Get the tenant_id from the linked lead/job
2. Upload the original PDF to Storage: `{tenant_id}/{pipeline_entry_id}/measurements/{timestamp}_{filename}.pdf`
3. Create a `documents` table entry with:
   - `document_type: 'other'` (or create new type `measurement_report`)
   - `description: '{Provider} Measurement Report - {sqft} sqft'`
   - `pipeline_entry_id`: Link to the job

**Providers to detect:**
- `roofr` → "Roofr Report"
- `eagleview` → "EagleView Report"
- `hover` → "Hover Report"
- `roofscope` → "RoofScope Report"
- `xactimate` → "Xactimate Scope" (save as `insurance` type instead)
- `generic` → "Measurement Report"

### 2. Insurance Scope Uploads → Also save to "Insurance" folder

**File:** `supabase/functions/scope-document-ingest/index.ts`

After creating the `insurance_scope_documents` record (around line 259), also create a `documents` table entry:
- `document_type: 'insurance'`
- `description: 'Insurance Scope - {carrier_name}'`
- `pipeline_entry_id: job_id` (if provided)

### 3. ScopeUploader Component → Pass job linkage

**File:** `src/components/insurance/ScopeUploader.tsx`

Ensure the `jobId` prop is properly passed to the edge function so documents are linked to the correct job.

---

## Technical Implementation

### Edge Function Changes

#### `roof-report-ingest/index.ts` (after line ~1313)

```typescript
// After: const { error: measErr } = await supabase.from("roof_measurements_truth").insert(m);

// ======= NEW: Save PDF to job documents =======
if (lead_id) {
  try {
    // Get tenant_id from lead
    const { data: leadData } = await supabase
      .from('pipeline_entries')
      .select('tenant_id')
      .eq('id', lead_id)
      .single();

    if (leadData?.tenant_id) {
      const isInsurance = parsed.provider === 'xactimate';
      const docType = isInsurance ? 'insurance' : 'other';
      const timestamp = Date.now();
      const providerLabel = {
        roofr: 'Roofr',
        eagleview: 'EagleView',
        hover: 'Hover',
        roofscope: 'RoofScope',
        xactimate: 'Xactimate',
        generic: 'Measurement'
      }[parsed.provider || 'generic'] || 'Measurement';
      
      // Store PDF in job's folder
      const docPath = `${leadData.tenant_id}/${lead_id}/measurements/${timestamp}_${fileName || 'report'}.pdf`;
      
      const { error: uploadErr } = await supabase.storage
        .from('documents')
        .upload(docPath, pdfBytes, {
          contentType: 'application/pdf',
          upsert: true
        });

      if (!uploadErr) {
        // Create document record
        await supabase.from('documents').insert({
          tenant_id: leadData.tenant_id,
          pipeline_entry_id: lead_id,
          document_type: docType,
          filename: `${providerLabel}_Report_${parsed.total_area_sqft || 0}sqft.pdf`,
          file_path: docPath,
          file_size: pdfBytes.length,
          mime_type: 'application/pdf',
          description: `${providerLabel} Report - ${parsed.total_area_sqft?.toLocaleString() || 0} sqft`,
        });
        console.log("roof-report-ingest: Saved document to job:", docPath);
      }
    }
  } catch (docErr) {
    console.warn("roof-report-ingest: Failed to save document:", docErr);
    // Non-fatal - measurement data still saved
  }
}
```

#### `scope-document-ingest/index.ts` (after line ~259)

```typescript
// After: console.log("[scope-ingest] Document created:", document.id);

// ======= NEW: Also save to job documents for easy access =======
if (body.job_id) {
  try {
    await supabase.from('documents').insert({
      tenant_id: tenantId,
      pipeline_entry_id: body.job_id,
      document_type: 'insurance',
      filename: fileName,
      file_path: storagePath,
      file_size: pdfBytes.length,
      mime_type: 'application/pdf',
      description: `Insurance ${body.document_type} - ${body.file_name}`,
    });
    console.log("[scope-ingest] Saved insurance document to job documents");
  } catch (docErr) {
    console.warn("[scope-ingest] Failed to save to job documents:", docErr);
    // Non-fatal - scope document still created
  }
}
```

---

## Document Type Mapping

| Provider/Source | Document Type | Folder Location |
|-----------------|---------------|-----------------|
| Roofr | `other` or `measurement_report` | Documents > Other |
| EagleView | `other` or `measurement_report` | Documents > Other |
| Hover | `other` or `measurement_report` | Documents > Other |
| RoofScope | `other` or `measurement_report` | Documents > Other |
| Xactimate | `insurance` | Documents > Insurance |
| Insurance Scopes | `insurance` | Documents > Insurance |

---

## Storage Path Convention

Following RLS requirements (tenant_id must be first folder):

```
{tenant_id}/{pipeline_entry_id}/measurements/{timestamp}_{filename}.pdf
{tenant_id}/{pipeline_entry_id}/insurance/{timestamp}_{filename}.pdf
```

Or using existing paths in scope-ingest:
```
{tenant_id}/insurance-scopes/{hash}.pdf
```

---

## Files to Modify

| File | Action |
|------|--------|
| `supabase/functions/roof-report-ingest/index.ts` | Add document storage after measurement save |
| `supabase/functions/scope-document-ingest/index.ts` | Add job document link after scope creation |

---

## Testing Plan

1. Import a Roofr PDF for a job → Verify it appears in Documents > Other
2. Import an EagleView PDF → Verify it appears in Documents > Other
3. Import an Xactimate scope → Verify it appears in Documents > Insurance
4. Upload insurance scope via ScopeUploader with jobId → Verify linkage
5. Check that existing measurement import flow still works
6. Verify documents can be downloaded and previewed from job Documents tab
