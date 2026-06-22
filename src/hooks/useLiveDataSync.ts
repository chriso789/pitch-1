import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';

/**
 * Global live-data sync. Subscribes once to estimates, change orders, payments,
 * and invoices and invalidates the related tanstack query keys so any open
 * screen reflects new data immediately — no page refresh required.
 *
 * Tanstack invalidates with partial key matches, so invalidating a single
 * top-level key (e.g. ['estimates']) refreshes every query whose key starts
 * with it ('estimates', 'enhanced_estimates', 'project-ar-invoices', ...).
 */
export function useLiveDataSync() {
  const qc = useQueryClient();
  const tenantId = useEffectiveTenantId();

  useEffect(() => {
    if (!tenantId) return;

    const invalidateEstimates = () => {
      qc.invalidateQueries({ queryKey: ['estimates'] });
      qc.invalidateQueries({ queryKey: ['enhanced_estimates'] });
      qc.invalidateQueries({ queryKey: ['enhanced-estimates'] });
      qc.invalidateQueries({ queryKey: ['estimate'] });
      qc.invalidateQueries({ queryKey: ['saved-estimates'] });
      qc.invalidateQueries({ queryKey: ['profit-center'] });
      qc.invalidateQueries({ queryKey: ['pipeline-entries'] });
      qc.invalidateQueries({ queryKey: ['pipeline'] });
      qc.invalidateQueries({ queryKey: ['ar-projects'] });
      qc.invalidateQueries({ queryKey: ['financials'] });
      qc.invalidateQueries({ queryKey: ['commissions'] });
    };

    const invalidatePayments = () => {
      qc.invalidateQueries({ queryKey: ['project-ar-payments'] });
      qc.invalidateQueries({ queryKey: ['project-ar-invoices'] });
      qc.invalidateQueries({ queryKey: ['ar-payments'] });
      qc.invalidateQueries({ queryKey: ['ar-invoices'] });
      qc.invalidateQueries({ queryKey: ['ar-projects'] });
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['payment-history'] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['rpd-invoices'] });
      qc.invalidateQueries({ queryKey: ['zelle-payment-links'] });
      qc.invalidateQueries({ queryKey: ['financials'] });
    };

    const invalidateChangeOrders = () => {
      qc.invalidateQueries({ queryKey: ['change-orders'] });
      qc.invalidateQueries({ queryKey: ['change_orders'] });
      qc.invalidateQueries({ queryKey: ['ar-projects'] });
    };

    const channel = supabase
      .channel('live-data-sync')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'enhanced_estimates', filter: `tenant_id=eq.${tenantId}` },
        invalidateEstimates)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'estimates' },
        invalidateEstimates)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'project_payments', filter: `tenant_id=eq.${tenantId}` },
        invalidatePayments)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'project_invoices', filter: `tenant_id=eq.${tenantId}` },
        invalidatePayments)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'change_orders' },
        invalidateChangeOrders)
      .subscribe();

    const onPaymentEvent = () => invalidatePayments();
    const onEstimateEvent = () => invalidateEstimates();
    window.addEventListener('project-payment-recorded', onPaymentEvent);
    window.addEventListener('estimate-updated', onEstimateEvent);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener('project-payment-recorded', onPaymentEvent);
      window.removeEventListener('estimate-updated', onEstimateEvent);
    };
  }, [tenantId, qc]);
}
