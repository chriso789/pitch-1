# Roadmap — PDF Studio
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
- [ ] Select existing PDF text and edit with its exact original font — audit internal engine/PDFCraft, verify exports independently, publish written gaps before any paid SDK approval; no cover-overlay substitute
- [ ] Expose Edit PDF in Smart Docs; classify unsupported text/fonts without silent substitution
- [ ] Advance supported Fill & Sign and verify new-version reopen; keep Organize Pages available
- [ ] Audit insurance certificate — blocked if source file/authenticated access unavailable
- [ ] 2C Drawing revision comparison
- [ ] 2D OCR, conversions, protection, optimization
- [ ] 2E Workflow automation across PITCH
- [x] Smart Docs storage path fix (tenant-folder uploads; legacy files readable by owning company only)
- [ ] Measurement carry-over integration tests (reorder/duplicate/rotate/crop)
- [ ] 2C revision comparison (side-by-side, overlay, alignment, diff, report, RFI/CO/takeoff tasks)
- [ ] Markup Unicode font embedding + rotated-annotation interop warnings
- [x] Week 1: Pages/Markup exposed from the main PDF editor; page tools on in production (opt-out pitch.pageTools=0)
