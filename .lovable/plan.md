
## Add AI Agent to Settings Sidebar + Main Navigation

### Problem
The AI Agent Settings page (`/settings/ai-agent`) and Dashboard (`/ai-agent-dashboard`) exist but are completely hidden -- there's no link to them from the Settings page sidebar or the main app sidebar.

### Solution

Two changes to make the AI Agent accessible:

#### 1. Add "AI Agent" tab to Settings page sidebar

Insert a new entry in the `settings_tabs` database table so it appears under the **Communications** category alongside Voice Assistant, Email, and Integrations.

**Database insert:**
- `tab_key`: `ai-agent`
- `label`: `AI Agent`  
- `icon_name`: `Bot`
- Category mapping: Communications

Then wire up the `ai-agent` tab in `Settings.tsx` to either render the AI Agent settings inline or navigate to `/settings/ai-agent`.

#### 2. Add "AI Agent" to the main app sidebar

Add a sidebar navigation item (under the Communications section or as a standalone item) that links to `/ai-agent-dashboard`.

---

### Technical Details

**Database migration:**
- Insert `ai-agent` row into `settings_tabs` with `order_index: 26` (after Voice Assistant at 25)

**File: `src/features/settings/components/Settings.tsx`**
- Add `"ai-agent": "communications"` to `TAB_TO_CATEGORY` mapping (line ~100)
- Add a `case "ai-agent":` in `renderTabContent()` that either:
  - Renders the AI Agent settings page content inline, or
  - Redirects to `/settings/ai-agent` (simpler approach -- just render a link/button card that takes you there, similar to how "portals" works)
- Better approach: import the `AIAgentSettingsPage` content and render it directly

**File: `src/shared/components/layout/Sidebar.tsx`**
- Add an "AI Agent" nav item linking to `/ai-agent-dashboard` in the sidebar navigation
