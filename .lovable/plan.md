

# Fix Mobile Menu Button Positioning

## Problem

The mobile hamburger menu button is positioned at `top-3` (12px from the top of the viewport), which places it directly under the iOS status bar / safe area. On devices with notches or dynamic islands, this makes the button unreachable or very difficult to tap.

## Solution

Move the menu button down to respect the safe area and align it with the header row. Two changes needed:

### File: `src/components/ui/collapsible-sidebar.tsx` (line 48)

Change the button class from `fixed top-3 left-3` to use safe-area-aware positioning. Since the GlobalLayout header row starts after `pt-14` (56px), and the first header row is `h-12`, the menu button should sit vertically centered with that first row.

- Change `top-3` to `top-[3.75rem]` (60px) so it aligns with the header content row (which starts at `pt-14` = 56px)
- This positions the button inside the header area, not behind the status bar

### File: `src/shared/components/layout/GlobalLayout.tsx` (line 25)

Adjust the mobile top padding from `pt-14` to `pt-0` since the button will now sit inside the sticky header, not above it. The `pl-14` on the header row already reserves space for the button.

Alternatively (simpler approach): just move the button from `top-3` to `top-[env(safe-area-inset-top,0px)_+_12px]` or simply use a larger top value like `top-[3.5rem]` that clears the status bar on all devices, keeping the existing `pt-14` padding intact.

**Simplest fix:** Change the button's `top-3` to `top-[3.6rem]` so it vertically centers with the sticky header's first row (which has `pl-14` already reserving the left space for it). No other files need changes.
