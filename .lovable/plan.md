

# Fix: "Failed to create estimate" with Blank Template

## Root Cause
The `template_id` column in `enhanced_estimates` is type **UUID**. When using the Blank Template, the code inserts `'__blank__'` as the `template_id` value — which is not a valid UUID, causing a Postgres type error.

## Fix

**File: `src/components/estimates/MultiTemplateSelector.tsx`** (~line 1576)

Change the insert to set `template_id` to `null` when the selected template is the blank template:

```typescript
template_id: selectedTemplateId === '__blank__' ? null : selectedTemplateId,
```

This is a one-line fix. The column is nullable (`is_nullable: YES`), so `null` is safe.

