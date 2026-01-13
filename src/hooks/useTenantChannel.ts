/**
 * Tenant-Scoped Realtime Channel Hook
 * Phase 3: Realtime Channel Management
 * 
 * Uses tenant-scoped channels instead of per-record channels.
 * This dramatically reduces channel count at scale:
 * - Before: 1 channel per job = 50K channels for 50K jobs
 * - After: 1 channel per tenant = 500 channels for 500 tenants
 */

import { useEffect, useRef, useCallback } from 'react';
import { useEffectiveTenantId } from './useEffectiveTenantId';
import { supabase } from '@/integrations/supabase/client';

type PostgresChangeEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*';

interface UseTenantChannelOptions<T = any> {
  /** Table name to subscribe to */
  table: string;
  /** Event type to listen for */
  event?: PostgresChangeEvent;
  /** Optional filter to narrow down which records to process */
  filter?: (payload: any) => boolean;
  /** Callback when a matching change occurs */
  onPayload: (data: T, event: PostgresChangeEvent) => void;
  /** Whether the subscription is enabled */
  enabled?: boolean;
}

/**
 * Subscribe to tenant-scoped realtime changes
 * 
 * @example
 * ```tsx
 * useTenantChannel({
 *   table: 'jobs',
 *   event: 'UPDATE',
 *   filter: (payload) => payload.new.id === jobId,
 *   onPayload: (job) => setJob(job),
 * });
 * ```
 */
export function useTenantChannel<T = any>({
  table,
  event = '*',
  filter,
  onPayload,
  enabled = true,
}: UseTenantChannelOptions<T>): void {
  const tenantId = useEffectiveTenantId();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  
  // Stable callback ref to avoid recreating subscription
  const onPayloadRef = useRef(onPayload);
  onPayloadRef.current = onPayload;
  
  const filterRef = useRef(filter);
  filterRef.current = filter;

  useEffect(() => {
    if (!tenantId || !enabled) return;

    const channelName = `tenant-${tenantId}-${table}-${Date.now()}`;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes' as any,
        {
          event,
          schema: 'public',
          table,
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload: any) => {
          // Apply additional filter if provided
          if (filterRef.current && !filterRef.current(payload)) {
            return;
          }

          const data = (payload.new || payload.old) as T;
          const eventType = payload.eventType as PostgresChangeEvent;
          
          onPayloadRef.current(data, eventType);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`[useTenantChannel] Subscribed to ${table} for tenant ${tenantId}`);
        }
      });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [tenantId, table, event, enabled]);
}

/**
 * Subscribe to a specific record's changes via tenant channel
 * More efficient than per-record channels
 */
export function useRecordChannel<T = any>({
  table,
  recordId,
  onPayload,
  enabled = true,
}: {
  table: string;
  recordId: string | null;
  onPayload: (data: T, event: PostgresChangeEvent) => void;
  enabled?: boolean;
}): void {
  const recordFilter = useCallback(
    (payload: any) => {
      if (!recordId) return false;
      const data = payload.new || payload.old;
      return data?.id === recordId;
    },
    [recordId]
  );

  useTenantChannel({
    table,
    filter: recordFilter,
    onPayload,
    enabled: enabled && !!recordId,
  });
}
