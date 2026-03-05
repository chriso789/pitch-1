

# Add Missing "Estimate Sent" Status to Add New Lead Dialog

## Problem
The `EnhancedLeadCreationDialog` is missing the "Estimate Sent" status option. The older `LeadCreationDialog` includes it, but the enhanced version was built without it.

## Fix

**File: `src/components/EnhancedLeadCreationDialog.tsx`** (line 149)

Add `estimate_sent` between "Lead" and "Legal Review" in the `pipelineStatuses` array:

```typescript
const pipelineStatuses = [
  { value: "lead", label: "Lead" },
  { value: "estimate_sent", label: "Estimate Sent" },  // <-- add this
  { value: "legal_review", label: "Legal Review" },
  { value: "contingency_signed", label: "Contingency Signed" },
  // ... rest unchanged
];
```

Single line addition, matching the pipeline workflow architecture order.

