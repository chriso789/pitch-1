import { supabase } from '@/integrations/supabase/client';

const ALLOWED_HOSTS = [
  'quickbooks.intuit.com',
  'connect.intuit.com',
  'app.qbo.intuit.com',
  'app.intuit.com',
  'intuit.com',
];

function isSafeHostedLink(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return false;
    return ALLOWED_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

/**
 * Resolve the hosted "pay this invoice" URL for a Pitch invoice.
 * Only returns a QuickBooks hosted link that the reconciler has verified
 * (invoice_link_status = 'available') and that is not voided.
 */
export async function resolveInvoicePayUrl(params: {
  tenantId: string;
  pipelineEntryId: string;
  invoiceNumber: string;
}): Promise<string | null> {
  const { tenantId, pipelineEntryId, invoiceNumber } = params;
  if (!tenantId || !pipelineEntryId || !invoiceNumber) return null;

  const { data, error } = await (supabase as any)
    .from('invoice_ar_mirror')
    .select('invoice_link, invoice_link_status, qbo_status')
    .eq('tenant_id', tenantId)
    .eq('project_id', pipelineEntryId)
    .eq('doc_number', invoiceNumber)
    .maybeSingle();

  if (error || !data) return null;
  if (data.invoice_link_status !== 'available') return null;
  if (['void', 'voided'].includes(String(data.qbo_status ?? '').toLowerCase())) return null;
  return isSafeHostedLink(data.invoice_link) ? (data.invoice_link as string) : null;
}
