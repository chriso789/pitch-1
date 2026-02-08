

## Goal
Make the lead cards in the "Pipeline Entries Ready for Conversion" section clickable so users can navigate to the Lead Details page (`/lead/{id}`) to edit the lead before converting it to a job.

---

## Problem

In `src/components/PipelineToJobConverter.tsx`:
- The lead card is a plain `<div>` with no click handler
- The only action available is "Convert to Job" which goes to the review page
- Users cannot access the lead details to edit name, status, estimates, etc.

---

## Solution

Add click-to-navigate functionality to each lead card in the converter, plus an explicit "View/Edit" button.

### Changes in `PipelineToJobConverter.tsx`

**1. Make the card row clickable:**
```tsx
<div 
  key={entry.id} 
  className="flex items-center justify-between p-4 bg-background rounded-lg border 
             hover:shadow-soft transition-smooth cursor-pointer"
  onClick={() => navigate(`/lead/${entry.id}`)}
>
```

**2. Add a "View/Edit" button next to "Convert to Job":**
```tsx
<div className="flex gap-2 flex-shrink-0">
  <Button 
    size="sm" 
    variant="outline"
    onClick={(e) => {
      e.stopPropagation();
      navigate(`/lead/${entry.id}`);
    }}
  >
    <Eye className="h-4 w-4 mr-2" />
    View
  </Button>
  <Button 
    size="sm" 
    className="gradient-primary"
    onClick={(e) => {
      e.stopPropagation();
      navigate(`/pipeline-entry/${entry.id}/review`);
    }}
  >
    <ArrowRight className="h-4 w-4 mr-2" />
    Convert to Job
  </Button>
</div>
```

**3. Add `Eye` to imports:**
```typescript
import { 
  ArrowRight, 
  Briefcase, 
  DollarSign, 
  Home, 
  Calendar,
  AlertCircle,
  Loader2,
  Package,
  Hammer,
  TrendingUp,
  Eye  // ADD
} from 'lucide-react';
```

---

## User Flow After Fix

1. On Contact Profile → Pipeline tab
2. See "Pipeline Entries Ready for Conversion" card
3. **Click anywhere on the card** → navigates to Lead Details page
4. **Click "View" button** → navigates to Lead Details page (for explicit action)
5. **Click "Convert to Job" button** → goes to review/approval page (unchanged)

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/PipelineToJobConverter.tsx` | Add onClick to card, add View button, import Eye icon |

