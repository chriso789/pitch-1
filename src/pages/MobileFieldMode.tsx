import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveTenantId } from '@/hooks/useActiveTenantId';
import { useMobileCache } from '@/hooks/useMobileCache';
import { logMobileActivity } from '@/lib/mobileActivityLogger';
import { getPendingSyncCount } from '@/lib/mobileCache';
import { useState } from 'react';
import {
  Camera, FileText, RefreshCw, Phone, MapPin,
  WifiOff, CloudOff, Bell, ChevronRight, Briefcase, Calendar,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { format } from 'date-fns';

const MobileFieldMode = () => {
  const { user } = useAuth();
  const { activeTenantId } = useActiveTenantId();
  const navigate = useNavigate();
  const [pendingCount, setPendingCount] = useState(0);
  const { isOffline } = useMobileCache('jobs');

  useEffect(() => {
    logMobileActivity({ activity_type: 'field_mode_opened' });
    getPendingSyncCount().then(setPendingCount);
  }, []);

  const today = format(new Date(), 'yyyy-MM-dd');

  // Today's appointments
  const { data: appointments = [] } = useQuery<any[]>({
    queryKey: ['field-appointments', user?.id, today],
    queryFn: async () => {
      const result = await (supabase
        .from('appointments') as any)
        .select('*')
        .eq('user_id', user!.id)
        .gte('start_time', `${today}T00:00:00`)
        .lte('start_time', `${today}T23:59:59`)
        .order('start_time', { ascending: true });
      return result.data || [];
    },
    enabled: !!user?.id,
  });

  // Assigned jobs
  const { data: jobs = [] } = useQuery({
    queryKey: ['field-jobs', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('jobs')
        .select('id, job_number, status, contact_id')
        .eq('assigned_to', user!.id)
        .in('status', ['lead', 'contingency', 'ready_for_approval', 'production'])
        .order('updated_at', { ascending: false })
        .limit(10);
      return data || [];
    },
    enabled: !!user?.id,
  });

  // Unread alerts count
  const { data: alertCount = 0 } = useQuery({
    queryKey: ['field-alert-count', user?.id],
    queryFn: async () => {
      const { count } = await supabase
        .from('job_alerts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user!.id)
        .is('read_at', null);
      return count || 0;
    },
    enabled: !!user?.id,
  });

  const quickActions = [
    { icon: Camera, label: 'Photo', action: () => navigate('/storm-canvass/photos') },
    { icon: FileText, label: 'Note', action: () => {} },
    { icon: RefreshCw, label: 'Status', action: () => navigate('/jobs') },
    { icon: Phone, label: 'Call', action: () => navigate('/communications') },
    { icon: MapPin, label: 'Navigate', action: () => {} },
  ];

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-foreground">Field Mode</h1>
          <div className="flex items-center gap-2">
            {isOffline && (
              <span className="flex items-center gap-1 text-xs text-amber-500">
                <WifiOff className="h-3 w-3" /> Offline
              </span>
            )}
            {pendingCount > 0 && (
              <span className="flex items-center gap-1 text-xs text-amber-500">
                <CloudOff className="h-3 w-3" /> {pendingCount}
              </span>
            )}
            <Button variant="ghost" size="icon" onClick={() => navigate('/app/mobile/alerts')} className="relative">
              <Bell className="h-5 w-5" />
              {alertCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-[10px] w-4 h-4 rounded-full flex items-center justify-center">
                  {alertCount}
                </span>
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Quick Actions */}
        <div className="grid grid-cols-5 gap-2">
          {quickActions.map(({ icon: Icon, label, action }) => (
            <button
              key={label}
              onClick={action}
              className="flex flex-col items-center gap-1 p-3 rounded-xl bg-card border border-border hover:bg-muted/50 transition-colors"
            >
              <Icon className="h-5 w-5 text-primary" />
              <span className="text-[11px] text-muted-foreground">{label}</span>
            </button>
          ))}
        </div>

        {/* Today's Appointments */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Calendar className="h-4 w-4 text-primary" />
              Today's Appointments
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {appointments.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No appointments today</p>
            ) : (
              appointments.map((apt: any) => (
                <button
                  key={apt.id}
                  onClick={() => navigate(`/calendar`)}
                  className="w-full text-left flex items-center justify-between p-2 rounded-lg hover:bg-muted/50"
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {apt.title || 'Appointment'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(apt.start_time), 'h:mm a')}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              ))
            )}
          </CardContent>
        </Card>

        {/* Assigned Jobs */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-primary" />
              Assigned Jobs
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {jobs.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No active jobs</p>
            ) : (
              jobs.map((job: any) => (
                <button
                  key={job.id}
                  onClick={() => navigate(`/job/${job.id}`)}
                  className="w-full text-left flex items-center justify-between p-2 rounded-lg hover:bg-muted/50"
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      #{job.job_number}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {job.status?.replace(/_/g, ' ')}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default MobileFieldMode;
