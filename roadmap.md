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
- [x] 2D Image/Word→PDF conversion at /documents/convert (4 tests; prod opt-in pitch.ocr=1)
- [x] 2D rotated-page OCR layer (90/180/270)
- [x] 2D OCR languages: Spanish, French, Portuguese, German, Italian (+English)
- [ ] 2D remaining: signed-in test; non-Latin scripts (layer is WinAnsi-only)
- [ ] 2E Workflow automation across PITCH
- [x] Smart Docs storage path fix (tenant-folder uploads; legacy files readable by owning company only)
- [ ] Measurement carry-over integration tests (reorder/duplicate/rotate/crop)
- [x] 2C revision comparison: side-by-side (synced scroll), overlay w/ transparency, size/rotation normalization, manual nudge, anti-alias-filtered diff, region report (4 tests; prod opt-in pitch.compare=1)
- [x] 2C saved comparison records (permanent) + RFI / change-order review / takeoff review items per change area (status-only edits)
- [x] 2C annotation/markup diff per page (added/removed/text changed)
- [ ] 2C remaining: measurement-record diff; signed-in save test
- [ ] Authenticated integration tests — BLOCKED: external Supabase, no test credentials available to agent
- [x] 2E protection: AES-256 protected copy (download only, verified), metadata removal, password removal (prod opt-in pitch.protect=1)
- [x] 2E true redaction: marked pages flattened, content/annotations/fields deleted, orphan objects purged, double-checked
- [x] 2E searchable text on redacted pages (OCR re-layer of visible content, optional)
- [ ] 2E remaining: signed-in test
- [x] 2F batch PDF tasks at /documents/batch (rotate, keep pages, numbers, watermark, title, remove details; preview, new versions with recorded steps; 3 tests; prod opt-in pitch.batch=1)
- [x] 2F searchable-text (OCR) batch step + company-shared saved step lists
- [ ] 2F remaining: signed-in test. Redact/Protect intentionally not batch steps (redaction needs per-file boxes; protected copies are download-only)
- [x] 2G Compress (lossless / photo resize, page-count verified) + Repair (rebuilds broken files) — "Compress & Repair" tab, prod opt-in pitch.health=1; signed-in test pending
- [ ] Markup Unicode font embedding + rotated-annotation interop warnings
- [x] Week 1: Pages/Markup exposed from the main PDF editor; page tools on in production (opt-out pitch.pageTools=0)

## UltraScan document scanner
- [x] Stage 1–2 (already existed): live edge detection, auto-capture when steady, perspective/crop, manual corners, multi-page, blur/glare/shadow warnings
- [x] Stage 3: paper-light shadow/yellow-cast correction; modes Auto / Ultra Clean / Original Color / B&W / Grayscale / Original (`src/lib/scan-restore/restore.ts`)
- [x] Stage 4 (part): ink-preservation check flags pages where cleanup lightened handwriting/signatures; Before/After toggle in review; flagged pages need acknowledgment
- [x] Untouched camera photos saved beside the PDF (`*_originals/page_N.jpg`, paths in metadata)
- [x] Stage 4a: post-capture re-edit from the untouched photo (mode, strength, brightness, contrast, corners, undo, reset, apply-to-all, ink re-check)
- [ ] Stage 4b: shadow-model benchmark (DeshScan etc.) — blocked on real signed-contract photos; licenses for code and weights checked separately
- [ ] Stage 6: real iOS/Android device QA — blocked on devices/field rep
- [ ] Stage 5: searchable PDF via existing OCR layer; scanner entry points on contacts, jobs, commercial projects, permits
- [ ] Stage 6: real-device test set (dark desk, truck, clipboard, hard shadows, faint signatures) — needs real phones/photos

## UltraScan Phase 5–6
- [x] 5A Searchable scanned PDFs (local OCR, English + Spanish, invisible layer behind image, reopen-verified, image-only option)
- [~] 5B CRM integration — scanner accepts record type/ID, name, category; uses active company. Open: add Scan buttons on contacts, jobs, commercial projects, permits, contracts, Smart Docs, mobile.
- [ ] 5C Shadow-model benchmark — blocked: needs real photographed documents with ground-truth text.
- [ ] 6 Mobile acceptance — blocked: needs real iPhone/Android devices.

## UltraScan mobile reliability milestone (A–F)
- [x] A background cleanup, progress, cancel, memory budget, orientation transforms
- [ ] A browser viewport test of scanner — blocked: scanner requires sign-in, no session available
- [x] B retry/refresh/quota/duplicate handling, draft recovery tests
- [x] C authenticated isolation harness built
- [ ] C live isolation run — blocked: needs two isolated test companies + accounts
- [x] D synthetic shadow benchmark (B&W speckle defect recorded)
- [ ] D OCR error rate / real photos / neural models — blocked: real photos; model licenses
- [x] E warning triage; satellite storage writes locked to service role
- [ ] E fix anon-executable functions and open inserts — needs per-function caller audit
- [ ] F real-phone five-page signed-contract acceptance — blocked: device
