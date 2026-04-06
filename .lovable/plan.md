

## Add Bulk Report Import to Developer Settings

### Summary
Embed the existing `BulkReportImporter` component into the `DeveloperAccess` settings panel. This is a master/developer-only section, so no other users will see it. No new components needed — just wire the existing one in.

### Changes

**1. `src/components/settings/DeveloperAccess.tsx`**
- Import `BulkReportImporter` from `@/components/measurements/BulkReportImporter`
- Add a new card section titled "Bulk Vendor Report Import" below the existing developer tools
- Include the `BulkReportImporter` component inside it with a brief description ("Upload 200+ paid roof reports for AI training ground truth")
- Gate visibility to `is_developer` or `master` role (already enforced by the page itself, but add an explicit check for safety)

That's it. One file, one import, one card. The bulk importer already handles:
- Multi-file drag-and-drop PDF upload
- Calling `roof-report-ingest` edge function per file
- Auto-detecting vendor type (Roofr, EagleView, Xactimate, etc.)
- Extracting all measurements
- Geocoding addresses
- Creating training sessions with 3x confidence weight
- Progress bar and per-file status tracking

### Files to Modify

| File | Change |
|------|--------|
| `src/components/settings/DeveloperAccess.tsx` | Add BulkReportImporter card section |

