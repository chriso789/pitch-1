
# Fix "Save Selection" Button to Save the Estimate

## Problem

The "Save Selection" button currently only saves the **template ID** to the pipeline entry's metadata. It does NOT save or update the actual estimate data (line items, pricing, etc.). This is misleading -- users expect it to save the estimate they're building/editing.

## Current Button Layout (confusing)

| Button | What it actually does |
|--------|----------------------|
| Save Selection | Only saves template ID to pipeline metadata |
| Save Changes | Only appears when editing + has overrides; calls edge function to update estimate |
| Create Estimate | Creates a brand new estimate with full data + PDF |

## Fix

Repurpose "Save Selection" so it behaves correctly depending on context:

- **When editing an existing estimate:** Call `handleSaveLineItemChanges` (saves line items, pricing, display name, and regenerates PDF) -- same as the current "Save Changes" button
- **When creating a new estimate:** Call `handleCreateEstimate` (creates the full estimate record with PDF)

Then **remove the redundant buttons** ("Save Changes" and "Create Estimate") since "Save Selection" now handles both cases. Rename the button to **"Save Estimate"** for clarity.

## Changes

### File: `src/components/estimates/MultiTemplateSelector.tsx`

**1. Replace `handleSaveSelection` function (lines 1100-1141)**

Instead of saving template metadata, route to the correct save handler:
- If `existingEstimateId` exists -> call `handleSaveLineItemChanges()`
- Otherwise -> call `handleCreateEstimate()`

**2. Update Action Buttons section (lines 2362-2431)**

- Rename "Save Selection" to **"Save Estimate"**
- Remove the separate "Save Changes" button (lines 2402-2417) since "Save Estimate" now covers that case
- Remove the separate "Create Estimate" button (lines 2419-2430) since "Save Estimate" now covers that case
- Disable condition: `!selectedTemplateId || lineItems.length === 0 || saving || creating || savingLineItems`

The final button row will be:
1. **Save Estimate** -- saves or creates depending on context
2. **Preview** -- unchanged
3. **Export PDF** -- unchanged
