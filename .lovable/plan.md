

## Fix: Mobile Header Layout and Usability

### Problems Identified

From the screenshot, three issues make the app unusable on mobile:

1. **Search bar is too narrow** -- squeezed between the hamburger menu (pl-14) and the notification + company switcher buttons, leaving barely any room. The search dropdown is equally narrow, truncating all results to "Contac..."
2. **No location switcher accessible** -- it's buried inside the sidebar drawer, requiring two taps to reach. No quick way to change locations from the main view.
3. **Header is overcrowded** -- all controls (search, notifications, company switcher) compete for a single 14px-high row on mobile.

### Solution

Restructure the mobile header into **two rows** and make the search dropdown full-width on mobile:

```text
Row 1: [hamburger] [Location Badge] [spacer] [Notification] [Company]
Row 2: [========== Full-width Search Bar ==========]
```

### Changes

#### 1. GlobalLayout.tsx -- Two-row mobile header

Split the mobile header into two rows:
- **Top row**: Menu button space, location indicator, notification bell, company switcher
- **Bottom row**: Full-width search bar spanning the entire width

On desktop, keep the current single-row layout unchanged.

#### 2. CLJSearchBar.tsx -- Full-width dropdown on mobile

Change the search dropdown from inheriting the input width to being **fixed to viewport edges** on mobile:
- Use `fixed left-3 right-3` positioning on mobile so the dropdown spans nearly the full screen width
- Keep the current `absolute` positioning on desktop
- This ensures search results are readable and tappable

#### 3. Add QuickLocationSwitcher to mobile header

Import and render the `QuickLocationSwitcher` component in the top row of the mobile header so users can change locations without opening the sidebar drawer.

---

### Technical Details

**File: `src/shared/components/layout/GlobalLayout.tsx`**

Restructure the header for mobile into two stacked rows:
- Row 1: Location switcher (compact), notification center, company switcher
- Row 2: Full-width CLJSearchBar
- Desktop remains a single row (no visual change)

**File: `src/components/CLJSearchBar.tsx`**

Update the dropdown container (line 164) to use fixed positioning on mobile:
```
className="fixed left-3 right-3 top-[7.5rem] md:absolute md:top-full md:left-0 md:right-0 mt-1 bg-popover border rounded-md shadow-lg z-[60] max-h-[60vh] md:max-h-[400px] overflow-y-auto"
```

This makes the dropdown nearly full-screen-width on phones while keeping desktop behavior identical.

**Files to modify:**
| File | Change |
|------|--------|
| `src/shared/components/layout/GlobalLayout.tsx` | Two-row mobile header with location switcher |
| `src/components/CLJSearchBar.tsx` | Full-width fixed dropdown on mobile |

