

## Add GlobalLayout to AI Agent Settings Page

### Problem

The AI Agent Settings page (`/settings/ai-agent`) renders without the `GlobalLayout` wrapper, so the collapsible sidebar and top navigation bar are completely missing. Every other settings-related page uses `GlobalLayout`.

### Fix

Wrap the page content in `GlobalLayout`, matching the pattern used by `Settings.tsx`, `AIAgentDashboardPage.tsx`, and all other pages.

### Technical Details

**File: `src/pages/settings/AIAgentSettingsPage.tsx`**

- Import `GlobalLayout` from `@/shared/components/layout/GlobalLayout`
- Wrap the returned JSX (line 374) with `<GlobalLayout>...</GlobalLayout>`
- The existing `<div className="container max-w-4xl py-6 space-y-6">` stays as-is inside the layout

This is a one-line import + wrapping the return -- no other changes needed. The sidebar will auto-collapse on this page since it's a `/settings/` route (handled by `CollapsibleSidebar`).

