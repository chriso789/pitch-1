import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { DoorOpen, UserPlus, Camera, X, BarChart3, Route } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { useDeviceLayout } from '@/hooks/useDeviceLayout';

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
  
  const layout = useDeviceLayout();

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


  // Icon size based on device
  const iconContainerClass = layout.isTablet || layout.isDesktop
    ? 'h-10 w-10 rounded-lg'
    : 'h-8 w-8 rounded-lg';
  
  const iconClass = layout.isTablet || layout.isDesktop
    ? 'h-5 w-5'
    : 'h-4 w-4';

  const statValueClass = layout.isTablet || layout.isDesktop
    ? 'font-bold text-lg leading-none'
    : 'font-bold text-base leading-none';

  return (
    <AnimatePresence mode="wait">
      {!isExpanded ? (
        // Collapsed state - small floating badge
        <motion.div
          key="collapsed"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          className="relative z-10"
        >
          <Button
            onClick={() => setIsExpanded(true)}
            className="h-10 px-3 rounded-full shadow-lg bg-background/90 backdrop-blur-sm border border-border hover:bg-background transition-colors"
            variant="outline"
          >
            <BarChart3 className="h-4 w-4 text-primary mr-2" />
            <span className="font-semibold text-foreground">{stats.doorsKnocked}</span>
            <span className="text-xs text-muted-foreground ml-1">doors</span>
          </Button>
        </motion.div>
      ) : (
        // Expanded state - responsive stats panel
        <motion.div 
          key="expanded"
          initial={{ opacity: 0, scale: 0.95, y: -8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -8 }}
          transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
          className="absolute top-full left-0 mt-2 z-10 bg-background/95 backdrop-blur-sm rounded-xl shadow-lg border border-border p-3"
          style={{
            minWidth: layout.isTablet || layout.isDesktop ? '280px' : '180px',
          }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Today's Stats
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsExpanded(false)}
              className="h-6 w-6 -mr-1"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div 
            className={cn(
              'grid gap-3',
              layout.statsGridCols === 4 ? 'grid-cols-4' : 'grid-cols-2'
            )}
          >
            {/* Doors Knocked */}
            <div className="flex items-center gap-2">
              <div className={cn(iconContainerClass, 'bg-primary/10 flex items-center justify-center')}>
                <DoorOpen className={cn(iconClass, 'text-primary')} />
              </div>
              <div>
                <p className={statValueClass}>{stats.doorsKnocked}</p>
                <p className="text-[10px] text-muted-foreground">Doors</p>
              </div>
            </div>

            {/* Leads Created */}
            <div className="flex items-center gap-2">
              <div className={cn(iconContainerClass, 'bg-green-500/10 flex items-center justify-center')}>
                <UserPlus className={cn(iconClass, 'text-green-500')} />
              </div>
              <div>
                <p className={statValueClass}>{stats.leadsCreated}</p>
                <p className="text-[10px] text-muted-foreground">Leads</p>
              </div>
            </div>

            {/* Photos Uploaded */}
            <div className="flex items-center gap-2">
              <div className={cn(iconContainerClass, 'bg-blue-500/10 flex items-center justify-center')}>
                <Camera className={cn(iconClass, 'text-blue-500')} />
              </div>
              <div>
                <p className={statValueClass}>{stats.photosUploaded}</p>
                <p className="text-[10px] text-muted-foreground">Photos</p>
              </div>
            </div>

            {/* Distance Traveled */}
            <div className="flex items-center gap-2">
              <div className={cn(iconContainerClass, 'bg-orange-500/10 flex items-center justify-center')}>
                <Route className={cn(iconClass, 'text-orange-500')} />
              </div>
              <div>
                <p className={statValueClass}>{distanceTraveled.toFixed(1)}</p>
                <p className="text-[10px] text-muted-foreground">Miles</p>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
