## Problem

In `AddItemDialog.tsx` the "Assign to Sections" row is hardcoded to: Roofing, Gutters, Exterior, Interior, Labor. Siding is missing, and the list does not reflect the trades/sections the company actually uses across its templates. When the dialog is opened from a Siding template, "Siding" should already be present and pre-checked.

## Changes

### 1. `src/components/templates/AddItemDialog.tsx`
- Remove the hardcoded `SECTION_OPTIONS` constant.
- Accept new props:
  - `availableSections: { value: string; label: string }[]` — the full list to render as toggles.
  - `defaultSections?: string[]` — pre-checked values (derived from the current template's trade).
- Drive the rendered checkboxes and the initial `sections` state from these props (fall back to a sane built-in default only if none provided).
- Keep the existing "save to catalog" behavior unchanged.

### 2. `src/components/templates/CalcTemplateEditor.tsx`
- Build the section list for the dialog from two sources:
  1. The current template's trade (derived via `isSidingTemplate(template)` → `siding`, else `roofing`).
  2. The distinct trade/section values already used by the company's other calc templates (queried via the existing template list / a lightweight `useCompanyTemplateSections` hook against `calc_templates` scoped by `useEffectiveTenantId()`).
- Always include the current template's trade first and pre-check it.
- Always include "Labor" as a stable option (it represents a row type, not a trade).
- Pass `availableSections` and `defaultSections` to `<AddItemDialog />`.

### 3. New hook `src/components/templates/hooks/useCompanyTemplateSections.ts`
- Read-only query: `select distinct` trade / section identifier from `calc_templates` for the effective tenant.
- Map known values to friendly labels via `MATERIAL_TYPE_LABELS` plus a small map for `roofing`, `siding`, `gutter`, `exterior`, `interior`.
- Return `{ sections, loading }`.

### 4. Section label map
- Add `roofing → Roofing`, `siding → Siding`, `gutter → Gutters`, `exterior → Exterior`, `interior → Interior`, `labor → Labor` to a small constant inside the hook (no DB change). This keeps the section vocabulary consistent across dialogs.

## Out of scope
- No DB schema change. `sections` on items remains a `string[]` of trade-like identifiers; we only widen the allowed vocabulary in the UI.
- No change to how downstream estimate rendering groups items by `trade_type`.

## Result
Opening "Add Custom Item" from a Siding template shows Siding (pre-checked) alongside any other sections the company uses in its templates, plus Labor. New trades a company adds in the future automatically appear here without code changes.
