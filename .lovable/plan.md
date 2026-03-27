

## Plan: Show Recent Searches on Focus

### What changes

When a user clicks into the global search bar (`CLJSearchBar`) without typing anything, display their recent searches instead of an empty state.

### How it works

1. **Store recent searches in localStorage** — When a user selects a search result, save it (entity name, type, id, subtext) to a `recent-searches` key in localStorage. Keep the last 5 unique entries (deduplicated by `entity_id`).

2. **Show recents on focus** — When the input is focused and `searchTerm` is empty, open the dropdown and display the recent searches under a "Recent" heading with a clock icon. Each item renders identically to normal search results (same badges, icons, routing).

3. **Clear recents option** — Add a small "Clear" button in the "Recent" group heading so users can wipe their history.

### File to modify

| File | Change |
|------|--------|
| `src/components/CLJSearchBar.tsx` | Add localStorage read/write for recent searches, show on focus when empty, clear button |

### Technical details

- localStorage key: `pitch-recent-searches` (JSON array of `SearchResult` objects, max 5)
- On `handleSelect`: prepend selected result to recents, dedupe by `entity_id`, trim to 5
- On `onFocus`: if `searchTerm` is empty, load recents from localStorage and show dropdown with "Recent" group
- "Clear" button calls `localStorage.removeItem` and closes dropdown
- No database changes needed — purely client-side

