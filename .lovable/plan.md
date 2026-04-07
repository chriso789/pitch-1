

# Reorder Estimate Line Items: Tear Off → Materials → Install

## Problem
Currently, the estimate PDF and builder display items grouped as **Materials** then **Labor**. Real roofing workflow is: tear off the old roof, install materials, then install the new roof product. The ordering should reflect this: **Labor (Tear Off) → Materials → Labor (Install)**.

## Approach
Add a `labor_phase` field to `LineItem` that distinguishes tear-off labor from installation labor. Use this field to reorder sections in both the PDF renderer and the live builder table.

## Changes

### 1. Add `labor_phase` to LineItem interface
**File: `src/hooks/useEstimatePricing.ts`**
- Add `labor_phase?: 'tear_off' | 'install'` to the `LineItem` interface (defaults to `'install'` when unset).

### 2. Update `buildRenderBlocks` ordering in PDF
**File: `src/components/estimates/EstimatePDFDocument.tsx`**
- Change the `buildRenderBlocks` function to split labor items into two groups based on `labor_phase`:
  - **Tear Off** labor items (`labor_phase === 'tear_off'`)
  - **Materials** (all material items)
  - **Install** labor items (`labor_phase === 'install'` or unset)
- Render sub-headers: "TEAR OFF" → "MATERIALS" → "INSTALLATION"

### 3. Update `SectionedLineItemsTable` section ordering
**File: `src/components/estimates/SectionedLineItemsTable.tsx`**
- Display three sections instead of two: Tear Off, Materials, Installation.
- Each section gets its own header row and "Add item" button.

### 4. Add labor phase selector when adding/editing labor items
**File: `src/components/estimates/SectionedLineItemsTable.tsx`**
- When adding a labor item, show a toggle or dropdown for "Tear Off" vs "Install" phase.
- Default new labor items to "Install" unless the item name contains "tear" (auto-detect).

### 5. Update default template items with correct phases
**File: `src/components/estimates/TemplateSectionSelector.tsx`**
- Tag default "Tear Off" labor items with `labor_phase: 'tear_off'`.
- Tag "Shingle Install" and other install labor with `labor_phase: 'install'`.

### 6. Preserve backward compatibility
- Existing estimates without `labor_phase` will render labor items in the "Installation" section by default (no migration needed).
- The `labor_phase` field is stored in the `line_items` JSONB column alongside other line item properties.

## Section Order (PDF and Builder)
```text
┌─────────────────────────────┐
│  TEAR OFF                   │
│  - Tear Off          32 SQ  │
│  - Haul Away          1 EA  │
├─────────────────────────────┤
│  MATERIALS                  │
│  - OC Duration       40 SQ  │
│  - Drip Edge         19 EA  │
│  - Ridge Cap          7 BDL │
│  - Ice & Water       19 RL  │
│  - ...                      │
├─────────────────────────────┤
│  INSTALLATION               │
│  - Shingle Install   36 SQ  │
│  - Flashing Work      3 EA  │
└─────────────────────────────┘
```

## Technical Notes
- `labor_phase` is optional on LineItem — old data gracefully falls into "Installation"
- Auto-detection: items with names matching `/tear|removal|strip|dispose|haul/i` default to `tear_off`
- The `sort_order` within each phase section is preserved per existing standards

