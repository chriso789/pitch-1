## Goal
Fix the two visible problems:
1. Stop GitHub Actions failure-email spam from normal pushes.
2. Remove the black box/letterbox from measurement report debug views.

## Plan

### 1. CI email spam
- Keep `.github/workflows/ci.yml` PR-only/manual by ensuring there is no `push: main` trigger.
- If the workflow already matches that state, make no CI workflow change.
- Do not try to fix unrelated Build/Lint/Typecheck/Unit failures in this pass unless they are caused by the black-box UI changes.

### 2. Measurement Visual QA black box
Update `src/components/measurements/MeasurementVisualQAOverlay.tsx`:
- Replace the canvas wrapper `bg-slate-900` with a neutral semantic/light surface so unused crop space or image loading never appears as a giant dark rectangle.
- Keep the existing canvas fill behavior that uses a light fallback instead of `#0f172a`.
- Add/adjust test coverage if there is an existing DOM test location for this component.

### 3. AI Process Viewer black letterbox
Update `src/components/measurements/AIMeasurement3DDebugViewer.tsx`:
- Remove `bg-black` from the aerial `<img>` that currently uses `object-contain bg-black`.
- Use a neutral themed wrapper/background instead, so any letterboxing is light/transparent rather than black.
- Keep the aerial as the background when available; do not change geometry logic, gates, DSM logic, or report data.

### 4. PDF/debug export safety check
Review the report PDF visual path using `MeasurementReportPdfVisualSection.tsx` and `RasterOverlayDebugView.tsx`:
- Preserve the existing single-overlay-panel contract.
- Ensure PDF-mode surfaces stay white and no dark placeholder is introduced.
- Leave export logic alone unless a dark background is still present in the PDF root/panel.

### 5. Verify
- Run the targeted measurement visual/PDF tests only, not the full build.
- Confirm the codebase no longer has the specific dark backgrounds in these two report/debug overlay spots:
  - `MeasurementVisualQAOverlay` canvas wrapper
  - `AIMeasurement3DDebugViewer` aerial image/background

## Out of scope
- GitHub account notification settings.
- Branch protection / repo settings.
- Full cleanup/refactor into a shared overlay component.
- Fixing unrelated existing CI failures across the whole app.