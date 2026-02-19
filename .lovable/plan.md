

# Merge Contact Information into the Page Header

## What Changes

Currently the Contact Profile page has three vertical sections before tabs:
1. **Header** (top) -- avatar, name, status dropdown, action buttons
2. **Quick Stats row** (inside Details tab) -- Lead Score, Created, Source, Status, Total Jobs
3. **Contact Information card** (inside Details tab) -- Full Name, Phone, Address, Email with Edit button

The user wants the contact details (phone, email, address) pulled up and merged directly into the header area at the top of the page, so key contact info is always visible without scrolling or switching tabs.

## Layout After Change

The header section in `ContactProfile.tsx` (lines 254-353) will be restructured to include an inline contact info bar below the name/status row, following the detail-page-layout-protocol:

```text
+---------------------------------------------------------------+
| [Back]  [Avatar]  Name  #Contact-Number  [Status Dropdown]    |
|                   Company / Homeowner                          |
|         Phone: (941) 979-6881  |  Email: ...  |  Address: ... |
|         [Call] [SkipTrace] [Assign Rep] [Edit] [Create Lead]   |
+---------------------------------------------------------------+
```

The phone, email, and address are shown as a compact inline row with icons, directly under the name. This mirrors the existing pattern from the detail-page-layout-protocol (compact full-width horizontal contact bar).

## Technical Details

### File: `src/pages/ContactProfile.tsx`
- **Lines 261-295**: After the name + status dropdown block, add a new compact contact info bar showing:
  - Phone icon + `contact.phone` (clickable)
  - Mail icon + `contact.email`
  - MapPin icon + formatted address (`address_street, address_city, address_state address_zip`)
- Use `text-muted-foreground text-sm` styling with icon + text inline, separated by dividers
- This is read-only display; the Edit button already exists and opens the edit form in the Details tab

### File: `src/components/contact-profile/ContactDetailsTab.tsx`
- **Lines 686-754**: Remove the duplicate read-only display of Full Name, Phone, and Address from the "Contact Information" card's non-editing view, since they now appear in the header
- Keep the "Contact Information" card but only show it when editing, or keep it for secondary fields (company, tags, notes, additional emails/phones) that don't fit in the compact header bar
- The Quick Stats row (Lead Score, Created, Source, Status, Total Jobs) stays in the Details tab as-is

### No new files or dependencies needed.

