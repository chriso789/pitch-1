
# Plan: Align Pipeline Settings with Actual System Workflow

## Problem Summary

There's a complete mismatch between:

| Where | Current State |
|-------|---------------|
| **Settings → Pipeline Stages** | Generic sales stages: "New Lead", "Contacted", "Qualified", "Negotiating", etc. - with **no keys set** |
| **Actual Pipeline Entries** | Construction workflow stages: `lead`, `contingency_signed`, `legal_review`, `ready_for_approval`, `project`, `completed`, `closed` |
| **Kanban Display** | Shows the actual stages from entries (working correctly) |

**Result:** Settings shows the wrong stages because someone created generic stages that don't match the existing workflow.

## Root Cause

1. The `pipeline_stages` table was populated with generic CRM stages
2. None of these stages have their `key` field set
3. The actual system uses construction-specific stages: Lead → Contingency Signed → Legal Review → Ready for Approval → Project → Completed → Closed

## Solution: Replace Settings Stages with Correct Workflow Stages

### Part 1: Clear and Re-seed Correct Pipeline Stages

Delete the mismatched stages and create the correct O'Brien Contracting workflow stages:

```text
| Stage Name         | Key                | Order | Description                        |
|--------------------|--------------------:|------:|------------------------------------|
| Leads              | lead               | 1     | Initial lead intake                |
| Contingency Signed | contingency_signed | 2     | Customer signed contingency        |
| Legal Review       | legal_review       | 3     | Contract under legal review        |
| Ready for Approval | ready_for_approval | 4     | Ready for manager approval         |
| Project            | project            | 5     | Approved - now a Project           |
| Completed          | completed          | 6     | Project work completed             |
| Closed             | closed             | 7     | Project fully closed               |
```

Plus terminal statuses that appear across all stages:
- **Lost** (`lost`)
- **Canceled** (`canceled`)
- **Duplicate** (`duplicate`)

### Part 2: Add "Contact Management Board" for Contacts

Per your requirement, contacts need their **own Kanban board** separate from the Jobs Pipeline. This will use the existing `contact_statuses` table:

```text
| Contact Status   | Key             | Category    |
|------------------|-----------------|-------------|
| Not Home         | not_home        | Disposition |
| Interested       | interested      | Interest    |
| Not Interested   | not_interested  | Interest    |
| Qualified        | qualified       | Disposition |
| Follow Up        | follow_up       | Action      |
| Do Not Contact   | do_not_contact  | Disposition |
```

### Part 3: Create Contact Kanban Board Component

Create a new `ContactKanbanBoard` component that:
- Displays contacts grouped by their `qualification_status`
- Uses the stages from `contact_statuses` table
- Allows drag-and-drop to update contact qualification
- Shows on the Client List page as an alternative view

### Part 4: Update Contact → Lead → Project Workflow Clarity

Reinforce the workflow distinction:

```text
CONTACT (qualification tracking)
    |
    └── Creates LEAD (when Qualified)
           |
           └── Travels through JOBS PIPELINE
                  |
                  └── Becomes PROJECT (at "Ready for Approval" stage)
                         |
                         └── Completes & Closes
```

## Implementation Steps

### Database Changes

1. **Delete incorrect pipeline stages** for O'Brien tenant
2. **Insert correct pipeline stages** with proper keys matching existing entries
3. **Add `is_terminal` flag** to pipeline_stages for Lost/Canceled/Duplicate statuses

### New Components

1. **ContactKanbanBoard.tsx** - Kanban view for contact qualification
2. **Update EnhancedClientList.tsx** - Add toggle for Kanban vs Table view

### File Changes

| File | Change |
|------|--------|
| `supabase/migration` | Delete/insert correct pipeline stages for O'Brien |
| `src/features/contacts/components/ContactKanbanBoard.tsx` | New Kanban for contacts |
| `src/features/contacts/components/EnhancedClientList.tsx` | Add Kanban view toggle |
| `src/hooks/useContactStatuses.ts` | Hook to fetch contact statuses |
| `src/hooks/usePipelineStages.ts` | No changes needed (already supports keys) |

## Visual Architecture

```text
┌─────────────────────────────────────────────────────────────────────┐
│                        CLIENT MANAGEMENT                            │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐            │
│  │  Not Home    │   │  Interested  │   │  Qualified   │  ...       │
│  │  (contacts)  │   │  (contacts)  │   │  (contacts)  │            │
│  └──────────────┘   └──────────────┘   └──────────────┘            │
│                                              │                      │
│                                              ▼                      │
│                                     Creates Lead ───────────────────┤
└─────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         JOBS PIPELINE                               │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────┐ ┌────────────────┐ ┌──────────────┐ ┌─────────────┐  │
│  │  Leads   │ │ Contingency    │ │ Legal Review │ │ Ready for   │  │
│  │          │ │ Signed         │ │              │ │ Approval    │  │
│  └──────────┘ └────────────────┘ └──────────────┘ └─────────────┘  │
│       │                                                 │           │
│       └─────────────────────────────────────────────────┤           │
│                                                         ▼           │
│  ┌──────────┐ ┌────────────────┐ ┌──────────────┐                  │
│  │ Project  │ │   Completed    │ │   Closed     │  (Terminal)      │
│  │          │ │                │ │              │                   │
│  └──────────┘ └────────────────┘ └──────────────┘                  │
│                                                                     │
│  [Lost] [Canceled] [Duplicate]  ← Available from any stage         │
└─────────────────────────────────────────────────────────────────────┘
```

## Summary

This plan:
1. **Fixes the mismatch** - Replaces generic stages with actual construction workflow stages
2. **Adds Contact Board** - Separate Kanban for tracking contact qualification
3. **Clarifies workflow** - Contact → Lead → Project progression is clear
4. **Supports multiple leads per contact** - Property managers can have multiple leads from one contact
