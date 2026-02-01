
# Update Pipeline Terminology: Leads & Jobs Distinction

## Understanding the Workflow

The pipeline contains entries at different stages of the sales-to-completion lifecycle:

| Stage | Type | Description |
|-------|------|-------------|
| New Lead | **Lead** | Initial inquiry |
| Contingency Signed | **Lead** | Agreement in place |
| Legal Review | **Lead** | Awaiting legal clearance |
| Ready for Approval | **Lead** | Pending final approval |
| **Approved/Project** | **Job** | Approved - now active work |
| Completed | **Job** | Work finished |
| Closed | **Job** | Fully closed out |

**Key Insight:** A pipeline entry transitions from "Lead" to "Job" at the **Approved/Project** stage, but it **stays in the pipeline** through closeout.

---

## Changes Required

### 1. ContactProfile.tsx - Tab Label

**Current:** `Pipeline ({pipelineEntries.length})`

**Change to:** Show both counts for clarity

```tsx
Pipeline ({leadsCount} leads, {jobsCount} jobs)
// or simply:
Pipeline ({pipelineEntries.length})  // Keep generic since both are there
```

**Recommendation:** Keep `Pipeline ({count})` as the tab label since it contains both leads and jobs. No change needed here.

### 2. ContactJobsTab.tsx - Statistics Cards

Update the three stats cards to properly distinguish:

| Current | Change To |
|---------|-----------|
| Total Leads | **Pipeline Total** |
| Active Leads | **Active** (pre-closeout) |
| Won/Closed | **Closed** |

**Or better - show Lead/Job breakdown:**

| Card 1 | Card 2 | Card 3 |
|--------|--------|--------|
| **Leads** (pre-approval count) | **Active Jobs** (approved, not closed) | **Closed** |

### 3. ContactJobsTab.tsx - Section Header

**Current:** `Pipeline Leads ({totalJobs})`

**Change to:** `Pipeline ({totalJobs})` or `Leads & Jobs ({totalJobs})`

### 4. Add Visual Distinction for Lead vs Job

In the pipeline card items, show a badge indicating whether an entry is a "Lead" or "Job" based on its status:

```tsx
{isLeadStage(entry.status) ? (
  <Badge variant="outline" className="bg-blue-50 text-blue-700">Lead</Badge>
) : (
  <Badge variant="outline" className="bg-green-50 text-green-700">Job</Badge>
)}
```

Where `isLeadStage` checks if status is one of: `lead`, `contingency_signed`, `legal_review`, `ready_for_approval`

---

## Implementation Details

### File: `src/components/contact-profile/ContactJobsTab.tsx`

**Line 366:** 
```typescript
// Change from: "Total Leads"
// To: "Leads" with count of pre-approval entries only
```

**Line 378:**
```typescript
// Change from: "Active Leads"  
// To: "Active Jobs" with count of post-approval, non-closed entries
```

**Line 390:**
```typescript
// Keep: "Won/Closed" or change to just "Closed"
```

**Line 403:**
```typescript
// Change from: "Pipeline Leads ({totalJobs})"
// To: "Pipeline ({totalJobs})"
```

### Add Helper Constants

```typescript
const LEAD_STATUSES = ['lead', 'contingency_signed', 'legal_review', 'ready_for_approval'];
const JOB_STATUSES = ['project', 'completed', 'closed'];
const TERMINAL_STATUSES = ['lost', 'canceled', 'duplicate'];

const isLead = (status: string) => LEAD_STATUSES.includes(status);
const isJob = (status: string) => JOB_STATUSES.includes(status);
```

### Calculate Separate Counts

```typescript
const leadsCount = unifiedJobs.filter(j => 
  j.type === 'pipeline' && isLead(j.originalStatus || '')
).length;

const activeJobsCount = unifiedJobs.filter(j => 
  j.type === 'pipeline' && isJob(j.originalStatus || '') && 
  !['closed', 'completed'].includes(j.originalStatus || '')
).length;

const closedCount = unifiedJobs.filter(j => 
  ['closed', 'completed', 'closed_won'].includes(j.originalStatus || '')
).length;
```

---

## Visual Summary

### Before:
```
┌────────────────────────────────────────────────────┐
│ Pipeline Leads (5)                                 │
│                                                    │
│ [Total Leads: 5] [Active Leads: 3] [Won/Closed: 2] │
└────────────────────────────────────────────────────┘
```

### After:
```
┌────────────────────────────────────────────────────┐
│ Pipeline (5)                                       │
│                                                    │
│ [Leads: 3] [Active Jobs: 1] [Closed: 1]            │
│                                                    │
│ ┌─────────────────────────────────────┐            │
│ │ 🔵 Lead  | Smith - Roofing Lead     │            │
│ │ Status: Contingency Signed          │            │
│ └─────────────────────────────────────┘            │
│ ┌─────────────────────────────────────┐            │
│ │ 🟢 Job   | Jones - Tile Project     │            │
│ │ Status: Active Project              │            │
│ └─────────────────────────────────────┘            │
└────────────────────────────────────────────────────┘
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/contact-profile/ContactJobsTab.tsx` | Update statistics labels, add Lead/Job distinction logic, update section header |
| `src/pages/ContactProfile.tsx` | No changes needed - "Pipeline" is the correct generic term |

---

## Technical Notes

- The `originalStatus` field on `UnifiedJobItem` stores the raw pipeline status (e.g., 'lead', 'project')
- Pre-approval statuses: `lead`, `contingency_signed`, `legal_review`, `ready_for_approval`
- Post-approval statuses: `project`, `completed`, `closed`
- Terminal statuses: `lost`, `canceled`, `duplicate`
- This matches the `LEAD_STAGES` constant in `usePipelineData.ts`
