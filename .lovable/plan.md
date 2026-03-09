

# 3D UI Refresh Plan

## Goal
Add depth, glass morphism, and elevated visual effects across the application to create a modern, premium 3D appearance. Changes will be CSS/component-level only -- no backend or database changes.

## Approach
Layer subtle 3D effects using CSS techniques: `backdrop-blur`, layered `box-shadow`, subtle gradients for lighting simulation, and `perspective`/`transform` for depth cues. No heavy 3D libraries needed.

## Changes

### 1. Global Design Tokens (`src/index.css`)
Add new CSS variables for 3D depth system:
- `--shadow-3d`: Multi-layer shadow simulating elevation (e.g., `0 1px 2px rgba(...), 0 4px 8px rgba(...), 0 8px 24px rgba(...)`)
- `--shadow-3d-hover`: Intensified version for hover states
- `--glass-bg`: `rgba(255,255,255,0.7)` with `backdrop-filter: blur(12px)`
- `--glass-border`: `rgba(255,255,255,0.2)` for frosted edge
- New utility classes: `.glass`, `.elevated`, `.elevated-hover`, `.depth-card`

### 2. Card Component (`src/components/ui/card.tsx`)
- Add new variant `"elevated"` with multi-layer 3D shadow, subtle top-border highlight (1px white/10% for light edge simulation)
- Add variant `"glass"` with backdrop-blur, semi-transparent background, frosted border
- Default cards get slightly enhanced shadow stack

### 3. Login Page (`src/pages/Login.tsx`)
- Card gets glass morphism treatment: `bg-white/80 backdrop-blur-xl border-white/20`
- Add subtle animated gradient orbs in background behind the card (CSS-only using `::before`/`::after` pseudo-elements with blur)
- "PITCH" heading gets text-shadow for depth
- Input fields get inset shadow for "pressed in" 3D look
- Sign-in button gets gradient + layered shadow for "raised button" effect

### 4. Sidebar (`src/components/ui/collapsible-sidebar.tsx`)
- Add subtle inner shadow on the right edge for depth
- Desktop sidebar gets `shadow-3d` instead of `shadow-soft`
- Toggle button gets elevated pill style with layered shadow

### 5. Header Bar (`src/shared/components/layout/GlobalLayout.tsx`)
- Top bar gets glass morphism: `bg-background/70 backdrop-blur-xl` with subtle bottom shadow
- Adds floating appearance over content

### 6. MetricCard (`src/components/dashboard/MetricCard.tsx`)
- Icon container gets gradient background + inner shadow for "embossed" look
- Card gets `elevated` variant with hover lift effect (translateY + shadow increase)
- Count number gets subtle text-shadow

### 7. Button Component (`src/components/ui/button.tsx`)
- Default variant gets layered shadow: light top highlight + bottom shadow for "raised" 3D button
- Hover intensifies shadow; active presses down (translateY(1px) + reduced shadow)
- Add `"elevated"` variant with pronounced 3D effect

## Technical Details

All effects use standard CSS properties (no JS animation libraries needed):
- `box-shadow` with multiple layers for realistic depth
- `backdrop-filter: blur()` for glass morphism
- `border-top: 1px solid rgba(255,255,255,0.1)` for light-edge simulation
- `transform: translateY()` for press/lift effects
- `transition` for smooth state changes

Dark mode variants will use adjusted opacity and color values in the `.dark` selector block.

## Files Modified
| File | Change |
|---|---|
| `src/index.css` | Add 3D depth variables, glass/elevated utility classes |
| `src/components/ui/card.tsx` | Add `elevated` and `glass` variants |
| `src/components/ui/button.tsx` | Add `elevated` variant, enhance default shadow |
| `src/pages/Login.tsx` | Glass card, gradient orb background, 3D inputs/buttons |
| `src/components/ui/collapsible-sidebar.tsx` | Enhanced depth shadow |
| `src/shared/components/layout/GlobalLayout.tsx` | Glass morphism header |
| `src/components/dashboard/MetricCard.tsx` | Embossed icon, elevated card |

