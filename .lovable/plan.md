

# Fix: Owner Display, Email Masking, and Storm Reports UX

## Issues Identified

### 1. Owner Name Shows "null" Instead of First/Last Name
- Line 735: The owner display shows `owner.name` which can be "null" when enrichment returns no name
- Line 737: Shows "Unknown" for gender and "Unknown" for credit score, which is unhelpful
- The header (line 614) shows "Unknown Owner" -- needs to display actual first and last name separately when available

### 2. Emails Are Masked (e.g., `sa********@hotmail.com`)
- The masking comes from the enrichment pipeline (people search scrapers return masked emails from public sites like FastPeopleSearch/WhitePages)
- The UI should show the FULL email when available, not the masked version
- If only masked emails exist, still show them but indicate they're partial

### 3. Storm Reports Dialog Needs Scroll + Filter
- The dialog currently shows all reports in one list with no filtering
- Need filter tabs/buttons for "All", "Hail", "Wind", "Tornado"
- The `ScrollArea` is already there but the list needs better scrolling UX
- Reports should show event-type-specific colors (blue for hail, orange for wind, red for tornado)

---

## Technical Changes

### File 1: `src/components/storm-canvass/PropertyInfoPanel.tsx`

**A. Fix Owner Display (lines 710-747)**

- Replace `owner.name` display with split first/last name display
- Show age when available instead of "gender" (enrichment doesn't return gender)
- Remove "Credit: Unknown" -- enrichment doesn't provide credit scores
- In the header (line 614), show first + last name from enriched data

**B. Show Full Emails (lines 785-806)**

- Display the full email address without masking
- If the email contains asterisks (masked), add a subtle "(partial)" indicator

**C. Storm Reports: Add Filter Tabs + Better Scroll (lines 942-997)**

Add state for storm filter:
```
const [stormFilter, setStormFilter] = useState<'all' | 'hail' | 'wind' | 'tornado'>('all');
```

Add filter buttons above the report list:
- "All" / "Hail" / "Wind" / "Tornado" toggle buttons
- Filter logic: match `event_type` containing the keyword (case-insensitive)
- Show count per filter type as badges
- Set `max-h-[60vh]` on ScrollArea for proper scrolling

Color-code event type badges:
- Hail: blue
- Wind: orange  
- Tornado: red
- Other: gray

---

## Summary

| Area | Change |
|------|--------|
| Owner name | Show first + last name separately; show age; remove fake gender/credit fields |
| Emails | Display full address; mark masked emails with "(partial)" indicator |
| Storm dialog | Add hail/wind/tornado filter tabs with counts; improve scroll height; color-code event badges |

