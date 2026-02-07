
# Plan: Make Contact Kanban Board Match Jobs Pipeline Sizing

## Problem

The Contact Kanban board has larger cards and columns compared to the Jobs Pipeline:

| Element | Contact Board | Jobs Pipeline | Fix To |
|---------|---------------|---------------|--------|
| **Column width** | 280-320px | No explicit width | Remove explicit width |
| **Column header padding** | p-3 | p-2 | p-2 |
| **Icon size** | w-5 h-5 | w-4 h-4 | w-4 h-4 |
| **Header text** | text-sm | text-[10px] | text-[10px] |
| **Card padding** | p-3 | p-1.5 | p-1.5 |
| **Card height** | Unconstrained | min-h-[80px] max-h-[100px] | Add constraints |
| **Card text** | text-xs/text-sm | text-[8px]/text-[10px] | Match sizes |
| **Drop zone padding** | p-2 | p-1.5 | p-1.5 |

## Solution

Update both `ContactKanbanColumn.tsx` and `ContactKanbanCard.tsx` to use the same compact sizing as the Jobs Pipeline components.

---

## File Changes

### 1. `src/features/contacts/components/ContactKanbanColumn.tsx`

**Current (lines 34-35)**:
```tsx
<div className="space-y-2 min-w-[280px] max-w-[320px] flex-shrink-0">
```

**Change to**:
```tsx
<div className="space-y-2">
```

**Current header (lines 37-53)**:
- `p-3` padding
- `w-5 h-5` icon
- `text-sm` title

**Change to match Jobs Pipeline**:
- `p-2` padding
- `w-4 h-4` icon with `h-2.5 w-2.5` inner icon
- `text-[10px]` title
- Add count styling `text-[9px]`

**Current drop zone (lines 58-65)**:
- `p-2` padding

**Change to**:
- `p-1.5` padding

---

### 2. `src/features/contacts/components/ContactKanbanCard.tsx`

**Current card (lines 74-77)**:
```tsx
<Card className={cn(
  "p-3 cursor-grab active:cursor-grabbing shadow-soft hover:shadow-medium transition-all",
  "border border-border/50 bg-card"
)}>
```

**Change to match Jobs Pipeline**:
```tsx
<Card className={cn(
  "w-full min-w-0 max-w-full min-h-[80px] max-h-[100px]",
  "shadow-soft border-0 hover:shadow-medium transition-smooth",
  "cursor-pointer relative group overflow-hidden bg-card",
  isDragging && "shadow-2xl scale-105 border-2 border-primary"
)}>
  <CardContent className="p-1.5 h-full flex flex-col justify-between">
```

**Text size changes**:
- Contact number: `text-xs` → `text-[8px]`
- Name: `text-sm` → `text-[10px]`
- Contact info (phone/email/address): Keep hidden in compact mode
- Lead score: `text-xs` → `text-[8px]`
- Lead source badge: `text-[10px]` → hide or keep small
- Action buttons: `h-7` → `h-5`, smaller icons

**Simplify card content** to show only:
- Row 1: Contact number + lead score badge
- Row 2: Contact name (centered, truncated)
- Row 3: View / Call / Email buttons (compact)

---

## Visual Comparison

```text
BEFORE (Contact Board):
┌──────────────────────────────────────┐
│ Not Interested              10       │  ← Wide header
├──────────────────────────────────────┤
│ ┌────────────────────────────────┐   │
│ │ 85                           0 │   │
│ │ mes Miudo                      │   │  ← Large card
│ │ 4013685969                     │   │
│ │ michael@obriencontractingusa   │   │
│ │ 4686 Nw 99th Ave, Sunrise, FL  │   │
│ │ ┌────────┐                     │   │
│ │ │csv imp │                     │   │
│ │ └────────┘                     │   │
│ │ View          📞   ✉️          │   │
│ └────────────────────────────────┘   │
└──────────────────────────────────────┘

AFTER (Matches Jobs Pipeline):
┌──────────────┐
│ Not Interested│  ← Compact header
│     10       │
├──────────────┤
│┌────────────┐│
││ C085      0 ││
││  mes Miudo  ││  ← Compact card (80-100px height)
││ 👁️  📞  ✉️ ││
│└────────────┘│
│┌────────────┐│
││ ...        ││
│└────────────┘│
└──────────────┘
```

---

## Implementation Summary

| File | Changes |
|------|---------|
| `ContactKanbanColumn.tsx` | Remove explicit widths, use `p-2` header, `w-4 h-4` icon, `text-[10px]` title, `p-1.5` drop zone |
| `ContactKanbanCard.tsx` | Add `min-h-[80px] max-h-[100px]`, use `p-1.5`, compact text sizes `text-[8px]`/`text-[10px]`, hide verbose contact details, compact action buttons |

---

## Verification

After implementation:
1. Navigate to Contacts → confirm Board view displays
2. Compare column/card sizing to Jobs Pipeline page
3. Verify drag-and-drop still works
4. Check that contact name and key info is still readable
5. Test on mobile to ensure horizontal scroll works
