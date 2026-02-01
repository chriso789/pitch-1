# ✅ COMPLETED: Pipeline Terminology Update - Leads & Jobs Distinction

## Summary

Updated the Contact Profile's Pipeline tab to properly distinguish between **Leads** (pre-approval stages) and **Jobs** (post-approval stages).

## Changes Made

### 1. Statistics Cards (3 cards)
| Before | After |
|--------|-------|
| Total Leads | **Leads** (pre-approval count) |
| Active Leads | **Active Jobs** (approved/project status) |
| Won/Closed | **Closed** (completed + closed) |

### 2. Section Header
| Before | After |
|--------|-------|
| Pipeline Leads (X) | **Pipeline (X)** |

### 3. Visual Lead/Job Badge
Each pipeline entry now shows a color-coded badge:
- 🔵 **Lead** (blue) - for entries in: `lead`, `contingency_signed`, `legal_review`, `ready_for_approval`
- 🟢 **Job** (green) - for entries in: `project`, `completed`, `closed`

### 4. Helper Logic Added
```typescript
const LEAD_STATUSES = ['lead', 'contingency_signed', 'legal_review', 'ready_for_approval'];
const JOB_STATUSES = ['project', 'completed', 'closed'];
const TERMINAL_STATUSES = ['lost', 'canceled', 'duplicate'];

const isLeadStatus = (status: string) => LEAD_STATUSES.includes(status);
const isJobStatus = (status: string) => JOB_STATUSES.includes(status);
```

## File Modified
- `src/components/contact-profile/ContactJobsTab.tsx`

## Workflow Reference
| Stage | Type | Description |
|-------|------|-------------|
| New Lead | Lead | Initial inquiry |
| Contingency Signed | Lead | Agreement in place |
| Legal Review | Lead | Awaiting legal clearance |
| Ready for Approval | Lead | Pending final approval |
| **Approved/Project** | **Job** | Approved - now active work |
| Completed | Job | Work finished |
| Closed | Job | Fully closed out |
