import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface SmartTagValue {
  key: string;
  label: string;
  value: string;
  category: string;
}

export function usePdfSmartTags(pipelineEntryId?: string | null, estimateId?: string | null) {
  const tenantId = useEffectiveTenantId();

  return useQuery({
    queryKey: ['pdf-smart-tags', tenantId, pipelineEntryId, estimateId],
    queryFn: async (): Promise<SmartTagValue[]> => {
      const tags: SmartTagValue[] = [];

      // Company info from tenants
      if (tenantId) {
        const { data: tenant } = await (supabase as any)
          .from('tenants')
          .select('*')
          .eq('id', tenantId)
          .single();
        if (tenant) {
          tags.push(
            { key: 'company.name', label: 'Company Name', value: tenant.company_name || '', category: 'Company' },
            { key: 'company.phone', label: 'Company Phone', value: tenant.phone || '', category: 'Company' },
            { key: 'company.email', label: 'Company Email', value: tenant.email || '', category: 'Company' },
          );
        }
      }

      // Contact/job info from pipeline entry
      if (pipelineEntryId) {
        const { data: entry } = await (supabase as any)
          .from('pipeline_entries')
          .select('*, contacts!pipeline_entries_contact_id_fkey(*)')
          .eq('id', pipelineEntryId)
          .single();
        if (entry) {
          const contact = entry.contacts;
          if (contact) {
            tags.push(
              { key: 'customer.name', label: 'Customer Name', value: `${contact.first_name || ''} ${contact.last_name || ''}`.trim(), category: 'Customer' },
              { key: 'customer.email', label: 'Customer Email', value: contact.email || '', category: 'Customer' },
              { key: 'customer.phone', label: 'Customer Phone', value: contact.phone || '', category: 'Customer' },
            );
          }
          tags.push(
            { key: 'job.address', label: 'Job Address', value: entry.address || '', category: 'Job' },
            { key: 'job.city', label: 'Job City', value: entry.city || '', category: 'Job' },
            { key: 'job.state', label: 'Job State', value: entry.state || '', category: 'Job' },
            { key: 'job.zip', label: 'Job ZIP', value: entry.zip || '', category: 'Job' },
          );
        }
      }

      // Estimate info
      if (estimateId) {
        const { data: estimate } = await (supabase as any)
          .from('enhanced_estimates')
          .select('*')
          .eq('id', estimateId)
          .single();
        if (estimate) {
          tags.push(
            { key: 'estimate.number', label: 'Estimate #', value: estimate.estimate_number || '', category: 'Estimate' },
            { key: 'estimate.total', label: 'Estimate Total', value: estimate.selling_price ? `$${Number(estimate.selling_price).toLocaleString()}` : '', category: 'Estimate' },
            { key: 'estimate.display_name', label: 'Estimate Name', value: estimate.display_name || '', category: 'Estimate' },
          );
        }
      }

      return tags;
    },
    enabled: !!tenantId,
  });
}
