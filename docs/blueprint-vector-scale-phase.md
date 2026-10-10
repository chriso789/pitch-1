# Blueprint Vector Geometry + Scale Calibration

Status: implemented on PR #9; review-gated and no CRM estimate writes.

## Scale behavior
- Architectural scales such as `1/4" = 1'-0"`, `1/8" = 1'-0"`, `1" = 20'-0"` are normalized to real feet per PDF point.
- Ratio scales such as `1:50` are converted using 1 paper inch = 50 real inches.
- Scale is owned by a drawing viewport, not blindly by the whole sheet.
- Printed dimensions may validate the declared scale. <=3% mismatch validates; >7% conflict blocks geometry conversion; intermediate mismatch remains review-required.
- Missing/NTS/conflicted scales never emit trusted SF/LF.

## Vector extraction
`pdf-layout.ts` now reads PDF.js operator lists and extracts transformed stroked lines/rectangles with CTM save/restore/transform support. Coordinates are normalized to the same top-left page coordinate system as text.

## Roofing geometry
- Vector segments are assigned to the nearest drawing viewport/scale anchor.
- Large simple closed vector components can become roof-outline candidates.
- Roof outline area is converted from PDF points² to real SF using that viewport's calibrated scale.
- Explicit nearby line labels can classify vectors as ridge, hip, valley, eave, rake, parapet, roof-to-wall, flashing, or step flashing and emit calibrated LF.
- Unlabeled edge types are not guessed.
- Scale and geometry outputs remain review-gated before downstream estimate handoff.

## Safety
No OCR geometry is claimed. Curved paths are not approximated as roofing edges. Complex branched vector networks do not become roof outlines. Large sheet borders are filtered from outline candidates. Push to Estimate remains disabled.
