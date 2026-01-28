
# Plan: Fix Measurement Formula Evaluation Order Bug

## Problem Identified

The measurement context formula evaluation has a critical bug causing template line items to calculate as 0 when they use compound keys like `lf.ridge_hip`.

### Root Cause

In `evaluateFormula()` within `src/hooks/useMeasurementContext.ts`, the key replacement happens in object insertion order. When a formula like `{{ ceil(lf.ridge_hip / 100) }}` is evaluated:

1. `lf.ridge` (value: 42) is replaced first → expression becomes `ceil(42_hip / 100)`
2. `lf.hip` (value: 102) doesn't match `_hip` → no change
3. `lf.ridge_hip` doesn't match `42_hip` → no change
4. Final expression `ceil(42_hip / 100)` is invalid JavaScript → throws error → returns 0

### Evidence from User's Data

- Saved measurements: `lf.ridge: 42`, `lf.hip: 102`
- Formula: `{{ ceil(lf.ridge_hip / 100) }}`
- Expected: `ceil((42 + 102) / 100)` = `ceil(1.44)` = 2 BDL
- Actual: 0 BDL (shown in screenshot)

---

## Solution

Sort the replacement keys by length (longest first) before performing string replacements. This ensures compound keys like `lf.ridge_hip` are replaced before their partial matches like `lf.ridge`.

---

## File to Modify

| File | Change |
|------|--------|
| `src/hooks/useMeasurementContext.ts` | Sort keys by length descending before replacement loop |

---

## Technical Implementation

### Current Code (lines 201-206)
```typescript
// Replace dot notation with values
let evalExpr = expression;
for (const [key, value] of Object.entries(flatCtx)) {
  const escapedKey = key.replace(/\./g, '\\.');
  evalExpr = evalExpr.replace(new RegExp(escapedKey, 'g'), String(value));
}
```

### Fixed Code
```typescript
// Replace dot notation with values
// CRITICAL: Sort by key length descending to replace longer keys first
// This prevents 'lf.ridge' from partially matching within 'lf.ridge_hip'
let evalExpr = expression;
const sortedEntries = Object.entries(flatCtx).sort(
  ([a], [b]) => b.length - a.length
);
for (const [key, value] of sortedEntries) {
  const escapedKey = key.replace(/\./g, '\\.');
  evalExpr = evalExpr.replace(new RegExp(escapedKey, 'g'), String(value));
}
```

---

## Expected Results

After the fix, the OC Starter Shingle formula will evaluate correctly:

| Before Fix | After Fix |
|------------|-----------|
| Formula: `ceil(lf.ridge_hip / 100)` | Same |
| Step 1: `lf.ridge` replaced first → `ceil(42_hip / 100)` (BROKEN) | Step 1: `lf.ridge_hip` replaced first → `ceil(144 / 100)` |
| Step 2: Invalid expression → error → 0 | Step 2: `ceil(1.44)` → 2 |
| **Result: 0 BDL** | **Result: 2 BDL** |

### All Affected Items Now Working

| Item | Formula | Result |
|------|---------|--------|
| OC Starter Shingle | `lf.ridge_hip / 100` | 2 BDL (was 0) |
| OC DecoRidge Ridge Cap | `lf.ridge_hip / 25 * 1.05` | 7 BDL (was 0) |
| Drip Edge | `lf.ridge_hip / 10 * 1.10` | 16 EA (was 0) |
| Any formula using `lf.eave_rake` or `lf.perimeter` | Fixed |

---

## Summary

| What | Details |
|------|---------|
| Bug | Shorter keys replaced before longer keys, corrupting compound keys |
| Fix | Sort replacement keys by length (longest first) |
| Impact | All formulas using compound keys (`lf.ridge_hip`, `lf.eave_rake`, `lf.perimeter`) now work |
| Files Changed | 1 file, ~3 lines of code |
