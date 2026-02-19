

# Improve Estimate Template Line Item Descriptions

## Problem

The current line item descriptions in all brand templates are short, technical labels that just repeat the product name (e.g., "SureNail Technology shingles", "Starter strip", "Hip and ridge cap"). Homeowners reading estimates don't understand what these items are or why they're needed.

## Solution

Rewrite every `description` field in `src/lib/estimates/brandTemplateSeeder.ts` across all 12 brand templates (GAF, OC Duration, OC Oakridge, CertainTeed, 5V Metal, Standing Seam, Worthouse Dura, Worthouse Supre, Boral Flat Tile, Eagle Flat Tile, Boral W Tile, Eagle W Tile) with homeowner-friendly explanations.

## Examples of Changes

| Item | Current Description | New Description |
|------|-------------------|-----------------|
| Shingles (any brand) | "SureNail Technology shingles" | "Remove old roof and install new architectural shingles for lasting weather protection" |
| Starter Strip | "Starter strip shingles" | "Adhesive starter row installed along eaves and rakes to seal the first course of shingles against wind uplift" |
| Ridge Cap | "Hip and ridge cap" | "Specially shaped shingles installed along the peak and hip lines of your roof for a finished, watertight seal" |
| Underlayment | "Synthetic underlayment 10sq roll" | "Waterproof barrier installed over the roof deck beneath the shingles as a secondary layer of leak protection" |
| Ice & Water Shield | "Ice and water shield 200sqft roll" | "Self-adhering waterproof membrane applied to vulnerable areas (eaves and valleys) to prevent ice dam and wind-driven rain leaks" |
| Drip Edge | "10ft galvanized drip edge (eave + rake)" | "Metal edge flashing installed along the roof perimeter to direct water away from the fascia and into gutters" |
| Valley Metal | "10ft w-style valley metal" | "Metal channel installed where two roof slopes meet to direct heavy water flow and prevent valley leaks" |
| Pipe Boot | "Small pipe boot flashing" | "Rubber-sealed flashing fitted around plumbing vent pipes to prevent leaks at roof penetrations" |
| Coil Nails | "Roofing coil nails box" | "Galvanized roofing nails used to secure shingles to the roof deck per manufacturer specifications" |
| Roofing Cement | "Roof sealant tube" | "Sealant applied to flashings, edges, and penetrations for additional waterproofing" |
| OSB Sheets | "Decking repair sheets" | "Replacement plywood decking boards for any rotted or damaged sections discovered during tear-off" |
| Tear Off (labor) | "Remove existing roofing" | "Remove and dispose of all existing roofing materials down to the bare deck" |
| Shingle Install (labor) | "Install architectural shingles" | "Professionally install new shingles per manufacturer specifications to maintain full warranty coverage" |
| Cleanup/Haul (labor) | "Debris removal" | "Complete job site cleanup, magnetic nail sweep, and haul all debris to the dump" |

## Scope of Changes

**Single file modified:** `src/lib/estimates/brandTemplateSeeder.ts`

All 12 brand templates will be updated -- approximately 120+ description fields total. Each description will:

1. Explain what the item does in plain English
2. Explain why it's needed (weather protection, code compliance, warranty, etc.)
3. For shingle-type items, include "Remove old roof and install new..." language
4. Keep descriptions concise (1-2 sentences max)
5. Avoid jargon -- use terms a homeowner would understand

The descriptions will also apply correctly per roof type:
- **Shingle templates** -- reference shingle-specific language
- **Metal templates** -- reference panel and screw language
- **Stone coated templates** -- reference stone coated panel language
- **Tile templates** -- reference concrete tile language

## Technical Notes

- The `description` field is already displayed in the UI via the `DescriptionEditor` component in `SectionedLineItemsTable.tsx` (shown as gray text below the item name)
- No schema changes needed -- `description` is an existing `string` field on `TemplateItem`
- Existing estimates already saved in the database will not be affected -- only new estimates built from templates going forward will get the improved descriptions
- Users can still edit descriptions inline via the existing editor

