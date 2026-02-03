
# Fix Scope Documents Not Appearing in Network Tab

## Problem Summary

Uploaded scope documents are not appearing in the Network Intelligence tab because:

1. **Documents are stuck at `extracting` status** - The edge function creates a document record but the AI parsing step never completes
2. **Network view only shows `complete` documents** - The `scope_network_intelligence` view filters: `WHERE parse_status = 'complete'`

Database check shows: 2 documents at `extracting`, only 1 at `complete`.

---

## Root Causes

### Issue 1: AI Extraction Not Working Properly

In `scope-document-ingest/index.ts` (lines 299-315), the AI extraction call is problematic:

```typescript
const aiResponse = await generateAIResponse({
  system: extractionPrompt,
  user: `Analyze this insurance scope document...
         Note: Since I cannot see the actual PDF content directly, please provide a template response...`
  // ^^^ This is essentially asking for a placeholder response!
});
```

The AI is being asked to parse a PDF but:
- It's not receiving the actual PDF content (no base64 or document parsing)
- The prompt explicitly says "I cannot see the actual PDF content" 
- Edge function may be timing out or failing during the AI call without proper error handling

### Issue 2: Edge Function Storage Path Still Wrong

Line 188 in `scope-document-ingest/index.ts`:
```typescript
storagePath = `insurance-scopes/${tenantId}/${fileHash}.pdf`;
```

This doesn't match the RLS-compliant path format fixed earlier (`${tenantId}/insurance-scopes/...`).

---

## Solution

### Fix 1: Improve Edge Function Error Handling and Timeout

Add better error handling around the AI call to:
- Set document to `failed` status if AI call times out
- Log the actual error for debugging
- Use a more robust PDF extraction approach

**File:** `supabase/functions/scope-document-ingest/index.ts`

```typescript
// Line 289-315: Wrap AI call with proper error handling and timeout
try {
  // Add a timeout wrapper
  const aiResponsePromise = generateAIResponse({...});
  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('AI extraction timeout after 60s')), 60000)
  );
  
  const aiResponse = await Promise.race([aiResponsePromise, timeoutPromise]);
  // ... rest of parsing
} catch (parseError) {
  // Update document with failed status and error message
  await supabase.from("insurance_scope_documents").update({
    parse_status: 'failed',
    parse_error: parseError.message
  }).eq("id", document.id);
  throw parseError;
}
```

### Fix 2: Correct Storage Path in Edge Function

**File:** `supabase/functions/scope-document-ingest/index.ts`

```typescript
// Line 188: Fix path format to comply with RLS
// FROM:
storagePath = `insurance-scopes/${tenantId}/${fileHash}.pdf`;

// TO:
storagePath = `${tenantId}/insurance-scopes/${fileHash}.pdf`;
```

### Fix 3: Add "Reprocess" Button for Stuck Documents

Add ability for users to retry stuck documents. This already exists in `ScopeDocumentBrowser.tsx` but may need to be more prominent.

---

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/scope-document-ingest/index.ts` | Fix storage path format (line 188) |
| `supabase/functions/scope-document-ingest/index.ts` | Add timeout and better error handling around AI call |

---

## Database Cleanup Required

After deployment, the stuck documents need to be either:
1. Manually reset to `pending` status for re-processing, OR
2. Marked as `failed` with an error message

```sql
-- Mark stuck documents as failed so users know to retry
UPDATE insurance_scope_documents 
SET parse_status = 'failed', 
    parse_error = 'Processing timeout - please reprocess'
WHERE parse_status = 'extracting' 
  AND parse_started_at < NOW() - INTERVAL '5 minutes';
```

---

## Expected Result

After these fixes:
1. New uploads will have proper error handling - failures will show in the UI
2. Storage paths will be RLS-compliant
3. Users can see which documents failed and retry them
4. Successfully parsed documents will appear in the Network Intelligence view
