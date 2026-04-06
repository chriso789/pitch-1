

## Add Bulk Upload + Diagram Extraction to Training Lab

### What You're Asking For

You want to add the bulk upload button directly into the Roof Measurement Training Lab (the screen you screenshotted), and you want the ingestion to not only extract measurement text but also **extract the drawn roof diagrams/images** from the PDFs. These diagrams become the visual ground truth so when a user clicks "AI Measurement," the system can generate an exact replica of that roof shape.

### Current State

- **BulkReportImporter** component already exists and handles multi-file PDF upload, measurement parsing, geocoding, and training session creation
- **roof-report-ingest** edge function extracts text and measurements but does NOT extract embedded images/diagrams from PDFs
- No diagram images are currently stored from vendor reports

### Plan

**1. Add Bulk Upload button to RoofTrainingLab header** (`src/components/settings/RoofTrainingLab.tsx`)
- Import `BulkReportImporter` 
- Place it next to the "New Training Session" button in the header
- Wire `onComplete` to trigger `refetch()` so new sessions appear immediately

**2. Enhance `roof-report-ingest` to extract diagram images** (`supabase/functions/roof-report-ingest/index.ts`)
- After PDF text extraction, use pdfjs to render each page as an image
- Send each page image to Vision AI with a specialized prompt: "Identify which page contains the roof diagram/drawing showing the roof outline, facets, ridges, valleys, and hips. Extract the diagram as a structured description including vertex positions, edge labels, and facet boundaries."
- Store the diagram page image in Supabase Storage (`vendor-reports/{report_id}/diagram.png`)
- Add `diagram_image_url` and `diagram_data` (structured geometry JSON) to the `roof_vendor_reports` row
- Also pass `diagram_image_url` into the training session creation so it's available as visual ground truth

**3. Database migration** - Add columns to `roof_vendor_reports`:
- `diagram_image_url TEXT` - URL to the extracted diagram page image
- `diagram_geometry JSONB` - AI-extracted structured geometry from the diagram (vertices, edges, facet labels, dimensions)

**4. Update training session creation** (in both `roof-report-ingest/index.ts` and `BulkReportImporter.tsx`)
- Pass `satellite_image_url` = diagram image URL into training sessions created from vendor reports
- This links the visual diagram to the training data so the AI learns what each roof shape looks like

### How Diagram Extraction Works

For each uploaded PDF:
1. Parse text for measurements (existing)
2. Render each PDF page to a canvas image via pdfjs
3. Send page images to Vision AI asking: "Does this page contain a roof diagram? If yes, describe the geometry: outline vertices, labeled edges (ridge/hip/valley/eave/rake), facet areas, and pitch markings"
4. Store the diagram page image in Supabase Storage
5. Store the structured geometry JSON alongside the report
6. When AI measurement runs later, it can reference this exact geometry to replicate the roof shape

### Files to Modify

| File | Change |
|------|--------|
| `src/components/settings/RoofTrainingLab.tsx` | Add BulkReportImporter next to "New Training Session" button, wire refetch |
| `supabase/functions/roof-report-ingest/index.ts` | Add diagram page detection, image rendering, storage upload, and geometry extraction via Vision AI |
| Database migration | Add `diagram_image_url` and `diagram_geometry` columns to `roof_vendor_reports` |

### Technical Detail: Diagram Extraction Prompt

The Vision AI will receive each PDF page image with instructions to:
- Identify pages with roof plan-view diagrams (bird's-eye drawings showing facets, edges, dimensions)
- Extract vertex coordinates (relative to image), edge types (ridge/hip/valley/eave/rake), facet labels, and dimension annotations
- Return structured JSON that the AI measurement system can use to reconstruct the exact roof geometry

This means when a user later clicks "AI Measurement," the system already has vendor-verified geometry to compare against or replicate directly.

