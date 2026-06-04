# Blueprint Importer v2 — Estimate Mapping Contract

**Status:** Phase 0 contract doc. No DB, no code, no endpoint behavior changes.
**Scope:** Defines how accepted trades + extracted measurements turn into material lists, labor pricing, and CRM estimate line items. Establishes the provenance and review-gate contract that every downstream component must honor.

This document is the source of truth for Phase 4 (assembly + generator) and Phase 7 (CRM handoff). It does **not** ship code.

---

## 1. Object lifecycle

```
ImporterProject
   └─ ImporterDocument*           (uploaded files, classified by type)
        └─ DetectedTrade*         (per-trade detection result with confidence)
             ├─ TradeMeasurement* (typed quantities with source provenance)
             ├─ TradeSpecification* (non-quantity requirements — product, finish level, etc.)
             ├─ AcceptedTrade?    (created when user accepts; references AssemblyTemplate)
             │     ├─ MaterialList         (deterministic, generated from MaterialRules)
             │     ├─ LaborList            (deterministic, generated from LaborRules)
             │     └─ PlanPath              (provenance chain)
             └─ ReviewFlag*       (blocks auto-populate until resolved)
```

Every object below the `AcceptedTrade` line is **deterministic and reproducible** from its inputs. No AI is permitted in the math path. AI may only participate in document classification and trade detection (Phase 2).

---

## 2. AssemblyTemplate contract

An `AssemblyTemplate` is the company-configurable recipe that turns measurements + specifications into material and labor line items.

```ts
interface AssemblyTemplate {
  template_id: string;          // tenant-scoped uuid
  tenant_id: string;
  trade_id: TradeId;            // must match catalog (mvp_supported only)
  name: string;                 // e.g. "Asphalt Shingle Roof Replacement"
  version: number;
  status: 'draft' | 'active' | 'archived';

  required_measurements: MeasurementKey[];   // must all be present on AcceptedTrade
  required_specifications: SpecKey[];        // must all be answered (no defaults)
  default_waste_percent: number;             // applied unless source supplies a waste table
  material_rule_ids: string[];               // ordered
  labor_rule_ids: string[];                  // ordered
  applies_when?: TemplateApplicabilityRule;  // optional — e.g. "only when pitch >= 4/12"
}
```

Templates are tenant-scoped. The importer never invents a template; if no `active` template exists for a trade, the trade cannot auto-populate and the user is prompted to pick or create one.

---

## 3. MaterialRule contract

```ts
interface MaterialRule {
  rule_id: string;
  tenant_id: string;
  trade_id: TradeId;
  template_id: string;

  catalog_item_id: string;       // must resolve to a tenant material catalog row
  description: string;           // human-readable, e.g. "Architectural shingles"
  unit: string;                  // bundle, roll, piece, sheet, lf, sqft
  coverage_per_unit?: number;    // e.g. 33.3 sqft/bundle for 3-tab; required for area-driven rules
  inputs: MeasurementKey[];      // declarative inputs the formula consumes
  waste_source: 'measurement_source' | 'template_default' | 'user_input';
  formula: MaterialFormula;      // see §3.1
  rounding: 'ceil' | 'round' | 'floor';
  min_quantity?: number;
}
```

### 3.1 Allowed formulas

Formulas are restricted to a small set of pure expressions evaluated server-side. Free-form code is not permitted.

| Formula kind | Shape | Example use |
|---|---|---|
| `area_with_waste` | `(area_sqft * (1 + waste_percent)) / coverage_per_unit` | Shingles, underlayment, ice & water |
| `length` | `length_lf / coverage_per_unit` | Drip edge (sheets), starter strip (bundles via LF/bundle), gutter runs |
| `length_sum` | `(length_a_lf + length_b_lf) / coverage_per_unit` | Eaves + rakes → starter; hips + ridges → cap |
| `count` | `count * multiplier` | Pipe boots, downspouts, accessories |
| `derived_area` | `(area_a − area_b) * (1 + waste_percent) / coverage_per_unit` | Net paintable area = gross wall − window/door |

Every formula must list its `inputs` explicitly. The generator validates that every input is present on the `AcceptedTrade` before evaluating; missing inputs raise a `ReviewFlag` instead of silently defaulting to zero.

### 3.2 Waste handling

1. If the measurement source supplied a `waste_table`, the user picks a row; `waste_percent` is sourced from there with `waste_source='measurement_source'`.
2. Otherwise the template's `default_waste_percent` is used with `waste_source='template_default'` and a `waste_factor_defaulted` review flag is attached to the AcceptedTrade.
3. The user may override; this flips `waste_source='user_input'` and clears the flag.

