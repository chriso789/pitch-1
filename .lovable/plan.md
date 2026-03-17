

# Hide Approval Requirements When Lead is Already a Project or Beyond

## Problem
The "Approval Requirements" card with "Approve to Project" and "Manager Approve" buttons is always visible, even when the lead has already been moved to `project`, `completed`, or `closed` status. This is confusing — those buttons serve no purpose once the lead has passed the approval gate.

## Solution
Wrap the Approval Requirements card in a conditional that only renders it when `lead.status` is in a pre-project stage (i.e., `lead`, `estimate_sent`, `contingency_signed`, `legal_review`, `ready_for_approval`). Hide it for `project`, `completed`, `closed`, `lost`, `canceled`, `duplicate`.

## File Changed
**`src/pages/LeadDetails.tsx`** (~line 1061-1078)

Add a condition around the Approval Requirements card:
```tsx
{lead && !['project', 'completed', 'closed', 'lost', 'canceled', 'duplicate'].includes(lead.status) && (
  <Card className="border-primary/20">
    ...ApprovalRequirementsBubbles...
  </Card>
)}
```

This is a single-line wrapper change. The entire card (header + bubbles + buttons) will be hidden once the lead advances past the approval gate.

