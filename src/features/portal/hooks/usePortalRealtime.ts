import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { RealtimeChannel } from '@supabase/supabase-js';

interface PortalUpdate {
  type: 'project_status' | 'photo_added' | 'estimate_updated' | 'message_received' | 'milestone_completed';
  data: any;
  timestamp: string;
}

interface UsePortalRealtimeOptions {
  contactId: string;
  projectId?: string;
  onUpdate?: (update: PortalUpdate) => void;
}

export const usePortalRealtime = ({
  contactId,
  projectId,
  onUpdate,
}: UsePortalRealtimeOptions) => {
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<PortalUpdate | null>(null);
  const [updates, setUpdates] = useState<PortalUpdate[]>([]);

  const handleUpdate = useCallback((update: PortalUpdate) => {
    setLastUpdate(update);
    setUpdates((prev) => [update, ...prev].slice(0, 50)); // Keep last 50 updates
    onUpdate?.(update);
  }, [onUpdate]);

  useEffect(() => {
    if (!contactId) return;

    let channel: RealtimeChannel;

    const setupRealtime = async () => {
      // Subscribe to project changes
      channel = supabase
        .channel(`portal-updates-${contactId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'projects',
            filter: projectId ? `id=eq.${projectId}` : undefined,
          },
          (payload) => {
            handleUpdate({
              type: 'project_status',
              data: payload.new,
              timestamp: new Date().toISOString(),
            });
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'canvass_activity_log',
            filter: `contact_id=eq.${contactId}`,
          },
          (payload) => {
            const activityData = payload.new as any;
            if (activityData.activity_type === 'photo_capture') {
              handleUpdate({
                type: 'photo_added',
                data: activityData,
                timestamp: new Date().toISOString(),
              });
            }
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'estimates',
            filter: projectId ? `project_id=eq.${projectId}` : undefined,
          },
          (payload) => {
            handleUpdate({
              type: 'estimate_updated',
              data: payload.new,
              timestamp: new Date().toISOString(),
            });
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'sms_conversations',
            filter: `contact_id=eq.${contactId}`,
          },
          (payload) => {
            handleUpdate({
              type: 'message_received',
              data: payload.new,
              timestamp: new Date().toISOString(),
            });
          }
        )
        .on('broadcast', { event: 'milestone_completed' }, (payload) => {
          handleUpdate({
            type: 'milestone_completed',
            data: payload.payload,
            timestamp: new Date().toISOString(),
          });
        })
        .subscribe((status) => {
          setIsConnected(status === 'SUBSCRIBED');
        });
    };

    setupRealtime();

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [contactId, projectId, handleUpdate]);

  const clearUpdates = useCallback(() => {
    setUpdates([]);
    setLastUpdate(null);
  }, []);

  return {
    isConnected,
    lastUpdate,
    updates,
    clearUpdates,
  };
};
