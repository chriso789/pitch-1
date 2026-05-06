/**
 * Persist extracted PDF objects to the database.
 * Called after objectExtractor runs on upload.
 */

import { supabase } from '@/integrations/supabase/client';
import type { ExtractedPage } from './objectExtractor';

export async function persistExtractedPages(
  workspaceDocumentId: string,
  tenantId: string,
  pages: ExtractedPage[]
): Promise<void> {
  // 1. Insert pages
  const pageRows = pages.map(p => ({
    workspace_document_id: workspaceDocumentId,
    tenant_id: tenantId,
    page_number: p.page_number,
    width: p.width,
    height: p.height,
    rotation: 0,
    text_layer: p.text_items,
    thumbnail_path: null, // Could upload thumbnails to storage
  }));

  const { data: insertedPages, error: pageErr } = await (supabase as any)
    .from('pdf_pages')
    .upsert(pageRows, { onConflict: 'workspace_document_id,page_number' })
    .select('id, page_number');

  if (pageErr) throw pageErr;

  // 2. Insert text objects from each page
  const pageIdMap = new Map<number, string>();
  (insertedPages || []).forEach((p: any) => pageIdMap.set(p.page_number, p.id));

  const objectRows: any[] = [];
  for (const page of pages) {
    const pageId = pageIdMap.get(page.page_number);
    if (!pageId) continue;

    for (const item of page.text_items) {
      objectRows.push({
        page_id: pageId,
        workspace_document_id: workspaceDocumentId,
        tenant_id: tenantId,
        object_type: 'text',
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        content: item.str,
        font_family: item.fontName || null,
        font_size: item.fontSize || null,
        metadata: { page_number: page.page_number },
      });
    }
  }

  // Batch insert in chunks of 500
  const CHUNK = 500;
  for (let i = 0; i < objectRows.length; i += CHUNK) {
    const chunk = objectRows.slice(i, i + CHUNK);
    const { error } = await (supabase as any)
      .from('pdf_objects')
      .insert(chunk);
    if (error) {
      console.error('[persistObjects] Batch insert error:', error);
    }
  }

  // 3. Update page count on workspace document
  await (supabase as any)
    .from('pdf_workspace_documents')
    .update({ page_count: pages.length })
    .eq('id', workspaceDocumentId);
}
