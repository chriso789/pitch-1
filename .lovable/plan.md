
# Rename "Jobs" Tab to "Pipeline Leads" on Contact Profile

## Problem Summary

The Contact Profile page currently shows a "Jobs" tab that displays pipeline entries (leads), which is confusing because:
- **Leads** belong in the **Pipeline** (sales workflow)
- **Jobs** are for **Production** (work execution after approval)
- The current label "Jobs & Leads" conflates two different workflow stages

The user clarified the correct workflow:
- Contacts stay in Contacts
- Once a lead is created → it goes into the Pipeline
- Jobs = Production items (post-approval work)

## Solution

Rename the "Jobs" tab and related terminology to "Pipeline Leads" or just "Leads" to accurately reflect what's being displayed.

---

## Changes Required

### 1. ContactProfile.tsx (Tab Label)

**File:** `src/pages/ContactProfile.tsx`

**Lines 305-307:**
```typescript
// Current:
<TabsTrigger value="jobs" className="flex items-center gap-2">
  <Briefcase className="h-4 w-4" />
  Jobs ({jobs.length + pipelineEntries.length})
</TabsTrigger>

// Change to:
<TabsTrigger value="jobs" className="flex items-center gap-2">
  <Activity className="h-4 w-4" />  
  Pipeline ({pipelineEntries.length})
</TabsTrigger>
```

Note: Keep `value="jobs"` to avoid breaking existing navigation, just change the display label.

### 2. ContactJobsTab.tsx (Card Headers & Labels)

**File:** `src/components/contact-profile/ContactJobsTab.tsx`

| Line | Current | Change To |
|------|---------|-----------|
| 366 | `Total Jobs` | `Total Leads` |
| 378 | `Active Jobs` | `Active Leads` |
| 390 | `Completed` | `Won/Closed` |
| 403 | `Jobs & Leads ({totalJobs})` | `Pipeline Leads ({totalJobs})` |
| 653 | `No jobs or leads yet` | `No pipeline leads yet` |
| 655 | `Create the first lead for this contact...` | Keep as-is |

### 3. Update Statistics Calculation

**File:** `src/components/contact-profile/ContactJobsTab.tsx`

Since the focus is now on pipeline entries (not jobs table):
- `totalJobs` → `totalLeads` (variable rename for clarity)
- `activeJobs` → `activeLeads` 
- `completedJobs` → `wonLeads`

### 4. Remove Jobs Table Query (Optional Cleanup)

Since the tab now focuses on pipeline entries, the query to the `jobs` table (lines 112-122) may be unnecessary. However, keeping it allows showing both if needed later.

---

## Visual Summary

### Before:
```
┌─────────┬─────────┬───────────────┬───────────┐
│ Details │ Jobs(1) │ Communication │ Documents │
└─────────┴─────────┴───────────────┴───────────┘
     ↓
┌─────────────────────────────────────────────────┐
│ Jobs & Leads (1)                                │
│ ├─ Total Jobs: 1                                │
│ ├─ Active Jobs: 1                               │
│ └─ Completed: 0                                 │
└─────────────────────────────────────────────────┘
```

### After:
```
┌─────────┬────────────┬───────────────┬───────────┐
│ Details │ Pipeline(1)│ Communication │ Documents │
└─────────┴────────────┴───────────────┴───────────┘
     ↓
┌─────────────────────────────────────────────────┐
│ Pipeline Leads (1)                              │
│ ├─ Total Leads: 1                               │
│ ├─ Active Leads: 1                              │
│ └─ Won/Closed: 0                                │
└─────────────────────────────────────────────────┘
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/pages/ContactProfile.tsx` | Rename "Jobs" tab label to "Pipeline", update icon |
| `src/components/contact-profile/ContactJobsTab.tsx` | Rename all "Jobs" terminology to "Leads/Pipeline" |

---

## Technical Notes

- Keep `value="jobs"` in TabsTrigger to avoid breaking URL state or any navigation that uses this value
- The actual jobs from `jobs` table are rarely used in this view - pipeline entries are the primary data
- This aligns with user workflow: Contacts → Leads (Pipeline) → Projects (after approval)
- "Pipeline Leads" is clearer than "Jobs" because it indicates these are sales-stage items, not production items
