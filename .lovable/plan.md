

# Merge "Products & Pricing" into a Single Tab with Sub-Tabs

## Problem
The Settings sidebar has 5+ separate entries under "Products & Pricing" (Materials, Estimate Templates, Suppliers, Products, Pricing, and Measurements). This creates too many sidebar items.

## Solution
Consolidate all "Products & Pricing" items into a single sidebar entry that renders sub-tabs internally — the same pattern already used by the "General" tab (which has sub-tabs for General Settings, Pipeline Stages, Contact Statuses, etc.).

## Changes

### `src/features/settings/components/Settings.tsx`

1. **Remove individual product tab mappings** from `TAB_TO_CATEGORY` — delete entries for `materials`, `products`, `suppliers`, `estimates`, `pricing`, `measurements`. Replace with a single `products-pricing` entry mapped to the `products` category.

2. **Add a new case in `renderTabContent()`** for `"products-pricing"` that renders a `<Tabs>` component with sub-tabs:
   - Materials → `<MaterialCatalogManager />`
   - Estimate Templates → `<EstimateTemplateList />`
   - Suppliers → `<SupplierManagement />`
   - Products → `<ProductCatalogManager />`
   - Pricing → `<PriceManagementDashboard />`
   - Measurements → `<BatchRegenerationPanel />` (if role allows)

3. **Remove the old individual cases** (`case "materials"`, `case "estimates"`, `case "suppliers"`, `case "products"`, `case "pricing"`, `case "measurements"`) since they'll be handled as sub-tabs.

4. **Database consideration**: The `settings_tabs` table drives which tabs appear. We need to either:
   - Add a migration to insert a single `products-pricing` tab and deactivate the individual ones, OR
   - Handle it in the UI by checking if the active tab is any of those keys and rendering the combined view.

   The safest approach is to handle it in the UI: map all existing product-related `tab_key` values to the combined component, so no database migration is needed and existing configurations keep working.

### Implementation detail

In `renderTabContent()`, the existing individual cases will all fall through to the same combined sub-tab component. A `productSubTab` state variable will track which sub-tab is active, defaulting to whichever product tab the user clicked in the sidebar. This way, clicking "Materials" in the sidebar still works but shows it as a sub-tab within the unified view.

Alternatively (cleaner): collapse all product sidebar entries into one entry by filtering them out in the sidebar rendering and replacing with a single "Products & Pricing" entry. The sub-tab default can be driven by URL params (`?tab=products-pricing&sub=materials`).

### Files changed

| File | Change |
|------|--------|
| `src/features/settings/components/Settings.tsx` | Merge 6 product cases into one tabbed component; update sidebar grouping to show single entry |

