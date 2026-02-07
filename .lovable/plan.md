
# Fix: Preview Estimate Toggle Switches Being Cut Off

## Problem
The toggle switches in the "Preview Estimate" sidebar are being cut off at the right edge, making them invisible and unusable. This appears to happen because the flex container doesn't properly prevent the switches from shrinking.

## Root Cause
The `ToggleRow` component (lines 641-672) uses `flex justify-between` but:
1. The `Switch` component lacks `shrink-0` class - allowing it to be squeezed out of view
2. The `Label` wrapper lacks `min-w-0` class - preventing proper text overflow handling
3. These standards were documented in project memory but not properly implemented

## The Fix

### File: `src/components/estimates/EstimatePreviewPanel.tsx`

Update the `ToggleRow` component (around line 654-671) to properly handle flex sizing:

```typescript
function ToggleRow({
  label,
  checked,
  onChange,
  badge,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  badge?: string;
  disabled?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-2 ${disabled ? 'opacity-50' : ''}`}>
      <Label className="text-sm flex items-center gap-1.5 cursor-pointer min-w-0 truncate">
        <span className="truncate">{label}</span>
        {badge && (
          <Badge variant="outline" className="text-[10px] py-0 px-1 shrink-0">
            {badge}
          </Badge>
        )}
      </Label>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        className="scale-90 shrink-0"
      />
    </div>
  );
}
```

### Changes Made:
| Element | Class Added | Purpose |
|---------|-------------|---------|
| Container `div` | `gap-2` | Ensures minimum spacing between label and switch |
| `Label` | `min-w-0 truncate` | Allows label to shrink and truncate text if needed |
| Label text | `<span className="truncate">` | Enables text truncation on long labels |
| `Badge` | `shrink-0` | Prevents badge from being compressed |
| `Switch` | `shrink-0` | **Critical fix** - prevents switch from being pushed off-screen |

## Why This Happens
In CSS flexbox, items are allowed to shrink by default (`flex-shrink: 1`). When the container width is constrained, both the label AND the switch compete for space. Without `shrink-0`, the switch can be compressed to nothing.

## After the Fix
- Toggle switches will always remain visible
- Labels will truncate gracefully if too long
- The layout will be stable at any viewport width
