import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Bell, BellOff, ChevronRight, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { logMobileActivity } from '@/lib/mobileActivityLogger';
import { formatDistanceToNow } from 'date-fns';

const ALERT_ICONS: Record<string, string> = {
  new_lead_assigned: '🎯',
  appointment_reminder: '📅',
  inspection_due: '🔍',
  estimate_ready: '💰',
  contract_signed: '✅',
  document_uploaded: '📄',
  payment_received: '💳',
  task_assigned: '📋',
  job_status_changed: '🔄',
  storm_event_alert: '⛈️',
};

const MobileAlerts = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: alerts = [], isLoading, refetch } = useQuery({
    queryKey: ['mobile-alerts', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_alerts')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
  });

  const markRead = useMutation({
    mutationFn: async (alertId: string) => {
      await supabase
        .from('job_alerts')
        .update({ read_at: new Date().toISOString() })
        .eq('id', alertId);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mobile-alerts'] }),
  });

  const handleAlertTap = (alert: any) => {
    if (!alert.read_at) markRead.mutate(alert.id);
    logMobileActivity({ activity_type: 'alert_opened', entity_type: 'job_alert', entity_id: alert.id });

    if (alert.job_id) {
      navigate(`/job/${alert.job_id}`);
    }
  };

  const unreadCount = alerts.filter((a: any) => !a.read_at).length;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold text-foreground">Alerts</h1>
          {unreadCount > 0 && (
            <span className="bg-destructive text-destructive-foreground text-xs px-2 py-0.5 rounded-full">
              {unreadCount}
            </span>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="h-[calc(100vh-56px)]">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
            <BellOff className="h-10 w-10" />
            <p className="text-sm">No alerts yet</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {alerts.map((alert: any) => (
              <button
                key={alert.id}
                onClick={() => handleAlertTap(alert)}
                className={`w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-muted/50 transition-colors ${
                  !alert.read_at ? 'bg-primary/5' : ''
                }`}
              >
                <span className="text-xl mt-0.5">{ALERT_ICONS[alert.alert_type] || '🔔'}</span>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm ${!alert.read_at ? 'font-semibold text-foreground' : 'text-foreground'}`}>
                    {alert.title}
                  </p>
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{alert.body}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true })}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground mt-1 shrink-0" />
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
};

export default MobileAlerts;
