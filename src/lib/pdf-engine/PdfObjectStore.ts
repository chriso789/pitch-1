/**
 * PITCH PDF Object Store
 * Persists parsed objects to Supabase pdf_engine_* tables.
 */

import { supabase } from '@/integrations/supabase/client';
import type { ParsedPage } from './PdfObjectParser';
import type { PdfEngineObject, PdfEnginePage } from './engineTypes';

/**
 * Persist parsed pages and text objects into the database.
 */
export async function persistParsedPages(
  pdfDocumentId: string,
  pages: ParsedPage[]
): Promise<{ pages: PdfEnginePage[]; objectCount: number }> {
  // 1. Upsert pages
  const pageRows = pages.map(p => ({
    pdf_document_id: pdfDocumentId,
    page_number: p.page_number,
    width: p.width,
    height: p.height,
    rotation: p.rotation,
    extracted_text: p.full_text,
    metadata: {},
  }));

  const { data: insertedPages, error: pageErr } = await (supabase as any)
    .from('pdf_engine_pages')
    .upsert(pageRows, { onConflict: 'pdf_document_id,page_number' })
    .select('id, page_number');

  if (pageErr) throw pageErr;

  const pageIdMap = new Map<number, string>();
  (insertedPages || []).forEach((p: any) => pageIdMap.set(p.page_number, p.id));

  // 2. Build object rows from text items
  const objectRows: any[] = [];
  let keyCounter = 0;

  for (const page of pages) {
    const pageId = pageIdMap.get(page.page_number);
    if (!pageId) continue;

    for (const item of page.text_items) {
      keyCounter++;
      objectRows.push({
        pdf_document_id: pdfDocumentId,
        page_id: pageId,
        object_type: 'text',
        object_key: `txt_${keyCounter}`,
        bounds: { x: item.x, y: item.y, width: item.width, height: item.height },
        transform: item.transform ? { matrix: item.transform } : {},
        content: { text: item.str },
        font_info: {
          fontFamily: item.fontName || null,
          fontSize: item.fontSize || null,
        },
        z_index: 0,
        is_editable: true,
        metadata: { page_number: page.page_number },
      });
    }
  }

  // 3. Batch insert objects in chunks
  const CHUNK = 500;
  for (let i = 0; i < objectRows.length; i += CHUNK) {
    const chunk = objectRows.slice(i, i + CHUNK);
    const { error } = await (supabase as any)
      .from('pdf_engine_objects')
      .insert(chunk);
    if (error) console.error('[PdfObjectStore] batch insert error:', error);
  }

  // 4. Update document page count and status
  await (supabase as any)
    .from('pdf_documents')
    .update({ page_count: pages.length, status: 'parsed' })
    .eq('id', pdfDocumentId);

  return { pages: insertedPages || [], objectCount: objectRows.length };
}

/**
 * Load objects for a document from the database.
 */
export async function loadDocumentObjects(pdfDocumentId: string): Promise<PdfEngineObject[]> {
  const { data, error } = await (supabase as any)
    .from('pdf_engine_objects')
    .select('*')
    .eq('pdf_document_id', pdfDocumentId)
    .order('z_index');
  if (error) throw error;
  return data || [];
}

/**
 * Load pages for a document.
 */
export async function loadDocumentPages(pdfDocumentId: string): Promise<PdfEnginePage[]> {
  const { data, error } = await (supabase as any)
    .from('pdf_engine_pages')
    .select('*')
    .eq('pdf_document_id', pdfDocumentId)
    .order('page_number');
  if (error) throw error;
  return data || [];
}
