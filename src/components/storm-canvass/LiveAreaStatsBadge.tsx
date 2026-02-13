import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import AreaStatsBadge from './AreaStatsBadge';

interface LiveAreaStatsBadgeProps {
  tenantId: string;
  areaId: string;
  compact?: boolean;
  className?: string;
}

export default function LiveAreaStatsBadge({ tenantId, areaId, compact, className }: LiveAreaStatsBadgeProps) {
  const [total, setTotal] = useState(0);
  const [contacted, setContacted] = useState(0);

  const fetchStats = async () => {
    const { data } = await supabase
      .from('canvass_area_stats')
      .select('total_properties, contacted_properties')
      .eq('tenant_id', tenantId)
      .eq('area_id', areaId)
      .single();

    if (data) {
      setTotal(data.total_properties ?? 0);
      setContacted(data.contacted_properties ?? 0);
    }
  };

  useEffect(() => {
    fetchStats();

    const channel = supabase
      .channel(`area-visits-${areaId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'canvassiq_visits',
      }, () => {
        fetchStats();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenantId, areaId]);

  return (
    <AreaStatsBadge
      total={total}
      contacted={contacted}
      compact={compact}
      className={className}
    />
  );
}
