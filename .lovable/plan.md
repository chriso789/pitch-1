

# Two Issues: Duplicate Contacts in Search & PDF Item Organization

## Issue 1: Two "Mike Stipp" Contact Records

**Root cause**: This is a **data issue**, not a code bug. The database contains two separate contact records for "Mike Stipp":
- One with address "1931 Beach Road"
- One with address "1931 Beach Rd., Englewood, FL 34223 US"

The unique index (`idx_contacts_unique_name_address`) normalizes street suffixes (e.g., "Road" → "rd"), but these records likely have different `address_street` values that still pass the normalization check (e.g., one stores just the street, the other stores the full address line). The search function correctly returns both because they are genuinely two records.

**Fix**: Merge the duplicate contact records in the database. The `reconcile-contacts` edge function can handle this. Additionally, tighten the deduplication logic to normalize "Road" and "Rd." to the same value and strip city/state/zip from the street field if present.

### Changes
- Create a migration to merge the duplicate Mike Stipp records (move pipeline entries, tasks, documents to the older record, then soft-delete the newer one)
- Update the `normalize_street` SQL function to also handle cases where city/state/zip are appended to the street field (strip everything after a comma pattern like ", City, ST ZIP")

---

## Issue 2: PDF Line Items Not Matching Edit View Layout

**Root cause**: The PDF's `chunkItems` function (line 131) splits the flat combined item list across pages, then each page's `ItemsTable` re-groups by trade and item_type. This works, but when items get split across page boundaries, the material/labor grouping breaks — you get some materials on page 1 and remaining materials on page 2, each with their own sub-header. The edit estimate view (`SectionedLineItemsTable`) shows everything on one scrollable page with clean trade → materials/labor hierarchy.

**Fix**: Instead of chunking the flat item list and re-grouping per page, pre-group items by trade → material/labor FIRST, then paginate the grouped structure. This ensures materials and labor sections stay intact and page breaks happen between logical groups rather than mid-group.

### Changes

| File | Change |
|------|--------|
| `src/components/estimates/EstimatePDFDocument.tsx` | Refactor `chunkItems` to be group-aware: pre-build the trade→material/labor hierarchy, then paginate groups as units. Only split a group across pages when it exceeds a full page. |
| New migration | Merge duplicate "Mike Stipp" contact records; update `normalize_street` to strip trailing city/state/zip from street fields |

### Technical Detail

The new chunking approach:
1. Pre-sort items into groups: `[{ trade, materials: [...], labor: [...] }]`
2. Calculate row count per group (including sub-headers)
3. Fill pages group-by-group; only split a group when it alone exceeds page capacity
4. Each page chunk becomes a list of "render blocks" (trade header, sub-header, items) rather than flat items

This matches the edit view's visual hierarchy: Trade Header → Materials sub-header → material items → Labor sub-header → labor items.

