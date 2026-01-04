import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { DoorOpen, UserPlus, Camera, X, BarChart3 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

interface LiveStatsOverlayProps {
  distanceTraveled: number;
}

export default function LiveStatsOverlay({ distanceTraveled }: LiveStatsOverlayProps) {
  const { user } = useAuth();
  const [isExpanded, setIsExpanded] = useState(false);
  const [stats, setStats] = useState({
    doorsKnocked: 0,
    leadsCreated: 0,
    photosUploaded: 0,
  });

  useEffect(() => {
    if (!user) return;

    const fetchTodayStats = async () => {
      const { data: profile } = await supabase
        .from('profiles')
        .select('active_tenant_id, tenant_id')
        .eq('id', user.id)
        .single();

      const tenantId = profile?.active_tenant_id || profile?.tenant_id;
      if (!tenantId) return;

      const today = new Date().toISOString().split('T')[0];

      // Get door knocks
      const { count: doorKnocks } = await supabase
        .from('canvass_activity_log')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('activity_type', 'door_knock')
        .gte('created_at', today);

      // Get leads created
      const { count: leadsCreated } = await supabase
        .from('canvass_activity_log')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('activity_type', 'lead_created')
        .gte('created_at', today);

      // Get photos uploaded
      const { count: photosUploaded } = await supabase
        .from('canvass_activity_log')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('activity_type', 'photo_uploaded')
        .gte('created_at', today);

      setStats({
        doorsKnocked: doorKnocks || 0,
        leadsCreated: leadsCreated || 0,
        photosUploaded: photosUploaded || 0,
      });
    };

    fetchTodayStats();
    const interval = setInterval(fetchTodayStats, 30000);

    return () => clearInterval(interval);
  }, [user]);

  // Collapsed state - small floating badge
  if (!isExpanded) {
    return (
      <Button
        onClick={() => setIsExpanded(true)}
        className="absolute top-4 left-4 z-10 h-10 px-3 rounded-full shadow-lg bg-background/90 backdrop-blur-sm border border-border hover:bg-background"
        variant="outline"
      >
        <BarChart3 className="h-4 w-4 text-primary mr-2" />
        <span className="font-semibold text-foreground">{stats.doorsKnocked}</span>
        <span className="text-xs text-muted-foreground ml-1">doors</span>
      </Button>
    );
  }

  // Expanded state - compact stats panel
  return (
    <div className="absolute top-4 left-4 z-10 bg-background/95 backdrop-blur-sm rounded-xl shadow-lg border border-border p-3 min-w-[180px]">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Today's Stats</span>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsExpanded(false)}
          className="h-6 w-6 -mr-1"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <DoorOpen className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="font-bold text-base leading-none">{stats.doorsKnocked}</p>
            <p className="text-[10px] text-muted-foreground">Doors</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-green-500/10 flex items-center justify-center">
            <UserPlus className="h-4 w-4 text-green-500" />
          </div>
          <div>
            <p className="font-bold text-base leading-none">{stats.leadsCreated}</p>
            <p className="text-[10px] text-muted-foreground">Leads</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
            <Camera className="h-4 w-4 text-blue-500" />
          </div>
          <div>
            <p className="font-bold text-base leading-none">{stats.photosUploaded}</p>
            <p className="text-[10px] text-muted-foreground">Photos</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-orange-500/10 flex items-center justify-center">
            <span className="text-orange-500 text-sm font-bold">↔</span>
          </div>
          <div>
            <p className="font-bold text-base leading-none">{distanceTraveled.toFixed(1)}</p>
            <p className="text-[10px] text-muted-foreground">Miles</p>
          </div>
        </div>
      </div>
    </div>
  );
}