Waste is never applied to LF-only formulas unless the rule explicitly opts in via a `length_with_waste` formula variant. (Reserved for future addition; not in MVP set above.)

---

## 4. LaborRule contract

```ts
interface LaborRule {
  rule_id: string;
  tenant_id: string;
  trade_id: TradeId;
  template_id: string;

  description: string;           // "Install architectural shingles"
  unit: 'SQ' | 'LF' | 'EA' | 'SQFT' | 'HR';
  inputs: MeasurementKey[];
  base_quantity_formula: LaborFormula;
  base_rate: number;             // tenant currency per unit
  complexity_multipliers: ComplexityMultiplier[];  // see §4.1
}
```

Labor totals are computed as:

```
quantity = base_quantity_formula(inputs)
adjusted_rate = base_rate * product(complexity_multipliers)
line_total = quantity * adjusted_rate
```

### 4.1 Complexity multipliers

Multipliers are declarative — never hand-coded per estimate.

| Multiplier key | Driven by | Example |
|---|---|---|
| `pitch_multiplier` | `predominant_pitch` band (e.g. 6/12=1.0, 9/12=1.15, 12/12=1.35) | Roofing labor |
| `story_multiplier` | `building_stories` (1=1.0, 2=1.10, 3+=1.25) | Roofing, siding, gutter |
| `facet_complexity_multiplier` | `facet_count` band | Roofing |
| `access_difficulty_multiplier` | User-answered review answer | All trades |
| `tear_off_layers_multiplier` | `tear_off_layers` (0=0.0, 1=1.0, 2=1.20, 3+=1.40) | Roofing tear-off only |
| `wall_height_multiplier` | `max_wall_height_ft` band | Siding, paint, gutter |
| `elevation_complexity_multiplier` | `wall_facet_count` band | Siding, paint |

Templates declare which multipliers apply to which labor rules; defaults are tenant-configurable. If a multiplier driver is unknown, the generator attaches a `complexity_driver_unknown` review flag and assumes 1.0 with an explicit note in the PlanPath.

---

## 5. PlanPath provenance contract

Every generated material and labor line item must be traceable back to the source document(s), page(s), and labels that produced it. No quantity may exist in a generated list without a corresponding PlanPath entry.

```ts
interface PlanPath {
  accepted_trade_id: string;
  steps: PlanPathStep[];
}

interface PlanPathStep {
  step_index: number;
  step_kind: 'source_document' | 'measurement_extracted' | 'specification_extracted'
           | 'template_applied' | 'waste_applied' | 'rule_evaluated'
           | 'review_flag' | 'user_override';
  label: string;                         // human-readable
  source?: {
    document_id?: string;
    document_type?: string;
    page?: number;
    label_in_document?: string;
  };
  payload?: Record<string, unknown>;     // formula inputs, rule_id, applied_value, etc.
}
```

The PlanPath is rendered in the UI as the "Plans Path" panel described in the product brief. It is persisted alongside the AcceptedTrade and copied into the CRM estimate as a structured note + JSON blob on the estimate row. **Deleting a PlanPath when its AcceptedTrade is pushed to an estimate is forbidden** — audit trail is permanent.

---

## 6. Review-flag contract

Review flags block actions, they do not silently degrade output. The generator must enforce:

| Action | Blocked when |
|---|---|
| `populate_material_list` | Any required measurement missing **or** any required specification unanswered. |
| `generate_labor_pricing` | Material list not yet populated **or** any complexity-driver review flag unresolved that the template marks as `block_labor=true`. |
| `push_to_crm_estimate` | Any unresolved review flag on the AcceptedTrade marked `block_estimate=true`. |

Flags are typed (`shingle_brand_unselected`, `waste_factor_defaulted`, `wall_height_assumed`, etc. — see `blueprint-trade-catalog.md` §3). The UI renders them as a checklist with resolution actions.

Auto-resolution is forbidden. A flag clears only on explicit user input or when the user selects a template that supplies the missing value as a default.

---

## 7. Catalog and pricing resolution

Material rules reference `catalog_item_id` in the tenant material catalog. Resolution rules:

1. If the catalog item exists and has a price, the generator pulls unit cost from the catalog.
2. If the catalog item exists with no price, the generator emits a `catalog_price_missing` review flag (blocks `push_to_crm_estimate`).
3. If the `catalog_item_id` does not resolve, the generator emits a `catalog_item_unresolved` flag and the rule is excluded from the material list (but listed in the review panel).

The importer never invents a catalog item and never picks one heuristically from product descriptions.

---

## 8. Measurement-to-input mapping per MVP trade

Canonical mapping from typed `TradeMeasurement` objects to the input keys that material/labor rules consume.

### 8.1 Roofing

