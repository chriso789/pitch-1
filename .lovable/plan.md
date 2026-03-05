

# Fix: "Create Lead" Button in Contact Empty State

## Problem
The "Create Lead" button shown in the empty state (line 673) calls `setShowLeadDialog(true)`, but **no dialog is connected to the `showLeadDialog` state**. The `LeadCreationDialog` component (line 467) only uses a trigger-based approach and doesn't accept `open`/`onOpenChange` props.

## Fix

**File: `src/components/contact-profile/ContactJobsTab.tsx`**

Replace the empty-state button (line 673-676) with a `LeadCreationDialog` using its own trigger, identical to the one in the header (line 467-476):

```tsx
// Replace:
<Button onClick={() => setShowLeadDialog(true)}>
  <Plus className="h-4 w-4 mr-2" />
  Create Lead
</Button>

// With:
<LeadCreationDialog
  contact={contact}
  onLeadCreated={handleLeadCreated}
  trigger={
    <Button>
      <Plus className="h-4 w-4 mr-2" />
      Create Lead
    </Button>
  }
/>
```

The unused `showLeadDialog` state can also be removed since nothing else references it.

## Scope
- Single file change: `src/components/contact-profile/ContactJobsTab.tsx`
- Remove unused `showLeadDialog` state variable
- Replace the broken button with a working `LeadCreationDialog` instance

