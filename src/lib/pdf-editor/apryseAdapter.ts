/**
 * Apryse WebViewer Adapter
 * Implements PdfEditorInstance using Apryse/PDFTron WebViewer.
 * This file is only loaded when VITE_APRYSE_LICENSE_KEY is set.
 */

import type { PdfEditorInstance, PdfEditorAdapterOptions } from './pdfEditorAdapter';

export async function createApryseEditor(_options: PdfEditorAdapterOptions): Promise<PdfEditorInstance> {
  // Apryse WebViewer would be initialized here
  // For now, this is a stub that throws — it will be implemented
  // when the Apryse npm package is installed and the license key is provided.
  throw new Error(
    'Apryse WebViewer is not yet installed. ' +
    'Install @pdftron/webviewer and implement this adapter.'
  );
}
