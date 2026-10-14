/**
 * PDF Studio tool switches, stored per company in `tenant_pdf_tool_settings`.
 * The database refuses to save a PDF version made with a tool that is off for that company
 * (`documents_pdf_tool_guard`), so these checks only decide what is shown. There is no browser override.
 * Page tools are on by default; every other tool is off until a company admin turns it on.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';

export type PdfTool = 'pageTools' | 'compare' | 'ocr' | 'protect' | 'batch' | 'health';
export const PDF_TOOLS: { tool: PdfTool; label: string; note: string }[] = [
  { tool: 'pageTools', label: 'Page tools, markup, text editing & Fill & Sign', note: 'Organize pages, mark up, edit text, fill forms' },
  { tool: 'compare', label: 'Compare revisions', note: 'Side-by-side drawing comparison' },
  { tool: 'ocr', label: 'Scan to text & Convert to PDF', note: 'Make scans searchable, turn photos/Word into PDF' },
  { tool: 'protect', label: 'Protect & Redact', note: 'Passwords and permanent black-out' },
  { tool: 'batch', label: 'Batch tasks', note: 'Run steps on many PDFs at once' },
  { tool: 'health', label: 'Compress & Repair', note: 'Shrink and fix damaged files' },
];
export const PDF_TOOL_DEFAULT: Record<PdfTool, boolean> = { pageTools: true, compare: false, ocr: false, protect: false, batch: false, health: false };

let state: { tenantId: string | null; enabled: Record<PdfTool, boolean> } = { tenantId: null, enabled: { pageTools: false, compare: false, ocr: false, protect: false, batch: false, health: false } };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export async function loadPdfToolSettings(tenantId: string) {
  const { data, error } = await (supabase as any).from('tenant_pdf_tool_settings').select('tool, enabled').eq('tenant_id', tenantId);
  const enabled = { ...PDF_TOOL_DEFAULT };
  if (!error) for (const r of data ?? []) if (r.tool in enabled) enabled[r.tool as PdfTool] = !!r.enabled;
  state = { tenantId, enabled };
  emit();
}

/** Call in any component that shows PDF tools so it re-renders when the company's switches load or change. */
export function usePdfToolGate() {
  const tenantId = useEffectiveTenantId();
  useEffect(() => { if (tenantId && state.tenantId !== tenantId) loadPdfToolSettings(tenantId); }, [tenantId]);
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => state);
}

export function isPdfToolEnabled(tool: PdfTool): boolean { return state.enabled[tool] === true; }
export const isPageToolsEnabled = () => isPdfToolEnabled('pageTools');
export const isCompareEnabled = () => isPdfToolEnabled('compare');
/** Also gates Convert to PDF. */
export const isOcrEnabled = () => isPdfToolEnabled('ocr');
/** Also gates Redact. */
export const isProtectEnabled = () => isPdfToolEnabled('protect');
export const isBatchEnabled = () => isPdfToolEnabled('batch');
export const isHealthEnabled = () => isPdfToolEnabled('health');
