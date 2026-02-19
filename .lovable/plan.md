
# Add AI Admin Button to Sidebar (Between Help and Settings)

## Overview
Add a dedicated "AI Admin" navigation link in the sidebar's bottom section, positioned between Help and Settings. Only visible to users with the `master` role.

## Change

### File: `src/shared/components/layout/Sidebar.tsx`

**1. Reorder `bottomNavigation` array (lines 319-335)**

Change the order and add an AI Admin entry:

```typescript
const bottomNavigation = [
  {
    name: "Help",
    href: "help",
    path: "/help",
    icon: HelpCircle,
    description: "Support & documentation"
  },
  {
    name: "AI Admin",
    href: "ai-admin",
    path: "/settings/ai-admin",
    icon: Bot,
    description: "AI backend builder",
    masterOnly: true
  },
  {
    name: "Settings",
    href: "settings",
    path: "/settings",
    icon: Settings,
    description: "System configuration",
    testId: TEST_IDS.sidebar.settings
  },
];
```

**2. Update `getActiveSection` (around line 105)**

Add a check for the AI Admin route:
```typescript
if (path.startsWith('/settings/ai-admin')) return 'ai-admin';
```
Place this **before** the existing `/settings` check so it matches first.

**3. Filter `masterOnly` items in the bottom nav render (lines 677-707)**

Add `.filter()` before `.map()` to hide `masterOnly` items for non-master users:
```typescript
{bottomNavigation
  .filter(item => !item.masterOnly || currentUser?.role === 'master')
  .map((item) => ( ... ))}
```

No new files, no database changes. The `Bot` icon is already imported (line 35).
