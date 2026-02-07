

# Plan: Simplify Settings - Remove Smart Docs Tab

## Current State

The Settings page currently has Smart Documents in **two places**:
1. **Sidebar Menu** - Direct access button (user wants to keep this)
2. **Settings → Automations** - Sub-tab with "Smart Documents" and "Dynamic Tags" (user wants to remove this)

Pipeline Stages management is **already implemented** at **Settings → General → Pipeline Stages** sub-tab.

## Changes Required

### Remove Smart Docs from Automations Tab

**File:** `src/features/settings/components/Settings.tsx`

Remove the Smart Documents and Dynamic Tags sub-tabs from the Automations section:

**Before (lines 314-331):**
```typescript
case "automations":
  return (
    <Tabs value={activeSubTab} onValueChange={setActiveSubTab} className="w-full">
      <TabsList>
        <TabsTrigger value="automations">Automations</TabsTrigger>
        <TabsTrigger value="templates">Smart Documents</TabsTrigger>
        <TabsTrigger value="tags">Dynamic Tags</TabsTrigger>
      </TabsList>
      <TabsContent value="automations">
        <AutomationManager />
      </TabsContent>
      <TabsContent value="templates">
        <SmartDocumentEditor />
      </TabsContent>
      <TabsContent value="tags">
        <DynamicTagManager />
      </TabsContent>
    </Tabs>
  );
```

**After:**
```typescript
case "automations":
  return <AutomationManager />;
```

This simplifies the Automations tab to only show the automation rules, since Smart Documents are accessible via the sidebar menu.

### Remove Unused Imports

Remove the now-unused imports:
- `SmartDocumentEditor` (line 17)
- `DynamicTagManager` (line 18)

## Summary

| Change | Before | After |
|--------|--------|-------|
| Automations tab | 3 sub-tabs (Automations, Smart Documents, Dynamic Tags) | Single AutomationManager component |
| Pipeline Stages | ✅ Already in General → Pipeline Stages | No change needed |
| Smart Docs access | Sidebar menu + Settings tab | Sidebar menu only |

This keeps the Settings page cleaner while maintaining access to Smart Documents through the dedicated sidebar menu button.

