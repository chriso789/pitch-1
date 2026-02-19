

# Clean Up Lead Details Header

## Problem
The lead details header is cluttered and takes up too much vertical space. Information is spread across 6+ rows with redundant data (phone, email, and address appear both in the main header AND the contact card on the right). The layout feels unstructured.

## Proposed Layout

Reorganize into a compact, well-structured header with clear visual hierarchy:

```text
+------------------------------------------------------------------+
| [Back]  Name H1  [Status Dropdown]         [Contact Card - Right] |
|                                             - Name, Phone, Email  |
|  Pin LEAD PROPERTY                          - Address             |
|  123 Main St, City, ST ZIP  [Re-verify]     - Qualification       |
|                                             - Link to contact     |
|  Phone: 555-1234  |  Email: a@b.com        |                     |
|                                                                   |
|  Priority: High  |  Roof: Tile  |  Age: 7yr  |  Value: $2,000 [E]|
|  Sales Rep: John Smith [E]   Secondary: Jane [E]                  |
+------------------------------------------------------------------+
```

### Changes to `src/pages/LeadDetails.tsx`

**1. Consolidate the property details row (lines 773-806)**
- Make the address display more compact: single line with smaller text, remove the "LEAD PROPERTY" label since it's obvious from context
- Keep MapPin icon and Re-verify button inline

**2. Compact the contact info row (lines 808-828)**
- Merge phone and email into a single tight row with pipe separators
- Use slightly smaller text

**3. Consolidate project metadata row (lines 830-864)**
- Keep Priority, Roof, Roof Age, Est. Value, and Edit button in one compact row
- Use a subtle background/border to visually group them as a "stats bar"

**4. Merge Sales Rep and Secondary Rep into one row (lines 866-985)**
- Display both reps on a single line separated by a divider
- Reduces two rows to one

**5. Remove duplicate info from Contact Card (lines 989-1068)**
- Since phone, email, and address are already in the main header, the contact card should be slimmer
- Keep: Contact name (as link), qualification status dropdown, and external link button
- Remove: phone, email, and address from the card (they're redundant)

### Specific Code Changes

**Address section** - Remove the "LEAD PROPERTY" label, make it a single compact line:
```tsx
<div className="flex items-center gap-2 mt-2 text-sm">
  <MapPin className="h-4 w-4 text-primary flex-shrink-0" />
  <p className="text-foreground">
    {address text}
  </p>
  <AddressReverificationButton ... />
</div>
```

**Stats bar** - Wrap in a subtle card-like container:
```tsx
<div className="flex items-center gap-4 mt-3 text-sm bg-muted/50 rounded-lg px-3 py-2">
  {/* Priority, Roof, Age, Value, Edit */}
</div>
```

**Sales reps** - Combine into one row:
```tsx
<div className="flex items-center gap-4 mt-2 text-sm flex-wrap">
  <div className="flex items-center gap-2">
    <span className="text-muted-foreground">Rep:</span>
    {/* rep name + edit */}
  </div>
  <span className="text-muted-foreground">|</span>
  <div className="flex items-center gap-2">
    <span className="text-muted-foreground">Split Rep:</span>
    {/* secondary rep or Add button */}
  </div>
</div>
```

**Contact Card** - Slim down by removing redundant fields:
```tsx
<Card className="w-64 shadow-soft border-primary/20">
  {/* Keep: header with Contact label, qualification dropdown, external link */}
  {/* Keep: contact name */}
  {/* Remove: phone, email, address (already in main header) */}
</Card>
```

## Result
- Header shrinks from ~6 vertical sections to ~4 compact rows
- No redundant data between header and contact card
- Project metadata visually grouped in a subtle stats bar
- Sales reps consolidated to one line
- Cleaner, more professional appearance matching the detail-page-layout-protocol
