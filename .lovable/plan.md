

# Update SRS Pricelist & Material Catalog to January 2026 Pricing

## What Changed

Comparing the new PDF (effective **01-09-2026**) against the current static data file (effective **07-24-2025**), the following prices changed:

### Shingle Price Changes ($/SQ)
| Product | Old Price | New Price |
|---|---|---|
| GAF Timberline HDZ | $121.00 | **$115.00** |
| OC Oakridge | $116.00 | **$105.00** |
| OC Duration | $118.00 | **$114.00** |
| CT Landmark | $117.00 | **$113.00** |
| IKO Cambridge | $110.00 | **$105.00** |
| IKO Dynasty | $115.00 | **$109.00** |
| Atlas Pinnacle | $120.00 | **$115.00** |
| TAMKO Heritage | $113.00 | **$106.00** |
| TAMKO TITAN XT | $116.00 | **$112.00** |
| CT Landmark Pro | $129.00 | $129.00 (same) |

### Other Price Changes
| Product | Old Price | New Price |
|---|---|---|
| OC Starter Strip Plus | $60.00 | **$54.00** |

### Vendor Info Update
- Email: `hunter.prussel@suncoastrooferssupply.com` → `hunter.prussel@srsbuildingproducts.com`
- Company name: SRS Distribution (was "Suncoast Roofers Supply")
- Effective date: `2025-07-24` → `2026-01-09`

All other items (hip & ridge, starters, underlayments, ice & water, low slope, tile, metal, ventilation, adhesives, fasteners, accessories, freight) — prices unchanged.

## Plan

### 1. Update `src/data/srs-pricelist-data.ts`
- Update the 10 shingle prices to match Jan 2026 PDF
- Update OC Starter Strip Plus from $60.00 to $54.00
- Update `SRS_VENDOR_INFO` (email, company name, effective date)
- Update the file header comment to reflect new date

### 2. Update database `materials` table
Run SQL to update `base_cost` for the matching items in O'Brien's tenant (`14de934e-...`). The DB currently has items like "CT Landmark Shingles" at $40/bundle — need to verify if those are per-bundle or per-square and update accordingly. The SRS pricelist quotes per-square for shingles ($115/SQ = ~$38.33/BD for HDZ).

Key DB items to update:
- `CT Landmark Shingles` (currently $40/bundle) → update to match $113/SQ ÷ 3 = **$37.67/BD**
- `CT SwiftStart Starter` (currently $34/bundle) → stays $55.00/BD (unchanged in PDF, but DB has stale $34 — should be $55)
- `CT Shadow Ridge Cap` (currently $50/bundle) → should be $69.75/BD per PDF
- `CT WinterGuard Ice & Water` (currently $120/roll) → stays $97.50/RL per PDF (DB has stale $120)
- `CT DiamondDeck Underlayment` (currently $90/roll) → not in PDF (CT Roofrunner = $85/RL)

These DB materials appear to have been manually set and may not all correspond 1:1 to the SRS pricelist. I will update only the items where there's a clear match and the price differs.

### Summary of changes
1. **`src/data/srs-pricelist-data.ts`** — Update 11 prices + vendor info
2. **Database UPDATE** — Correct `base_cost` on matching materials in the `materials` table

