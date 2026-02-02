
# Add Insurance Section to Sidebar Navigation

## Summary

The Insurance section is completely missing from the sidebar navigation. I will add:
1. A route for `/scope-intelligence` in App.tsx
2. An "Insurance" expandable section in the sidebar with two sub-items

---

## Current State

Looking at the uploaded screenshot, I can confirm the sidebar shows:
- Dashboard, Pipeline, Contacts, Jobs, Estimates, Production, Calendar
- Storm Canvas Pro, Smart Docs, Presentations, Permit Expediter
- Follow Up Hub (expandable)
- Settings, Help

**Missing:** Insurance section with Claims and Scope Intelligence links

---

## Files to Modify

| File | Change |
|------|--------|
| `src/App.tsx` | Add import for ScopeIntelligence and route for `/scope-intelligence` |
| `src/shared/components/layout/Sidebar.tsx` | Add Insurance expandable section after Permit Expediter |

---

## Implementation Details

### 1. App.tsx Changes

**Add import** (around line 124):
```typescript
import ScopeIntelligence from "./pages/ScopeIntelligence";
```

**Add route** (after line 324, near the `/insurance` route):
```typescript
<Route path="/scope-intelligence" element={<ProtectedRoute><ScopeIntelligence /></ProtectedRoute>} />
```

---

### 2. Sidebar.tsx Changes

**Add `Search` to icon imports** (line 6-39) - needed for Scope Intelligence icon:
```typescript
import { ..., Search } from "lucide-react";
```

**Add state for Insurance expansion** (line 73, after `followUpExpanded`):
```typescript
const [insuranceExpanded, setInsuranceExpanded] = React.useState(false);
```

**Update getActiveSection()** (around line 101-121) - add detection for insurance routes:
```typescript
if (path.startsWith('/insurance') || path.startsWith('/scope-intelligence')) return 'insurance';
```

**Add Insurance expandable section** (after line 408, after the main navigation loop but before the Follow Up Hub section around line 410):

The Insurance section will follow the exact same pattern as the "Follow Up Hub" expandable section:

```text
{/* Insurance Expandable Section */}
<div className="space-y-0.5">
  <button ...> <!-- Shield icon, "Insurance" label, chevron -->
  
  {/* Insurance Sub-items (when expanded) */}
  <div className="ml-4 pl-3 border-l ...">
    <Link to="/insurance">Claims</Link>
    <Link to="/scope-intelligence">Scope Intelligence</Link>
  </div>
</div>
```

---

## Visual Result

**Before (current):**
```text
┌────────────────────────┐
│ ...                    │
│ Permit Expediter       │
│ ▼ Follow Up Hub        │
│   ├─ Inbox             │
│   └─ ...               │
│ ─── Portals ───        │
└────────────────────────┘
```

**After:**
```text
┌────────────────────────┐
│ ...                    │
│ Permit Expediter       │
│ ▼ Follow Up Hub        │
│   ├─ Inbox             │
│   └─ ...               │
│ ▼ Insurance            │  ← NEW
│   ├─ Claims            │  ← NEW
│   └─ Scope Intelligence│  ← NEW
│ ─── Portals ───        │
└────────────────────────┘
```

---

## Technical Details

### Icon Choices
- **Insurance section**: `Shield` icon (already imported)
- **Claims sub-item**: `FileText` icon (already imported)  
- **Scope Intelligence sub-item**: `Search` icon (needs import)

### Navigation Logic
- Auto-expand Insurance section when user is on `/insurance` or `/scope-intelligence`
- Highlight "Claims" when on `/insurance`
- Highlight "Scope Intelligence" when on `/scope-intelligence`
- Parent "Insurance" shows active state when either child route is active
- Works in both expanded and collapsed sidebar states (collapsed shows Shield icon only)

### Placement
The Insurance section will be placed after "Follow Up Hub" but before the "Portals" divider, keeping related communication/business tools grouped together.
