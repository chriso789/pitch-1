// Heuristic PDF size estimator before building the actual PDF.
// Returns bytes. Coarse but useful for the QA pre-upload screen.

export interface PdfSizeEstimateInput {
  pageCount: number;
  colorPages: number;
  bwPages: number;
  dpi: number;        // target image DPI
  jpegQuality: number; // 0..1
  avgPageInchesW: number;
  avgPageInchesH: number;
}

export function estimatePdfSizeBytes(i: PdfSizeEstimateInput): number {
  if (i.pageCount === 0) return 0;
  // Rough bytes-per-pixel by mode/quality (empirical for JPEG-in-PDF).
  const bppColor = 0.18 + 0.55 * Math.max(0, i.jpegQuality - 0.4); // ~0.18..0.5
  const bppBw    = 0.06 + 0.20 * Math.max(0, i.jpegQuality - 0.4); // ~0.06..0.2

  const pxPerPage = i.avgPageInchesW * i.dpi * i.avgPageInchesH * i.dpi;
  const colorBytes = i.colorPages * pxPerPage * bppColor;
  const bwBytes    = i.bwPages    * pxPerPage * bppBw;
  // Add a ~3% PDF container overhead.
  return Math.round((colorBytes + bwBytes) * 1.03);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
