/**
 * PITCH PDF Search Indexer
 * Index all text objects for fast full-text search across PDFs.
 * Uses PostgreSQL tsvector for efficient querying.
 */

import { supabase } from '@/integrations/supabase/client';

export interface SearchResult {
  id: string;
  pdfDocumentId: string;
  pageId: string | null;
  objectId: string | null;
  text: string;
  rank: number;
}

export class PdfSearchIndexer {
  /**
   * Index all text objects for a document.
   */
  static async indexDocument(
    pdfDocumentId: string,
    objects: Array<{ id: string; page_id: string; content: Record<string, unknown> }>
  ): Promise<number> {
    // Clear existing index for this document
    await (supabase as any)
      .from('pdf_search_index')
      .delete()
      .eq('pdf_document_id', pdfDocumentId);

    const rows = objects
      .filter(o => (o.content as any)?.text)
      .map(o => ({
        pdf_document_id: pdfDocumentId,
        page_id: o.page_id,
        object_id: o.id,
        searchable_text: (o.content as any).text,
      }));

    if (rows.length === 0) return 0;

    // Batch insert in chunks of 100
    const chunkSize = 100;
    let indexed = 0;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error } = await (supabase as any)
        .from('pdf_search_index')
        .insert(chunk);
      if (error) {
        console.warn('[PdfSearchIndexer] Batch error:', error);
      } else {
        indexed += chunk.length;
      }
    }

    return indexed;
  }

  /**
   * Search across all PDFs for a tenant using full-text search.
   */
  static async search(
    query: string,
    tenantId: string,
    options?: { pdfDocumentId?: string; limit?: number }
  ): Promise<SearchResult[]> {
    // Build tsquery from user input
    const tsquery = query
      .trim()
      .split(/\s+/)
      .map(w => `${w}:*`)
      .join(' & ');

    let rpcQuery = (supabase as any).rpc('search_pdf_documents', {
      search_query: tsquery,
      tenant_id_param: tenantId,
      doc_id_param: options?.pdfDocumentId || null,
      result_limit: options?.limit || 50,
    });

    const { data, error } = await rpcQuery;

    if (error) {
      // Fallback to ILIKE if RPC not available
      console.warn('[PdfSearchIndexer] RPC search failed, using fallback:', error);
      return this.fallbackSearch(query, tenantId, options);
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      pdfDocumentId: row.pdf_document_id,
      pageId: row.page_id,
      objectId: row.object_id,
      text: row.searchable_text,
      rank: row.rank || 0,
    }));
  }

  /**
   * Fallback ILIKE search when RPC is not available.
   */
  private static async fallbackSearch(
    query: string,
    tenantId: string,
    options?: { pdfDocumentId?: string; limit?: number }
  ): Promise<SearchResult[]> {
    let q = (supabase as any)
      .from('pdf_search_index')
      .select('id, pdf_document_id, page_id, object_id, searchable_text')
      .ilike('searchable_text', `%${query}%`)
      .limit(options?.limit || 50);

    if (options?.pdfDocumentId) {
      q = q.eq('pdf_document_id', options.pdfDocumentId);
    }

    const { data, error } = await q;
    if (error) throw error;

    return (data || []).map((row: any) => ({
      id: row.id,
      pdfDocumentId: row.pdf_document_id,
      pageId: row.page_id,
      objectId: row.object_id,
      text: row.searchable_text,
      rank: 1,
    }));
  }

  /**
   * Get search result count for a document.
   */
  static async getIndexedCount(pdfDocumentId: string): Promise<number> {
    const { count, error } = await (supabase as any)
      .from('pdf_search_index')
      .select('id', { count: 'exact', head: true })
      .eq('pdf_document_id', pdfDocumentId);

    if (error) return 0;
    return count || 0;
  }

  /**
   * Highlight matching text in a search result.
   */
  static highlightMatch(text: string, query: string): string {
    if (!query) return text;
    const words = query.split(/\s+/).filter(w => w.length > 0);
    let result = text;
    for (const word of words) {
      const regex = new RegExp(`(${word})`, 'gi');
      result = result.replace(regex, '<mark>$1</mark>');
    }
    return result;
  }
}
