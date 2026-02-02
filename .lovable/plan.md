
# Fix: Scope Intelligence Not Showing Data

## Problem Summary

The Scope Intelligence page shows 0 documents because insurance scopes are being uploaded to the wrong table:

| Current State | What Scope Intelligence Expects |
|--------------|--------------------------------|
| Documents uploaded to `documents` table with `document_type = 'insurance'` | Documents processed into `insurance_scope_documents` table via `scope-document-ingest` edge function |
| Tristate has 2 insurance documents in `documents` | `insurance_scope_documents` table is EMPTY |
| O'Brien has 0 insurance documents uploaded | No scopes to process |

**Root Cause:** Two disconnected upload flows exist - the generic document upload and the specialized Scope Intelligence ingestion pipeline. Documents uploaded through Insurance Claims Manager never get processed into the Scope Intelligence system.

---

## Solution: Bridge Existing Documents + Unify Future Uploads

### Part 1: Backfill Existing Documents

Create an edge function to process existing insurance documents from the `documents` table into `insurance_scope_documents`.

**New Edge Function:** `scope-backfill-documents`

```text
supabase/functions/scope-backfill-documents/index.ts
```

**Logic:**
1. Query `documents` table for records with `document_type = 'insurance'`
2. For each document, call the `scope-document-ingest` function (or replicate its logic)
3. Mark processed documents to avoid re-processing
4. Return summary of processed documents

---

### Part 2: Auto-Ingest Future Uploads

Modify the document upload flow to automatically trigger scope ingestion when `document_type = 'insurance'`.

**Option A: Database Trigger (Preferred)**

Create a Postgres trigger that fires when a document with `document_type = 'insurance'` is inserted, calling an edge function via `pg_net`:

```sql
CREATE OR REPLACE FUNCTION trigger_scope_ingestion()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.document_type = 'insurance' THEN
    PERFORM net.http_post(
      url := 'https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/scope-document-ingest',
      body := json_build_object(
        'storage_path', NEW.file_path,
        'document_type', 'estimate',
        'file_name', NEW.filename
      )::text
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auto_ingest_insurance_docs
AFTER INSERT ON documents
FOR EACH ROW EXECUTE FUNCTION trigger_scope_ingestion();
```

**Option B: Frontend Hook**

Update the document upload component to call `scope-document-ingest` after uploading insurance documents.

---

### Part 3: Admin Backfill Button

Add a temporary admin UI button in Scope Intelligence to trigger the backfill for existing documents:

**Location:** `src/components/insurance/ScopeIntelligenceDashboard.tsx`

```tsx
// Add a "Process Existing Documents" button for admins
{isAdmin && unprocessedCount > 0 && (
  <Button onClick={handleBackfill}>
    Process {unprocessedCount} Existing Insurance Documents
  </Button>
)}
```

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `supabase/functions/scope-backfill-documents/index.ts` | CREATE | Edge function to backfill existing insurance docs |
| `supabase/migrations/xxx_auto_ingest_trigger.sql` | CREATE | Trigger to auto-process new insurance uploads |
| `src/components/insurance/ScopeIntelligenceDashboard.tsx` | MODIFY | Add backfill button for admins |
| `supabase/config.toml` | MODIFY | Register new edge function |

---

## Implementation Flow

```text
[Existing Documents]          [New Uploads]
        │                           │
        ▼                           ▼
┌─────────────────┐     ┌─────────────────────┐
│ scope-backfill- │     │ documents table     │
│ documents       │     │ INSERT              │
│ (manual trigger)│     └─────────┬───────────┘
└────────┬────────┘               │
         │                        ▼
         │              ┌─────────────────────┐
         │              │ Postgres Trigger    │
         │              │ (document_type =    │
         │              │  'insurance')       │
         │              └─────────┬───────────┘
         │                        │
         ▼                        ▼
┌─────────────────────────────────────────────┐
│         scope-document-ingest               │
│  - Downloads PDF from storage               │
│  - AI extracts line items                   │
│  - Creates insurance_scope_documents record │
│  - Creates header + line items              │
└─────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────┐
│      insurance_scope_documents              │
│      insurance_scope_headers                │
│      insurance_scope_line_items             │
└─────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────┐
│      Scope Intelligence Dashboard           │
│      (Now shows data!)                      │
└─────────────────────────────────────────────┘
```

---

## Edge Function: scope-backfill-documents

```typescript
// Key logic
async function backfillDocuments(tenantId?: string) {
  const supabase = supabaseService();
  
  // Find unprocessed insurance documents
  let query = supabase
    .from('documents')
    .select('id, file_path, filename, tenant_id')
    .eq('document_type', 'insurance');
  
  if (tenantId) {
    query = query.eq('tenant_id', tenantId);
  }
  
  const { data: documents } = await query;
  
  const results = [];
  for (const doc of documents || []) {
    // Check if already processed
    const { data: existing } = await supabase
      .from('insurance_scope_documents')
      .select('id')
      .eq('storage_path', doc.file_path)
      .single();
    
    if (existing) continue; // Skip already processed
    
    // Process via scope-document-ingest logic
    // ... (call ingestion pipeline)
    
    results.push({ id: doc.id, status: 'processed' });
  }
  
  return results;
}
```

---

## Database: Link Source Document

Add a column to track the source document:

```sql
ALTER TABLE insurance_scope_documents
ADD COLUMN IF NOT EXISTS source_document_id UUID REFERENCES documents(id);
```

This creates a link between the generic `documents` record and the processed `insurance_scope_documents` record.

---

## Security Notes

- Backfill function uses service role to access cross-tenant documents when called by admin
- Regular users can only backfill their own tenant's documents
- The auto-trigger respects existing RLS on the `documents` table

---

## Expected Results After Implementation

**Tristate Contracting:**
- 2 existing insurance documents will be processed
- Scope Intelligence will show 2 documents

**O'Brien Contracting:**
- Currently has 0 insurance documents
- Will need to upload insurance scopes to see data

**Network Intelligence:**
- Will show aggregated data from all processed scopes across tenants
- Anonymized (tenant hashed, PII redacted)
