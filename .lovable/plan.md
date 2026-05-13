# Remove "AI Corrections" tab from Integrations Settings

## Problem
- Settings → Integrations has an **AI Corrections** tab that renders `MeasurementCorrectionsLog`. It shows empty stat cards (Total Corrections 0, Avg Change 0.0%, Most Corrected N/A) and "No corrections recorded yet" — not useful in its current state.
- The stat cards visually overlap the wrapped tab row above them (the TabsList uses `flex-wrap` and wraps onto a second line, which sits behind the cards).
- Removing the tab eliminates both issues at once. The underlying `roof_measurement_corrections` table and any other consumers are left untouched.

## Changes

**`src/components/settings/IntegrationsSettings.tsx`**
- Remove the `MeasurementCorrectionsLog` import (line 6).
- Remove the `Ruler` icon from the lucide-react import (line 15) — no longer used.
- Remove the `<TabsTrigger value="measurement-corrections">…AI Corrections</TabsTrigger>` block (lines 77–80).
- Remove the matching `<TabsContent value="measurement-corrections">…</TabsContent>` block (lines 131–133).

**`src/components/settings/MeasurementCorrectionsLog.tsx`**
- Delete the file (no other references in the codebase — verified via ripgrep, only `IntegrationsSettings.tsx` imports it).

## Out of scope
- No DB changes. The `roof_measurement_corrections` table stays as-is in case it's used by the measurement pipeline elsewhere.
- No other tabs are touched. Wrapping behavior of the remaining tabs stays the same but with one fewer trigger, reducing the chance of layout overflow.
