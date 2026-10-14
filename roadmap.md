# Roadmap — PDF Studio
## Marketing audit
- [x] Move Inspection Requests below Marketing Audit in the lower navigation.
- [x] Add tenant-isolated, immutable marketing cost ledger and channel reporting.
- [x] Display existing CRM source/campaign/placement evidence; generic sources stay unattributed.
- [x] Calculation tests and policy inspection; live provider synchronization explicitly not connected.
- [ ] Automatic Facebook/Google/Yelp spend and inbound event sync — blocked on company-specific provider connections and verified event mappings; five previously configured placements not found in available history.
- [ ] Authenticated save/readback and cross-company browser checks — external Supabase managed session unavailable.

- [x] Phase 1 Plan Measurement (built; signed-in test with a real plan set pending user)
- [ ] Phase 2 Page Tools
- [ ] Phase 3 Markup Tools
- [ ] Phase 4 Revision Compare
- [ ] Phase 5 OCR / Conversions
- [ ] Phase 6 Batch Workflow Automation

## PDF suite (Phase 2)
- [x] 2A Page organizer (preview/dev only; prod opt-in `pitch.pageTools`) — needs signed-in test on real drawing sets
- [x] 2A Smart Docs integration of page organizer (Pages/Markup buttons on PDF company docs)
- [x] 2B Markup tools (preview/dev only) — needs signed-in test and Acrobat desktop check
- [ ] 2B Genuine editing of existing PDF text (not supported safely by current engines)
- [x] Genuine existing-text editing (content-stream Tj/TJ splice, original font, glyph-proven, reopen-verified; 3 tests)
- [x] Move / font / size / colour editing of existing text (old operator removed, line advance preserved; 5 tests) and local unlocking of owner-protected PDFs (verified on official ACORD 25 sample)
- [ ] Remaining text-edit gaps: text split across operators, form XObjects, Type3, non-Identity CID, password-protected PDFs
- [ ] (old) Select existing PDF text and edit with its exact original font — audit internal engine/PDFCraft, verify exports independently, publish written gaps before any paid SDK approval; no cover-overlay substitute
- [x] Expose text inspection and Fill Forms in Smart Docs/workspace/studio; unsupported fonts are disclosed without substitution
- [x] Verify AcroForm fill/download/reopen with local embedded-font fixture and independent Poppler rendering (26 targeted tests pass)
- [x] Fill & Sign tab (drawn/typed signature, initials, text, date, check; image marks, not certificate signing; 3 tests)
- [ ] Authenticated stored-version save/reopen check — and authenticated stored-version save/reopen — signing implementation and external-project session unavailable
- [ ] Audit insurance certificate — blocked if source file/authenticated access unavailable
- [ ] 2C Drawing revision comparison
- [x] 2D OCR (local Tesseract, confidence flags, invisible searchable layer as new version) + page→PNG export, text export (prod opt-in pitch.ocr=1)
- [ ] 2D remaining: Office/image→PDF conversions, rotated-page OCR layer, non-English, signed-in test
- [ ] 2E Workflow automation across PITCH
- [x] Smart Docs storage path fix (tenant-folder uploads; legacy files readable by owning company only)
- [ ] Measurement carry-over integration tests (reorder/duplicate/rotate/crop)
- [x] 2C revision comparison: side-by-side (synced scroll), overlay w/ transparency, size/rotation normalization, manual nudge, anti-alias-filtered diff, region report (4 tests; prod opt-in pitch.compare=1)
- [x] 2C saved comparison records (permanent) + RFI / change-order review / takeoff review items per change area (status-only edits)
- [ ] 2C remaining: annotation/measurement-record diff; signed-in save test
- [ ] Authenticated integration tests — BLOCKED: external Supabase, no test credentials available to agent
- [ ] 2D OCR/conversions, 2E protection, 2F automation, final integration
- [ ] Markup Unicode font embedding + rotated-annotation interop warnings
- [x] Week 1: Pages/Markup exposed from the main PDF editor; page tools on in production (opt-out pitch.pageTools=0)
