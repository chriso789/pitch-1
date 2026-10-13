# PITCH PDF Studio — upstream engine integration

Source: https://github.com/storytold/pdfcraft
Pinned upstream commit observed 2026-10-12: `0a0986483378b57d62103a36490bd66166d32c8f`.
License: MIT OR Apache-2.0 for project code; review NOTICE, ATTRIBUTION.md, vendor license records. ArtCraft brand assets are **not** open source and must not be incorporated in PITCH.

## Implemented on this branch
- A protected `/documents/pdf-studio` route with a browser-local merge, page extraction and rotate interface built on existing `pdf-lib`.
- No upstream PdfCraft executable or Rust source has been copied. Do not advertise advanced PdfCraft functionality as implemented.
- No changes to current PDF workspace, smart docs, blueprint takeoff, or invoice flows.

## Next engineering stage (requires build/test environment)
1. Vendor the audited PdfCraft source at the pinned SHA via a dedicated upstream mirror/submodule or pinned build dependency, retaining license files and provenance.
2. Identify compatible Rust crates and compile a minimal WASM browser worker or isolated container service; verify supported target and feature flags before choosing.
3. Define an adapter `PdfBackend` with operations: render/search, merge/split/reorder/rotate, annotations, forms, redact, OCR where actually supported. Return explicit unsupported errors rather than fake functionality.
4. Apply tenant/user authorization to any server-side document request; avoid sending private customer PDFs to arbitrary endpoints. Enforce size/page limits, rate limits, signed download URLs and delete temporary files.
5. Keep PDF.js and pdf-lib as a tested fallback. Never silently modify signed documents or original blueprint files. Version edited outputs.
6. Connect capability-gated UI actions to existing PDF workspace and Smart Docs. Add blueprint import/export only after confirming plan geometry, text and scale fidelity.
7. Test encrypted files, corrupt files, multi-hundred-page drawings, rotated page coordinates, redaction irreversibility and signature invalidation. Run PITCH lint/typecheck/unit/E2E and build. Deploy only after validation.

## Lovable integration
Sync this PR through the connected GitHub project. Expose the PDF Studio navigation link beside PDF Workspace. Implement the audited Rust adapter separately; Lovable/Supabase edge functions cannot directly execute a native Rust desktop binary without an appropriate deployment/runtime.