| Rule input key | Source measurement | Notes |
|---|---|---|
| `roof_area_sqft` | `roofing.roof_area_sqft` | Required |
| `pitched_area_sqft` | `roofing.pitched_area_sqft` ?? `roof_area_sqft` | |
| `predominant_pitch` | `roofing.predominant_pitch` | Required, drives `pitch_multiplier` |
| `eaves_lf`, `rakes_lf` | direct | Required |
| `valleys_lf`, `hips_lf`, `ridges_lf` | direct | Required |
| `step_flashing_lf`, `wall_flashing_lf` | direct | Optional, 0 default with review flag |
| `penetration_count` | direct ?? 0 | Optional |
| `building_stories` | user-answered | Drives `story_multiplier` |
| `tear_off_layers` | user-answered | Drives `tear_off_layers_multiplier` |

### 8.2 Exterior Walls / Siding

| Rule input key | Source measurement |
|---|---|
| `gross_wall_area_sqft` | `walls.gross_wall_area_sqft` |
| `window_door_area_sqft` | `walls.window_door_area_sqft` |
| `net_wall_area_sqft` | derived = gross − window/door |
| `window_door_perimeter_lf` | direct |
| `outside_corners_lf` | direct or `outside_corners_count * avg_wall_height` |
| `inside_corners_lf` | same pattern |
| `wall_facet_count` | direct | drives `elevation_complexity_multiplier` |
| `max_wall_height_ft` | direct or user-answered (review flag if assumed) |

### 8.3 Paint / Coatings

| Rule input key | Source |
|---|---|
| `paintable_area_sqft` | gross or net per template choice (user must pick if template is ambiguous) |
| `coats_count` | template or user-answered (no default) |
| `primer_required` | template or user-answered |

Paint never extracts its own measurements. Paint cannot be accepted unless `exterior_walls_siding` is also accepted (or, future phase, drywall).

### 8.4 Gutters / Fascia / Trim

| Rule input key | Source |
|---|---|
| `eaves_lf` | from roof report or wall report |
| `fascia_lf` | direct or fallback to `eaves_lf` with `fascia_assumed_equal_to_eaves` flag |
| `rakes_lf` | direct (used for rake-trim rules) |
| `downspout_count` | template formula from `wall_facet_count` or user-answered |
| `outside_corners_count`, `inside_corners_count` | direct |

---

## 9. CRM estimate handoff contract

When the user pushes an `AcceptedTrade` to a CRM estimate:

1. The generator MUST write to existing `estimates` + `estimate_line_items` tables. No shadow estimate table.
2. Each material line and labor line becomes one `estimate_line_items` row, preserving:
   - `quantity`, `unit`, `unit_cost`, `unit_price` (per existing engine standards — see `mem://features/estimates-and-materials/engine-standards`),
   - `line_total` recalculated by the existing engine (never hand-set).
3. The PlanPath JSON is written to a new `estimate_line_items.source_plan_path` JSON column (Phase 1 DB work) keyed by `accepted_trade_id`.
4. The AcceptedTrade row is marked `pushed_to_estimate_id=<estimate_id>` and becomes read-only. Re-running the importer creates a new `AcceptedTrade` and a new estimate version — the old one is preserved.
5. Tenant scoping uses `useEffectiveTenantId()` on read and explicit `.eq('tenant_id', tenant_id)` on write (per core memory).
6. Commission persistence and `selling_price` rules from the existing estimate engine are not overridden by the importer.

---

## 10. Determinism + audit invariants

The following invariants are non-negotiable and will be enforced by Phase 8 regression tests:

1. **Reproducibility:** Re-running the generator with identical inputs produces byte-identical material and labor lists.
2. **Provenance completeness:** Every line item has a non-empty PlanPath with at least one `source_document` step and one `rule_evaluated` step.
3. **No silent zeros:** A missing required input produces a review flag, never a zero quantity.
4. **No silent defaults on critical fields:** Waste factor, shingle brand, paint coats, gutter profile, wall height — every default emits a review flag.
5. **No catalog invention:** Every `catalog_item_id` resolves to an existing tenant catalog row or surfaces a flag.
6. **No AI in math:** The generator path (templates, rules, formulas, multipliers, totals) is pure deterministic code. AI is confined to classification + detection.
7. **Immutability after push:** Once an AcceptedTrade is pushed to an estimate, its inputs, rules, and PlanPath are frozen.

---

## 11. Non-goals (Phase 3)

- No live wiring into estimates (Phase 7).
- No DB tables created in this phase (Phase 1).
- No worker code (Phase 4).
- No blueprint sheet intelligence (Phase 4+, drywall/framing path).
- No automatic product-to-catalog matching by description.
- No labor-rate inference from historical data (manual templates only at MVP).
