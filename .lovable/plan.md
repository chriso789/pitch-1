## Goal
Pull the 33 real SRS SKUs + prices from the uploaded Roof Hub order (SRS Orlando branch) and write them onto the matching items in the GAF EverGuard TPO template (`020fb16e-8206-4a10-9a06-37b5ee23c0d3`), so the template panel shows live, accurate SRS costs instead of `$0.00` / placeholder SKUs.

## Mapping (PDF item → template item)
| Template item | SRS SKU | Unit Cost |
|---|---|---|
| GAF EverGuard TPO 60 Mil — 10ft Roll | GAF7563920 | $800.00 |
| GAF EverGuard TPO Detail Membrane 12" | GAFEGTDMN | $475.00 |
| GAF EverGuard TPO Utility Flashing Membrane | GAFEGTEFS8 | $241.00 |
| GAF EverGuard TPO Inside/Outside Corners | GAF7732920 | $13.40 |
| GAF EnergyGuard Polyiso ISO 2.0" (flat 2" board) | GAFEGTIC | $24.40 |
| Tapered ISO Package (1/2" per foot) | GAFEGTIA | $13.55 |
| GAF SecurockGypsum Cover Board 1/2" | GAFSR4812 | $28.25 |
| OlyBond500 Insulation Adhesive | GAF2POB500CK | $1,570.00 |
| Drill-Tec #15 Fastener (mechanically attached alt) | GAF457N | $435.00 |
| Drill-Tec 3" Insulation Plate | GAFFP238EGX | $420.00 |
| GAF EverGuard TPO Bonding Adhesive | GAFEGPBAAM5 | $365.00 |
| GAF EverGuard TPO Cut-Edge Sealant | GAFEGTCESCL | $26.75 |
| GAF EverGuard TPO Primer | GAFEGTTPR1 | $61.50 |
| GAF EverGuard TPO Pre-Molded Pipe Boot | CARTMPFWH | $40.25 |
| Termination Bar w/ Sealant Edge | DMI9RTBK10A | $10.03 |
| GAF FlexSeal Caulk Grade Sealant (Lucas #9600) | LUCJTSBK | $8.05 |
| TPO Coated Drip Edge — 10ft (TPO Coated Metal 4'x10') | GAFEGTCM410 | $485.00 |
| Roof Drain Retrofit Assembly (SpeedTite 3") | GAF8523R | $665.00 |
| TPO Walk Pad 30"x50ft | GENT3050WH | $595.00 |
| GAF EverGuard TPO Cover Tape (Water Block Sealant slot) | GAFPS6CS | $390.00 |

20 of the 38 template lines get real SRS SKUs + costs. The remaining items either have no PDF equivalent (labor lines like Tear-Off, Heat-Weld, Cleanup; rentals; warranty) or are extra tapered-ISO variants — those stay untouched.

## Implementation
1. **One migration**, `UPDATE estimate_calc_template_items SET srs_sku = ..., unit_cost = ..., updated_at = now() WHERE id = ...` for each of the 20 mapped rows (matched by `id`, not name, so it's safe & idempotent).
2. No schema changes, no edge function changes, no UI changes.
3. After the migration, open the template editor → click **Refresh Live Pricing**. The SRS column should now show real branch pricing for these 20 items (no more "not mapped" / `$0.00`).

## What this does NOT do
- Does not touch ABC or QXO SKUs (ABC still gated on account/branch sync).
- Does not seed the extra tapered-ISO height variants (GAFEGTIAA, GAFEGTIB, GAFEGTIQ, GAFEGTISS, GAFEGTIX, GAFEGTIY, GAFEGTIZ, GAFEGTIZZ) as new template rows — tell me if you want those added as separate line items.
- Does not change labor-line costs.

Approve and I'll write the migration.
