
## What you’re asking to fix (3 items)

1) **Rename a mislabeled Company Document** so the UI shows “Final Lien Release.pdf” instead of “Workmanship Warranty.pdf” (the file content is lien release).
2) **Settings → Pipeline Stages**: you still can’t scroll far enough to reach all stages to adjust them.
3) **Contacts → Client Management** should show a **board (Kanban) layout by default**, like the Jobs Pipeline.

---

## 1) SQL migration: rename mislabeled document (safe, id-targeted)

### What I found (in your database)
There is a document record:
- **id:** `e579fcb6-ccf4-47f1-9d51-2776b293c45d`
- **tenant_id:** `14de934e-7964-4afd-940a-620d2ace125d`
- **filename:** `Workmanship Warranty.pdf`  ← mislabeled
- **file_path:** `company-docs/1767541022252-workmanship_lien_release.pdf`  ← lien release file

So we will rename **this specific record only** (not searching by filename broadly) to avoid touching your real workmanship warranty smart doc.

### Migration to add
Create a new Supabase migration file, for example:
`supabase/migrations/20260207_rename_mislabeled_company_doc.sql`

SQL (id + tenant + file_path triple-check):
```sql
-- Rename mislabeled document to match its actual file content
update public.documents
set
  filename = 'Final Lien Release.pdf',
  updated_at = now()
where id = 'e579fcb6-ccf4-47f1-9d51-2776b293c45d'
  and tenant_id = '14de934e-7964-4afd-940a-620d2ace125d'
  and file_path = 'company-docs/1767541022252-workmanship_lien_release.pdf';
```

### Verification steps
- Go to **Company Docs** and confirm the row now displays **Final Lien Release.pdf**
- Go to **Smart Docs** and confirm any listing that previously showed “Workmanship Warranty.pdf” (but opened the lien release) now displays the corrected name.

### Important environment note (Test vs Live)
Lovable has **Test** and **Live** databases that are not synced. This migration will run in **Test** now, and in **Live** when you **Publish**.  
If you need this fixed immediately in **Live before publishing**, I’ll also provide the same SQL for you to run in **Cloud View → Run SQL (Live selected)**.

---

## 2) Fix Settings → Pipeline Stages scrolling (make it reliably scrollable)

### Likely root cause
Even after increasing the `ScrollArea` max-height, Radix `ScrollArea` can still be finicky inside nested scrolling containers (trackpads, overlay scrollbars, flex parents). Your screenshot shows the list still behaving like it’s clipped.

### Robust fix (recommended)
Replace the Radix `ScrollArea` in `PipelineStageManager.tsx` with a **native scroll container** (simple `div` with `overflow-y-auto`). This avoids edge cases where the custom scroll viewport doesn’t accept wheel/trackpad scroll.

### Code change (high-level)
File:
- `src/components/settings/PipelineStageManager.tsx`

Replace:
```tsx
<ScrollArea className="...">
  <div className="...">
    {stages.map(...)}
  </div>
</ScrollArea>
```

With something like:
```tsx
<div className="max-h-[calc(100vh-360px)] min-h-[300px] overflow-y-auto pr-2">
  <div className="space-y-2 pb-4">
    {stages.map(...)}
  </div>
</div>
```

### Why this will work
- Native scrolling is consistent across browsers/OS
- No Radix viewport/scrollbar interactions
- Your page can still scroll normally, and the stage list will scroll independently when it exceeds the max height

### Verification steps
- Add a stage and confirm you can scroll down to it
- Confirm you can reach and edit “Lost / Canceled / Duplicate / Working” (or whatever is last)
- Confirm the up/down reorder buttons still work

---

## 3) Contacts page should show a board layout like Jobs Pipeline (default behavior)

### What’s happening now
The Contacts page already has a Kanban board implemented (`ContactKanbanBoard`), but it’s behind a **small icon toggle** and defaults to **table** (`displayMode` starts as `'table'`). If you don’t click the grid icon, you’ll never see the board.

### Changes to make
File:
- `src/features/contacts/components/EnhancedClientList.tsx`

Implement:
1) **Default to board** (Kanban) when the Contacts view loads
2) **Persist per-user preference** in `app_settings` (similar to how `preferred_client_view` is stored)
   - setting_key: `preferred_contacts_display_mode`
   - setting_value: `"kanban"` or `"table"` (stored as JSONB)

### UX tweaks (so it’s obvious)
- Change the toggle from icon-only to include labels:
  - “Table” and “Board”
- Optionally add a short hint above the board:
  - “Drag contacts between columns to update qualification status.”

### Verification steps
- Click **Contacts** in the sidebar → board should be visible immediately
- Confirm columns show your `contact_statuses` ordering
- Drag a contact between columns → confirm it updates in DB and persists on refresh
- Switch to Jobs view → switch back to Contacts → it should remember Board/Table preference

---

## Files that will be changed / added

### Database
- Add: `supabase/migrations/20260207_rename_mislabeled_company_doc.sql`

### Frontend
- Edit: `src/components/settings/PipelineStageManager.tsx` (replace Radix ScrollArea with native overflow scroll container)
- Edit: `src/features/contacts/components/EnhancedClientList.tsx` (default to board + persist preference + clearer toggle labels)

---

## Rollout / testing checklist (end-to-end)
1) Settings → Pipeline Stages: confirm you can scroll to the bottom and edit all stages
2) Company Docs + Smart Docs: confirm the mislabeled file displays “Final Lien Release.pdf”
3) Contacts: confirm board layout shows by default; drag/drop updates status; refresh persists
4) Mobile check: ensure board horizontal scrolling works and toggle is usable

---

## Potential edge cases & protections
- **Document rename safety**: we will update by **exact id + tenant + file_path** so we don’t accidentally rename your real workmanship warranty doc.
- **Live vs Test**: if the document id differs in Live (rare), the migration will update 0 rows; we can then run a Live-only SQL update targeting the correct id after confirming it.
