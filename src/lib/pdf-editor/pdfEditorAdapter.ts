/**
 * PDF Editor Adapter Interface
 * Abstract layer so Apryse (or any PDF SDK) can be swapped in without rewriting the module.
 */

export interface PdfEditorInstance {
  /** Load a PDF from a URL into the viewer */
  loadDocument(url: string): Promise<void>;
  /** Export current annotations as XFDF string */
  exportAnnotations(): Promise<string>;
  /** Import XFDF annotations onto the document */
  importAnnotations(xfdf: string): Promise<void>;
  /** Get current PDF as ArrayBuffer, optionally flattened */
  getFileData(options?: { flatten?: boolean }): Promise<ArrayBuffer>;
  /** Get currently selected text in the viewer */
  getSelectedText(): string;
  /** Insert text at the current cursor/selection */
  insertTextAtSelection(text: string): void;
  /** Apply pending redactions */
  applyRedaction(): Promise<void>;
  /** Get total page count */
  getPageCount(): number;
  /** Destroy the instance */
  dispose(): void;
}

export interface PdfEditorAdapterOptions {
  containerId: string;
  licenseKey?: string;
}

export type PdfEditorFactory = (options: PdfEditorAdapterOptions) => Promise<PdfEditorInstance | null>;

/**
 * Check if the Apryse license key is configured
 */
export function hasApryseKey(): boolean {
  return !!import.meta.env.VITE_APRYSE_LICENSE_KEY;
}

/**
 * Placeholder factory — returns null when no SDK is available.
 * Replace this with the real Apryse adapter when the key is provided.
 */
export const createPdfEditor: PdfEditorFactory = async (_options) => {
  if (!hasApryseKey()) {
    console.warn('[PdfEditor] No VITE_APRYSE_LICENSE_KEY found. Editor features disabled.');
    return null;
  }
  // When Apryse key exists, dynamically load the adapter
  try {
    const { createApryseEditor } = await import('./apryseAdapter');
    return createApryseEditor(_options);
  } catch (err) {
    console.error('[PdfEditor] Failed to load Apryse adapter:', err);
    return null;
  }
};
