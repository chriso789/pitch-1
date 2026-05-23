# Add Skill: Roof Measurement Vision QA & Geometry Contract

## Goal

Install a new Lovable Skill that forces the agent to reason as a computer vision + roof geometry QA engineer before writing any code that touches the AI Measurement pipeline. The skill encodes the "do no harm" perimeter rule, structural evidence preservation, typed roof_lines contract, customer-report gate, required diagnostics, and the Fonsica regression checklist.

## Where it lives

Draft at `.agents/skills/roof-measurement-vision-qa/` and apply via `skills--apply_draft`, which activates it under `.workspace/skills/` so it gets surfaced by retrieval on any measurement-pipeline task.

## Files to create

```
.agents/skills/roof-measurement-vision-qa/
├── SKILL.md                                  # entry point + hard rules
└── references/
    ├── perimeter-do-no-harm.md               # Rules 1, 4, 5 + Fonsica example
    ├── structural-evidence-and-topology.md   # Rules 6, 7, 8 (backbone/repair)
    ├── roof-lines-and-pitch-contract.md      # Rules 3, 9, 10, 11
    ├── required-diagnostics.md               # phase3_5 / 3C / 3D / 3E + route_provenance schema
    ├── visual-qa-overlay.md                  # Diagnostic overlay spec when topology blocked
    └── fonsica-regression-checklist.md       # 8 fail conditions + expected safe behavior
```

## SKILL.md shape

- Frontmatter
  - `name: roof-measurement-vision-qa`
  - `description:` triggers on AI Measurement pipeline work, perimeter refinement, DSM/mask/Solar fusion, ridge/valley/hip topology, geometry contracts, Fonsica reruns, customer report gating
- Body
  - Role (CV + geospatial + roofing QA specialist)
  - Primary Objective (the canonical workflow: confirmed target → mask → true perimeter → eave/rake → conservative refinement → DSM/Solar evidence → topology → typed roof_lines → pitch → customer report)
  - Hard Rules 1–11 in condensed form (full detail lives in references)
  - "Before writing code" checklist: read the relevant reference file, restate the rule being honored, identify which phase block + diagnostics will be written
  - Pointers to each reference file with one-line descriptions

## Reference contents (concise)

- **perimeter-do-no-harm.md** — destructive_refinement gate math, region-based exclusion gate (area_px ≥ 25, ≥3 unique pts, area loss ≤15% without DSM+RGB), bounded snap distance `max(6px, 3% bbox diag)`, raw-fallback conservative gate, Fonsica numbers as the canonical worked example.
- **structural-evidence-and-topology.md** — deferred_structural_candidates, locked seed backbone, repair pass before rejection, `backbone_not_applied` and `topology_undersegmented_after_backbone_repair` failure modes.
- **roof-lines-and-pitch-contract.md** — forbidden perimeter sources, typed roof_lines required fields + allowed attributes, pitch fallback to Solar `roofSegmentStats`, never emit collapsed-plane pitch like 0.11/12 or 1.67/12.
- **required-diagnostics.md** — exact JSON shapes for `route_provenance`, `phase3_5`, `phase3C`, `phase3D`, `phase3E`. Every run must persist all fields; nulls only with explicit `skipped_reason`.
- **visual-qa-overlay.md** — color spec (raw=gray, refined=green, fallback=blue, target mask translucent, rejected verts=red, exclusions=orange, DSM candidates, Solar outlines), rule that `diagram_render_intent=rejected_only` still renders the perimeter-refinement debug overlay (never blank).
- **fonsica-regression-checklist.md** — 8 hard-fail conditions and the expected safe-behavior block for 4063 Fonsica Ave.

## Activation

After writing the draft files, call `skills--apply_draft` with path `.agents/skills/roof-measurement-vision-qa`. From then on, any measurement-pipeline request retrieval-matches this skill and the rules apply before code is written.

## Out of scope

- No edits to `perimeter-refinement.ts`, `start-ai-measurement`, or `MeasurementReportDialog.tsx` in this task — those live in the previous plan. This task only installs the skill.
- No DB migration, no edge-function deploy.

## Acceptance

- `.workspace/skills/roof-measurement-vision-qa/SKILL.md` exists with frontmatter + hard rules.
- All 6 reference files present and readable via `knowledge://skill/roof-measurement-vision-qa/references/<file>.md`.
- Skill surfaces (by description match) when the user mentions: AI measurement, perimeter refinement, Phase 3A.5/3C/3D/3E, Fonsica, roof topology, ridge/valley/hip, customer report gate.
