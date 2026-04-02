import React, { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useActiveTenantId } from '@/hooks/useActiveTenantId';
import { Eye } from 'lucide-react';

/**
 * Subscribes to Supabase Realtime for document view events.
 * Shows a toast notification when a homeowner views a document packet.
 * Mount this component once in your layout or SmartDocs page.
 */
export const ViewNotificationBanner: React.FC = () => {
  const { activeTenantId } = useActiveTenantId();
  const { toast } = useToast();

  useEffect(() => {
    if (!activeTenantId) return;

    const channel = supabase
      .channel('doc-view-events')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'document_view_events',
          filter: `tenant_id=eq.${activeTenantId}`,
        },
        (payload) => {
          const { viewer_name, document_name } = payload.new as any;
          toast({
            title: '📄 Document Viewed',
            description: `${viewer_name || 'A homeowner'} just viewed "${document_name || 'your document'}"`,
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeTenantId, toast]);

  return null; // Invisible component — only produces toasts
};
