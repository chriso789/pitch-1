import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useUserProfile } from '@/contexts/UserProfileContext';

interface AssignedAreaData {
  assignedArea: { id: string; name: string; color: string } | null;
  areaPolygon: any | null; // GeoJSON polygon
  propertyIds: string[];
  loading: boolean;
}

export function useAssignedArea(): AssignedAreaData {
  const { profile } = useUserProfile();
  const [assignedArea, setAssignedArea] = useState<AssignedAreaData['assignedArea']>(null);
  const [areaPolygon, setAreaPolygon] = useState<any>(null);
  const [propertyIds, setPropertyIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile?.id || !profile?.tenant_id) {
      setLoading(false);
      return;
    }

    let mounted = true;

    const load = async () => {
      setLoading(true);

      // 1. Check if user has an active area assignment
      const { data: assignments, error: assignErr } = await supabase
        .from('canvass_area_assignments')
        .select('area_id')
        .eq('tenant_id', profile.tenant_id)
        .eq('user_id', profile.id)
        .eq('is_active', true)
        .limit(1);

      if (assignErr || !assignments?.length) {
        if (mounted) {
          setAssignedArea(null);
          setAreaPolygon(null);
          setPropertyIds([]);
          setLoading(false);
        }
        return;
      }

      const areaId = assignments[0].area_id;

      // 2. Load area details + polygon
      const { data: area } = await supabase
        .from('canvass_areas')
        .select('id, name, color, polygon_geojson')
        .eq('id', areaId)
        .eq('tenant_id', profile.tenant_id)
        .single();

      if (!mounted) return;

      if (!area) {
        setAssignedArea(null);
        setAreaPolygon(null);
        setPropertyIds([]);
        setLoading(false);
        return;
      }

      setAssignedArea({ id: area.id, name: area.name, color: area.color });
      setAreaPolygon(area.polygon_geojson);

      // 3. Load property IDs for the area
      const { data: memberRows } = await supabase
        .from('canvass_area_properties')
        .select('property_id')
        .eq('tenant_id', profile.tenant_id)
        .eq('area_id', areaId);

      if (!mounted) return;

      const ids = (memberRows || [])
        .map((r: any) => r.property_id)
        .filter(Boolean) as string[];

      setPropertyIds(ids);
      setLoading(false);
    };

    load();

    return () => { mounted = false; };
  }, [profile?.id, profile?.tenant_id]);

  return { assignedArea, areaPolygon, propertyIds, loading };
}
