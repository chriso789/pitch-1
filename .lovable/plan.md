

## Plan: Fix Hardcoded Company Name on Estimate Cover Page

### Problem
The `EstimateCoverPage` component has "O'Brien Contracting Estimate" hardcoded on line 112, instead of using the dynamic `companyName` prop. Every company's estimate PDF shows "O'Brien Contracting" regardless of which company profile is active.

### Fix

**File: `src/components/estimates/EstimateCoverPage.tsx`** (line 112)

Replace the hardcoded text with the dynamic company name:

```tsx
// Before
O'Brien Contracting Estimate

// After
{companyInfo?.name || companyName} Estimate
```

Single-line change. The `companyName` and `companyInfo` props are already passed from `EstimatePDFDocument.tsx` — they're just not being used for the title.

