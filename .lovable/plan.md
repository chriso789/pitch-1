

# Multi-Trade Template Tabs in Settings

## Overview

Add a tabbed interface to the Estimate Templates settings page so each trade (Roofing, Gutters, Siding, etc.) has its own tab with isolated templates. Companies can also manage which trades are available to them via a configuration panel.

## What Changes

### 1. Refactor `EstimateTemplateList.tsx` to use trade tabs

The current flat list of templates will be wrapped in a `Tabs` component. Each tab corresponds to a trade category:

- **Roofing** (default, always present) -- filters by `template_category = 'roofing'` (or legacy `'standard'`)
- **Gutters** -- filters by `template_category = 'gutters'`
- **Siding** -- filters by `template_category = 'siding'`
- **Interior Trades** -- filters by `template_category = 'interior'`
- **Exterior Trades** -- filters by `template_category = 'exterior'`

Only tabs for trades the company has enabled will be shown.

The "New Template" dialog will automatically set `template_category` to match the currently active trade tab, so templates are created in the correct category.

For the Roofing tab, the existing `roof_type` filter (Shingle/Metal/Tile/Flat) remains. For other trade tabs, the `roof_type` selector is hidden (not relevant).

### 2. Company Trade Configuration

Add a small settings gear/button on the Estimate Templates page header that opens a dialog for managing which trades the company offers. This stores the enabled trades list in the `app_settings` table using the existing pattern:

- **Key:** `enabled_estimate_trades`
- **Value:** `["roofing", "gutters", "siding"]` (JSON array)
- **Scope:** `(user_id, tenant_id, setting_key)` with the company admin's context

Default if no setting exists: `["roofing"]` only.

### 3. Wire the `template_category` on creation

When creating a new template from a non-roofing trade tab:
- Set `template_category` to the active trade value (e.g., `'gutters'`)
- For roofing templates, keep existing behavior (`template_category = 'standard'` or `'roofing'`)

### 4. Update `MultiTemplateSelector` filtering

The Build Estimate trade sections already filter by `template_category`. Ensure they also match `'standard'` as equivalent to `'roofing'` for backward compatibility with legacy templates.

## Technical Details

### File: `src/components/settings/EstimateTemplateList.tsx`

**Changes:**
- Add a `Tabs` wrapper around the template table
- Add state for `activeTrade` (default: `'roofing'`)
- Load enabled trades from `app_settings` via a query
- Filter `filteredTemplates` by `template_category` matching `activeTrade`
- In the "New Template" dialog, auto-set `template_category` to `activeTrade`
- For roofing tab, keep the `roof_type` sub-filter; hide it for other trades
- Add a "Manage Trades" button that opens a dialog with checkboxes for available trades

### New Component: `src/components/settings/CompanyTradeSettings.tsx`

A small dialog component with:
- Checkboxes for each possible trade (Roofing is always on and cannot be removed)
- Save button that upserts to `app_settings` table with key `enabled_estimate_trades`
- Used by `EstimateTemplateList` and also consumed by `MultiTemplateSelector` to know which trades to offer in the "Add Trade" dropdown

### File: `src/components/estimates/MultiTemplateSelector.tsx`

**Minor change:**
- Load the company's `enabled_estimate_trades` from `app_settings`
- Filter the `AVAILABLE_TRADES` constant to only show trades the company has enabled
- Treat `template_category = 'standard'` as equivalent to `'roofing'` when filtering templates

### Database

No migration needed. The existing `template_category` text column on `estimate_calculation_templates` and the `app_settings` table are sufficient.

### Trade Constants (shared)

Create a small shared constant file `src/lib/trades.ts`:

```typescript
export const ALL_TRADES = [
  { value: 'roofing', label: 'Roofing', icon: 'Home', locked: true },
  { value: 'gutters', label: 'Gutters', icon: 'Wrench' },
  { value: 'siding', label: 'Siding', icon: 'PanelLeft' },
  { value: 'interior', label: 'Interior Trades', icon: 'Paintbrush' },
  { value: 'exterior', label: 'Exterior Trades', icon: 'TreePine' },
];
```

Both `EstimateTemplateList` and `MultiTemplateSelector` will import from this shared source of truth.

