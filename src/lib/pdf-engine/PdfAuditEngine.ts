/**
 * PITCH PDF Audit Engine
 * Tracks all significant PDF engine events for compliance and history.
 */

import { supabase } from '@/integrations/supabase/client';

export type PdfAuditEventType =
  | 'template_created' | 'template_updated'
  | 'smart_field_bound' | 'object_moved' | 'object_resized' | 'object_deleted'
  | 'text_replaced' | 'form_field_updated'
  | 'ocr_started' | 'ocr_completed'
  | 'redaction_marked' | 'redaction_applied'
  | 'pdf_compiled' | 'version_restored' | 'document_exported';

export interface PdfAuditEvent {
  id: string;
  tenant_id: string;
  pdf_document_id: string | null;
  actor_id: string | null;
  event_type: string;
  event_payload: Record<string, unknown>;
  created_at: string;
}

export class PdfAuditEngine {
  static async log(
    tenantId: string,
    actorId: string,
    eventType: PdfAuditEventType,
    payload: Record<string, unknown> = {},
    pdfDocumentId?: string
  ): Promise<void> {
    try {
      await (supabase as any).from('pdf_audit_events').insert({
        tenant_id: tenantId,
        pdf_document_id: pdfDocumentId || null,
        actor_id: actorId,
        event_type: eventType,
        event_payload: payload,
      });
    } catch (err) {
      console.warn('[PdfAuditEngine] Failed to log event:', err);
    }
  }

  static async getEvents(
    tenantId: string,
    pdfDocumentId?: string,
    limit = 50
  ): Promise<PdfAuditEvent[]> {
    let query = (supabase as any)
      .from('pdf_audit_events')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (pdfDocumentId) {
      query = query.eq('pdf_document_id', pdfDocumentId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }
}
