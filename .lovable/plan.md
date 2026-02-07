# Plan: 3 Fixes - COMPLETED ✓

## Fixes Implemented

### 1. ✅ Document Rename (SQL Migration)
- Renamed mislabeled document from "Workmanship Warranty.pdf" to "Final Lien Release.pdf"
- Targeted by exact ID + tenant + file_path for safety

### 2. ✅ Pipeline Stages Scrolling Fixed
- Replaced Radix `ScrollArea` with native `overflow-y-auto` container
- Now uses `max-h-[calc(100vh-360px)]` for reliable scrolling across all browsers/devices

### 3. ✅ Contacts Default to Board View
- Changed default `displayMode` from `'table'` to `'kanban'`
- Added persistence via `app_settings` with key `preferred_contacts_display_mode`
- Updated toggle buttons to show "Table" and "Board" labels

## Files Changed

| File | Change |
|------|--------|
| `src/components/settings/PipelineStageManager.tsx` | Native scroll container |
| `src/features/contacts/components/EnhancedClientList.tsx` | Default kanban + persisted preference + labels |

## Verification Checklist

- [ ] Settings → Pipeline Stages: scroll to see all stages including "Working", "Lost", etc.
- [ ] Company Docs: document now shows "Final Lien Release.pdf"
- [ ] Contacts: board view shown by default, toggle preference persists on refresh
