import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface SmsBlastMetrics {
  total: number;
  pending: number;
  rendered: number;
  skippedMissingAddress: number;
  skippedOptOut: number;
  sending: number;
  sent: number;
  delivered: number;
  failed: number;
  replied: number;
  emailCaptured: number;
  hasMissingAddress: boolean;
  allRenderedHaveAddressSnapshot: boolean;
  allRenderedHavePersonalizedMessage: boolean;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const EMPTY: Omit<SmsBlastMetrics, 'refetch' | 'loading' | 'error'> = {
  total: 0, pending: 0, rendered: 0, skippedMissingAddress: 0, skippedOptOut: 0,
  sending: 0, sent: 0, delivered: 0, failed: 0, replied: 0, emailCaptured: 0,
  hasMissingAddress: false,
  allRenderedHaveAddressSnapshot: true,
  allRenderedHavePersonalizedMessage: true,
};

export function useSmsBlastMetrics(blastId: string | null, tenantId: string | null): SmsBlastMetrics {
  const [state, setState] = useState<Omit<SmsBlastMetrics, 'refetch'>>({
    ...EMPTY, loading: false, error: null,
  });

  const load = useCallback(async () => {
    if (!blastId || !tenantId) {
      setState({ ...EMPTY, loading: false, error: null });
      return;
    }
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      // 1. Items grouped by status + snapshot completeness
      const { data: items, error: itemsErr } = await (supabase
        .from('sms_blast_items') as any)
        .select('status, personalized_message, address_street_snapshot')
        .eq('blast_id', blastId)
        .eq('tenant_id', tenantId)
        .limit(10000);
      if (itemsErr) throw itemsErr;

      const m = { ...EMPTY };
      const rows = (items || []) as any[];
      m.total = rows.length;

      let renderedNoAddr = 0;
      let renderedNoMsg = 0;
      let renderedCount = 0;

      for (const r of rows) {
        const s = String(r.status || '');
        if (s === 'pending' || s === 'claimed') m.pending++;
        if (s === 'skipped_missing_address') { m.skippedMissingAddress++; m.hasMissingAddress = true; }
        if (s === 'skipped_opt_out' || s === 'opted_out') m.skippedOptOut++;
        if (s === 'sending') m.sending++;
        if (s === 'sent') m.sent++;
        if (s === 'delivered') m.delivered++;
        if (s === 'failed' || s === 'cancelled') m.failed++;
        if (s === 'replied') m.replied++;

        const isRendered = !!r.personalized_message && !['skipped_opt_out', 'skipped_missing_address', 'failed', 'cancelled', 'opted_out'].includes(s);
        if (isRendered) {
          renderedCount++;
          if (!r.address_street_snapshot) renderedNoAddr++;
          if (!r.personalized_message) renderedNoMsg++;
        }
      }
      m.rendered = renderedCount;
      m.allRenderedHaveAddressSnapshot = renderedCount === 0 || renderedNoAddr === 0;
      m.allRenderedHavePersonalizedMessage = renderedCount === 0 || renderedNoMsg === 0;

      // 2. Inbound replies on this blast
      const { count: inboundCount } = await (supabase
        .from('sms_messages') as any)
        .select('id', { count: 'exact', head: true })
        .eq('blast_id', blastId)
        .eq('tenant_id', tenantId)
        .eq('direction', 'inbound');
      void inboundCount;

      // 3. Email capture — try pipeline_entries.status first, fallback to sms_messages.metadata
      let emailCaptured = 0;
      try {
        const { count: pipelineCaptured } = await (supabase
          .from('pipeline_entries') as any)
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .eq('status', 'roof_estimate_email_captured');
        if (typeof pipelineCaptured === 'number') emailCaptured = pipelineCaptured;
      } catch { /* ignore */ }

      if (emailCaptured === 0) {
        try {
          const { data: msgs } = await (supabase
            .from('sms_messages') as any)
            .select('metadata')
            .eq('blast_id', blastId)
            .eq('tenant_id', tenantId)
            .eq('direction', 'inbound')
            .not('metadata', 'is', null)
            .limit(5000);
          for (const row of (msgs || [])) {
            const meta = row?.metadata;
            if (meta && typeof meta === 'object' && (meta as any).captured_email) emailCaptured++;
          }
        } catch { /* ignore */ }
      }
      m.emailCaptured = emailCaptured;

      setState({ ...m, loading: false, error: null });
    } catch (e: any) {
      setState(s => ({ ...s, loading: false, error: String(e?.message || e) }));
    }
  }, [blastId, tenantId]);

  useEffect(() => { load(); }, [load]);

  return { ...state, refetch: load };
}

export default useSmsBlastMetrics;
