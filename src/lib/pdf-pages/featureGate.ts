/**
 * Single registry for PDF Studio rollout switches. Preview/dev: everything on.
 * Production: each tool stays off until its signed-in acceptance test passes (see docs/PDF_FEATURE_MATRIX.md);
 * a per-browser override `localStorage['pitch.<key>']` exists for acceptance testing only.
 * Planned: replace the browser override with a tenant-scoped flag table (docs/PDF_MASTER_ROADMAP.md).
 */
const PROD_HOSTS = ['pitch-crm.ai', 'www.pitch-crm.ai', 'pitch-1.lovable.app'];
export type PdfTool = 'pageTools' | 'compare' | 'ocr' | 'protect' | 'batch' | 'health';
/** Production default per tool; pageTools is the only one released (opt-out). */
export const PDF_TOOL_PROD_DEFAULT: Record<PdfTool, boolean> = { pageTools: true, compare: false, ocr: false, protect: false, batch: false, health: false };

export function isPdfToolEnabled(tool: PdfTool): boolean {
  if (typeof window === 'undefined') return false;
  if (!PROD_HOSTS.includes(window.location.hostname)) return true;
  try {
    const v = window.localStorage.getItem(`pitch.${tool}`);
    return v === null ? PDF_TOOL_PROD_DEFAULT[tool] : v === '1';
  } catch { return PDF_TOOL_PROD_DEFAULT[tool]; }
}
export const isPageToolsEnabled = () => isPdfToolEnabled('pageTools');
export const isCompareEnabled = () => isPdfToolEnabled('compare');
/** Also gates Convert to PDF. */
export const isOcrEnabled = () => isPdfToolEnabled('ocr');
/** Also gates Redact. */
export const isProtectEnabled = () => isPdfToolEnabled('protect');
export const isBatchEnabled = () => isPdfToolEnabled('batch');
export const isHealthEnabled = () => isPdfToolEnabled('health');
