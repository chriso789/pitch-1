

# Fix Mobile Menu Button Position

## Problem
The hamburger menu button is positioned too high on mobile (`top-[3.6rem]`), sitting above the header content with visible gap between it and the location switcher row.

## Fix

### File: `src/components/ui/collapsible-sidebar.tsx`
Change the menu button position from `top-[3.6rem]` to a value that vertically centers it within the first header row:

- The main content area has `pt-14` (3.5rem) top padding
- The sticky header sits at the top of that padded area
- The first header row is `h-12` (3rem) tall
- To center the `h-10` (2.5rem) button within that row, the top position should be approximately `top-[4.05rem]` (halfway through the row minus half the button height)

This single CSS change moves the button down so it visually aligns with the "West Coast" location switcher row instead of floating alone near the status bar.

| File | Change |
|------|--------|
| `src/components/ui/collapsible-sidebar.tsx` | Change `top-[3.6rem]` to `top-[4.05rem]` on the mobile menu button |
