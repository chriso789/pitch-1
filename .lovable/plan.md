

# Update Material Descriptions from PDF Estimates

## What
Extract line item descriptions from the 3 uploaded PDF estimates (5V Mill Finish, GAF HDZ, Standing Seam Painted) and apply them to the `materials` table in the database. The `estimate_line_items` table is currently empty (0 rows), so only materials need updating.

## Extracted Descriptions (28 items matched to DB)

From all 3 PDFs, I extracted descriptions for these materials that exist in the database:

| Material Name | New Description |
|---|---|
| 1" SnapLok Panels 24ga | Remove old roof and install new metal roofing panels for superior durability and weather resistance. 1" SnapLok panels are 24-gauge standing seam metal roofing featuring a concealed fastener, snap-together design for easy installation... |
| Butyl Tape 1" | Adhesive sealing tape applied at panel overlaps for a weathertight bond between metal panels... |
| Eave Closure Strip | Foam or rubber sealing strips installed at panel edges to block wind-driven rain, insects, and debris... |
| Metal Hip Cap | 10ft metal hip cap. Specialized flashing installed over the diagonal ridge where two roof slopes meet... |
| Metal Pipe Boot | Rubber-sealed flashing fitted around plumbing vent pipes to prevent leaks at roof penetrations... |
| Metal Ridge Cap | Specially shaped shingles installed along the peak and hip lines of your roof for a finished, watertight seal... |
| Pancake Screws #10 x 1" | Specialized fasteners used to secure metal panels to the roof deck for a watertight seal. |
| Pancake Screws #12 x 1.5" | Specialized fasteners used to secure metal panels to the roof deck for a watertight seal... (extended) |
| Polyglass XFR | High Temp - Fire Rated Peel N Stick. Polystick® XFR by Polyglass is a premium, self-adhered waterproofing underlayment... |
| Polyglass XFR Underlayment | Waterproof barrier installed over the roof deck beneath the shingles as a secondary layer of leak protection... |
| Ridge Closure Strip | (same pattern as eave closure) |
| Panel Install | Professionally install new roofing materials per manufacturer specifications... |
| Tear Off | Remove and dispose of all existing roofing materials down to the bare deck... |
| Coil Nails 1-1/4" | Galvanized roofing nails used to secure roofing materials to the deck per manufacturer specifications |
| Drip Edge | Metal edge flashing installed along the roof perimeter to direct water away from the fascia and into gutters |
| GAF Cobra Ridge Vent | Specially shaped shingles installed along the peak and hip lines of your roof for a finished, watertight seal |
| GAF Pro-Start Starter Strip | Adhesive starter row installed along eaves and rakes to seal the first course of shingles against wind uplift |
| GAF Seal-A-Ridge Ridge Cap | Specially shaped shingles installed along the peak and hip lines of your roof for a finished, watertight seal |
| GAF StormGuard Ice & Water | Self-adhering waterproof membrane applied to vulnerable areas like eaves and valleys to prevent ice dam and wind-driven rain leaks |
| GAF Timberline HDZ Shingles | Remove old roof and install new architectural shingles for lasting weather protection and curb appeal |
| Pipe Boot 1-3" | Rubber-sealed flashing fitted around plumbing vent pipes to prevent leaks at roof penetrations |
| Roofing Cement | Sealant applied to flashings, edges, and penetrations for additional waterproofing |
| Cleanup/Haul | Complete job-site cleanup, magnetic nail sweep, and haul all debris to the dump |
| Shingle Install | Professionally install new roofing materials per manufacturer specifications to maintain full warranty coverage |
| Dump Fees | Dump fees, or "tipping fees," are charges imposed by landfills, transfer stations, or waste facilities... |
| SnapLok Eave Trim | 10.5ft eave trim. SnapLok eave trim is a specialized, factory-formed metal flashing designed for standing seam roof systems... |
| SnapLok Hip Cap | 10 ft hip cap. A SnapLok hip cap is a specialized, fastener-free roofing component designed for standing seam metal roofs... |
| SnapLok Rake Trim | 10.5ft rake trim. SnapLok rake trim (or gable trim) is a specialized, often fastener-free flashing used in standing seam metal roofing... |
| SS Pipe Boot | Rubber-sealed flashing fitted around plumbing vent pipes to prevent leaks at roof penetrations... |

## Approach
Run `UPDATE materials SET description = '...' WHERE name = '...'` statements via psql for each of the 28+ matched items. This updates ALL duplicate rows for a given material name (since there are multiple tenant copies).

**Note**: "5V Metal Panels 24ga - Mill Finish" from the PDF has no exact match in the DB (only "5V Metal Panels 24ga Painted" exists). The Mill Finish description will be skipped unless you want it applied to the Painted variant too.

## No code changes needed
This is purely a database data update.

