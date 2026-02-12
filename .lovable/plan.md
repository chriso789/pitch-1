

## Fix Scrolling and Clarify Status Congruence

### Issue 1: Status List Not Scrollable

The Status List uses Radix UI's `ScrollArea` component which has known issues with clipping and wheel events in nested flex containers (this has caused problems before in the Pipeline Stage Manager). The fix is to replace `ScrollArea` with a native CSS overflow container.

### Issue 2: Status Congruence with Contacts Pipeline

The Contact Kanban board and this Settings page **already share the same data source** (the `contact_statuses` table via the `useContactStatuses` hook). Any status you add, edit, or reorder here will immediately reflect on the Contacts Kanban board. To make this clearer, the description text will be updated to explicitly state this connection.

### Technical Details

**File: `src/components/settings/ContactStatusManager.tsx`**

1. **Replace ScrollArea with native overflow** (line 456):
   - Remove: `<ScrollArea className="max-h-[500px]">`
   - Replace with: `<div className="overflow-y-auto max-h-[calc(100vh-360px)]">`
   - This matches the proven pattern used in the Pipeline Stage Manager

2. **Update description text** (lines 450-453) to clarify these statuses are the same ones used on the Contacts Kanban board:
   - Change to: "These statuses power the Contacts board columns. Changes here are reflected immediately on the Contacts Kanban view."

