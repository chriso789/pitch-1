import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DoorOpen, UserPlus, Camera, ChevronDown, ChevronUp } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

interface LiveStatsOverlayProps {
  distanceTraveled: number;
}

export default function LiveStatsOverlay({ distanceTraveled }: LiveStatsOverlayProps) {
  const { user } = useAuth();
  const [isCollapsed, setIsCollapsed] = useState(false);
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
    const interval = setInterval(fetchTodayStats, 30000); // Refresh every 30 seconds

    return () => clearInterval(interval);
  }, [user]);

  return (
    <Card className="absolute top-4 left-4 right-4 shadow-lg z-10">
      <div className="p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm">Today's Stats</h3>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="h-6 w-6"
          >
            {isCollapsed ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronUp className="h-3 w-3" />
            )}
          </Button>
        </div>

        {!isCollapsed && (
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex items-center gap-2">
              <DoorOpen className="h-4 w-4 text-primary" />
              <div>
                <p className="font-semibold">{stats.doorsKnocked}</p>
                <p className="text-xs text-muted-foreground">Doors</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-primary" />
              <div>
                <p className="font-semibold">{stats.leadsCreated}</p>
                <p className="text-xs text-muted-foreground">Leads</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Camera className="h-4 w-4 text-primary" />
              <div>
                <p className="font-semibold">{stats.photosUploaded}</p>
                <p className="text-xs text-muted-foreground">Photos</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="h-4 w-4 flex items-center justify-center text-primary font-bold">↔</div>
              <div>
                <p className="font-semibold">{distanceTraveled.toFixed(2)} mi</p>
                <p className="text-xs text-muted-foreground">Distance</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
