

# Plan: Fix Formula Evaluation to Support Compound Measurement Keys

## Problem Identified

The console logs reveal the exact error:

```
Failed to evaluate formula: {{ ceil(lf.ridge_hip / 100) }} 
SyntaxError: Numeric separators are not allowed at the end of numeric literals
```

**Root Cause:** Template formulas use compound measurement keys that don't exist in the measurement context:

| Formula Key | Missing? | Should Be |
|-------------|----------|-----------|
| `lf.ridge_hip` | ❌ Not defined | `lf.ridge + lf.hip` |
| `lf.eave_rake` | ❌ Not defined | `lf.eave + lf.rake` |

When `evaluateFormula()` tries to replace these keys, they remain as-is (e.g., `lf.ridge_hip` stays in the expression). JavaScript then interprets the underscores as "numeric separators" (a valid JS syntax like `1_000`), but `ridge_hip` isn't a number, causing the syntax error. The function catches this and returns 0, which is why Starter Shingle, Ridge Cap, and Drip Edge all show 0.

---

## Solution

Add compound convenience keys to the `evaluateFormula` function's `flatCtx` object:

```typescript
const flatCtx: Record<string, number> = {
  // ... existing keys ...
  'lf.eave': ctx.lf.eave,
  'lf.rake': ctx.lf.rake,
  'lf.ridge': ctx.lf.ridge,
  'lf.hip': ctx.lf.hip,
  'lf.valley': ctx.lf.valley,
  'lf.step': ctx.lf.step,
  
  // NEW: Add compound convenience keys
  'lf.ridge_hip': ctx.lf.ridge + ctx.lf.hip,        // Total ridge + hip
  'lf.eave_rake': ctx.lf.eave + ctx.lf.rake,        // Total drip edge perimeter
  'lf.perimeter': ctx.lf.eave + ctx.lf.rake,        // Alias for drip edge
};
```

---

## Files to Modify

| File | Change |
|------|--------|
| `src/hooks/useMeasurementContext.ts` | Add compound keys (`lf.ridge_hip`, `lf.eave_rake`, `lf.perimeter`) to `flatCtx` in `evaluateFormula()` |

---

## Technical Details

### `src/hooks/useMeasurementContext.ts` - evaluateFormula function (lines 179-195)

**Current Code:**
```typescript
const flatCtx: Record<string, number> = {
  'roof.squares': ctx.roof.squares,
  'roof.total_sqft': ctx.roof.total_sqft,
  'waste.10pct.squares': ctx.waste['10pct'].squares,
  'waste.10pct.sqft': ctx.waste['10pct'].sqft,
  'waste.12pct.squares': ctx.waste['12pct'].squares,
  'waste.12pct.sqft': ctx.waste['12pct'].sqft,
  'waste.15pct.squares': ctx.waste['15pct'].squares,
  'waste.15pct.sqft': ctx.waste['15pct'].sqft,
  'lf.eave': ctx.lf.eave,
  'lf.rake': ctx.lf.rake,
  'lf.ridge': ctx.lf.ridge,
  'lf.hip': ctx.lf.hip,
  'lf.valley': ctx.lf.valley,
  'lf.step': ctx.lf.step,
  'pen.pipe_vent': ctx.pen.pipe_vent,
};
```

**Updated Code:**
```typescript
const flatCtx: Record<string, number> = {
  'roof.squares': ctx.roof.squares,
  'roof.total_sqft': ctx.roof.total_sqft,
  'waste.10pct.squares': ctx.waste['10pct'].squares,
  'waste.10pct.sqft': ctx.waste['10pct'].sqft,
  'waste.12pct.squares': ctx.waste['12pct'].squares,
  'waste.12pct.sqft': ctx.waste['12pct'].sqft,
  'waste.15pct.squares': ctx.waste['15pct'].squares,
  'waste.15pct.sqft': ctx.waste['15pct'].sqft,
  'lf.eave': ctx.lf.eave,
  'lf.rake': ctx.lf.rake,
  'lf.ridge': ctx.lf.ridge,
  'lf.hip': ctx.lf.hip,
  'lf.valley': ctx.lf.valley,
  'lf.step': ctx.lf.step,
  'pen.pipe_vent': ctx.pen.pipe_vent,
  // Compound convenience keys for common calculations
  'lf.ridge_hip': ctx.lf.ridge + ctx.lf.hip,    // Ridge cap coverage
  'lf.eave_rake': ctx.lf.eave + ctx.lf.rake,    // Drip edge perimeter
  'lf.perimeter': ctx.lf.eave + ctx.lf.rake,    // Alias for drip edge
};
```

---

## Expected Results After Fix

With saved measurements (Ridge: 42 ft, Hip: 102 ft, Eave: 224.33 ft, Rake: 0 ft):

| Item | Formula | Before | After |
|------|---------|--------|-------|
| OC Starter Shingle | `{{ ceil(lf.ridge_hip / 100) }}` | 0 (error) | ceil(144/100) = **2 BDL** |
| OC DecoRidge Ridge Cap | `{{ ceil((lf.ridge_hip / 25) * 1.05) }}` | 0 (error) | ceil((144/25)*1.05) = **7 BDL** |
| Drip Edge | `{{ ceil(lf.eave_rake / 10) }}` | 0 (error) | ceil(224.33/10) = **23 EA** |

---

## Verification

After applying the fix:
1. Navigate to the estimate page for lead `108ed900-a9cf-4cf5-bf8e-5deb6fbfd32a`
2. Select the "Owens Corning Duration" template
3. Verify line items now show correct quantities based on saved measurements

