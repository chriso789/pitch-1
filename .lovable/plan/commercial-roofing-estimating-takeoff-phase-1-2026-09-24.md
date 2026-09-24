# Commercial Roofing Estimating & Takeoff (Phase 1)

Goal: let a commercial roofing company stop using EDGE. A commercial project goes from drawings to a checked takeoff, a priced estimate, and a bid, all inside Pitch. Residential workflows stay the same.

## What Pitch already has (we build on it, not duplicate it)
- **Already usable:** blueprint upload, page sorting, spec pulling, roof plan geometry, the page review screen, and the record of where each number came from (source sheet, confidence)
- **Needs extending:** estimates (add commercial sections), material/labor catalogs (add commercial items), approvals (add estimate approval steps), supplier pricing (ABC/SRS/QXO)
- **New:** a Commercial workspace, commercial roofing assemblies, production rates, a review gate for each quantity, bid leveling, and importers

## What the user will see
1. **Commercial tab** in the side menu. It lists commercial projects with bid date, estimator, GC, and status (Bidding / Submitted / Won / Lost).
2. **Commercial project page** with tabs: Overview, Drawings & Specs, Takeoff, Estimate, Bids, Files.
3. **Takeoff:** upload drawings, confirm the scale on each sheet, then check the AI's quantities: roof area by section, perimeter, parapet, drains, scuppers, curbs, penetrations, and flashing lengths. Each quantity shows its source sheet, confidence, and a status (Auto-detected / Review Required / Verified / Overridden / Rejected). Anything below 95% confidence, or on an unverified scale, is marked Review Required.
4. **Assemblies:** reusable roof systems (for example 60 mil TPO mechanically attached, EPDM fully adhered, mod-bit 2-ply, standing-seam metal). Each one includes insulation layers, cover board, fasteners, adhesives, flashing, edge metal, and labor production rates (squares per crew-day). Quantities flow into the assembly and turn into material and labor lines.
5. **Estimate:** cost summary by division (material, labor, equipment, subs, general conditions, overhead, markup, bond, tax), then alternates and exclusions.
6. **Bid form & proposal PDF**, with an approval chain (Estimator → Senior Estimator → Executive) set by dollar amount.
7. **Bid leveling:** enter sub/supplier quotes side by side, flag scope gaps, and pick the carried number.
8. **Audit history:** every quantity, price, rate, or markup change is saved with who, when, old value, new value, and reason. Nothing is silently overwritten.

## Importing their existing data
- **EDGE:** import estimate/takeoff exports (CSV/Excel) into commercial projects, assemblies, and quantities
- **Procore:** import the project list, directory (GC, architect, owner contacts), and documents from CSV/export
- **Shared drive:** bulk-upload a project folder (ZIP). Files are auto-sorted into Drawings, Specs, Bids, Contracts, and Photos.
- **Needs from you:** one sample EDGE export, one Procore export, and a sample project folder. That way the importers match their real files and don't guess at the format.

## Out of scope for Phase 1 (next phases)
Budgets, buyout, POs, subcontracts, change orders, and job cost (Phase 2, the Procore replacement). Document control for RFIs, submittals, and drawing revisions (Phase 3).

## Technical details
- New tables (all tenant-scoped with RLS and grants): `commercial_projects` (links to `pipeline_entries`/`contacts`, bid fields, parties), `commercial_assemblies` + `commercial_assembly_components`, `commercial_production_rates`, `commercial_takeoff_quantities` (value, uom, source_sheet, confidence, scale_status, review_status, overridden_from), `commercial_estimates` + `commercial_estimate_lines` + `commercial_estimate_versions`, `commercial_bid_packages` + `commercial_bid_quotes`, `commercial_audit_log`, `commercial_import_jobs`
- Reuse `blueprint_source_documents`, `blueprint_measurement_objects`, `blueprint_estimate_line_provenance`, and `synthesize-blueprint-trade-takeoffs` as the source of takeoff quantities
- Review gate: a database trigger blocks any quantity that isn't `verified`/`manually_overridden` from being used in a submitted estimate version
- Estimate versions can't be changed once submitted; an approval creates a new version row
- Edge functions: `commercial-import` (EDGE/Procore CSV + ZIP classify via Lovable AI), `commercial-estimate-compute`, `commercial-proposal-pdf`
- Seed a starter library of commercial roofing assemblies and production rates for each tenant, editable in settings
- Routes: `/commercial`, `/commercial/:id/*`, lazy-loaded; added to the nav behind a per-tenant "Commercial" feature toggle
