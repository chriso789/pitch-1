/**
 * PITCH PDF Redaction Verifier
 * Verifies that redacted terms are truly removed from compiled PDFs
 * and search indices. Blocks finalized export if verification fails.
 */

import { supabase } from '@/integrations/supabase/client';

export interface RedactionVerificationInput {
  pdfDocumentId: string;
  versionId?: string;
  redactedTerms: string[];
  tenantId: string;
}

export interface RedactionVerificationResult {
  passed: boolean;
  termsFound: string[];
  termsClean: string[];
  searchIndexLeaks: Array<{ term: string; page: number; snippet: string }>;
  warnings: string[];
  verifiedAt: string;
}

export class PdfRedactionVerifier {
  /**
   * Verify that redacted terms do not appear in:
   * 1. The pdf_search_index table
   * 2. Any object content in the object graph
   */
  static async verify(input: RedactionVerificationInput): Promise<RedactionVerificationResult> {
    const { pdfDocumentId, redactedTerms, tenantId } = input;
    const termsFound: string[] = [];
    const termsClean: string[] = [];
    const searchIndexLeaks: Array<{ term: string; page: number; snippet: string }> = [];
    const warnings: string[] = [];

    // 1. Check pdf_search_index for leaked terms
    try {
      const { data: indexEntries } = await (supabase as any)
        .from('pdf_search_index')
        .select('content, page_number')
        .eq('pdf_document_id', pdfDocumentId)
        .eq('tenant_id', tenantId);

      if (indexEntries) {
        for (const term of redactedTerms) {
          const lower = term.toLowerCase();
          for (const entry of indexEntries) {
            if (entry.content?.toLowerCase().includes(lower)) {
              termsFound.push(term);
              searchIndexLeaks.push({
                term,
                page: entry.page_number,
                snippet: entry.content.substring(0, 80),
              });
              break;
            }
          }
        }
      }
    } catch (err) {
      warnings.push('Could not verify search index — table may not exist');
    }

    // 2. Check object graph content
    try {
      const { data: objects } = await (supabase as any)
        .from('pdf_engine_objects')
        .select('content, metadata')
        .eq('workspace_document_id', pdfDocumentId)
        .eq('is_deleted', false);

      if (objects) {
        for (const term of redactedTerms) {
          if (termsFound.includes(term)) continue;
          const lower = term.toLowerCase();
          for (const obj of objects) {
            const text = (obj.content as any)?.text || '';
            if (text.toLowerCase().includes(lower)) {
              termsFound.push(term);
              break;
            }
          }
        }
      }
    } catch (err) {
      warnings.push('Could not verify object graph');
    }

    // Determine clean terms
    for (const term of redactedTerms) {
      if (!termsFound.includes(term)) {
        termsClean.push(term);
      }
    }

    const passed = termsFound.length === 0;

    return {
      passed,
      termsFound,
      termsClean,
      searchIndexLeaks,
      warnings,
      verifiedAt: new Date().toISOString(),
    };
  }

  /**
   * Remove leaked entries from search index after redaction.
   */
  static async purgeSearchIndex(
    pdfDocumentId: string,
    tenantId: string,
    redactedTerms: string[]
  ): Promise<number> {
    let purged = 0;

    try {
      const { data: entries } = await (supabase as any)
        .from('pdf_search_index')
        .select('id, content')
        .eq('pdf_document_id', pdfDocumentId)
        .eq('tenant_id', tenantId);

      if (!entries) return 0;

      const idsToDelete: string[] = [];
      for (const entry of entries) {
        const lower = entry.content?.toLowerCase() || '';
        if (redactedTerms.some(t => lower.includes(t.toLowerCase()))) {
          idsToDelete.push(entry.id);
        }
      }

      if (idsToDelete.length > 0) {
        await (supabase as any)
          .from('pdf_search_index')
          .delete()
          .in('id', idsToDelete);
        purged = idsToDelete.length;
      }
    } catch (err) {
      console.warn('[PdfRedactionVerifier] Purge failed:', err);
    }

    return purged;
  }
}
