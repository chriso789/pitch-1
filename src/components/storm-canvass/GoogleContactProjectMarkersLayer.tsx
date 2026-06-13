/// <reference types="@types/google.maps" />
/**
 * GoogleContactProjectMarkersLayer
 *
 * Renders CRM contacts and project pins for the rep's active tenant on the
 * canvass live map. Complements GooglePropertyMarkersLayer (which is driven
 * by canvassiq_properties): this layer guarantees that every CRM lead and
 * project with coordinates shows up — even when there is no matching
 * prospecting property.
 *
 * Diamond-shaped pins distinguish CRM records from prospecting circles.
 * Color is driven by the contact's qualification_status, which is kept in
 * sync with the canvass disposition picker (see useStormCanvass.updateDisposition).
 */
import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';

interface Props {
  map: google.maps.Map;
  onContactClick?: (contact: any) => void;
}

const STATUS_COLOR: Record<string, string> = {
  interested: '#22C55E',
  qualified: '#3B82F6',
  appointment_set: '#0EA5E9',
  storm_damage: '#F59E0B',
  follow_up: '#EAB308',
  callback: '#8B5CF6',
  not_home: '#6B7280',
  not_interested: '#DC2626',
  do_not_contact: '#991B1B',
  past_customer: '#0D9488',
  new_roof: '#0EA5E9',
  // Project lifecycle
  in_production: '#10B981',
  contract_signed: '#22C55E',
  completed: '#0D9488',
};
const DEFAULT_COLOR = '#6366F1';

function colorFor(status?: string | null): string {
  if (!status) return DEFAULT_COLOR;
  return STATUS_COLOR[status.toLowerCase()] || DEFAULT_COLOR;
}

function formatStatus(s?: string | null): string {
  if (!s) return 'Lead';
  return s.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export default function GoogleContactProjectMarkersLayer({ map, onContactClick }: Props) {
  const tenantId = useEffectiveTenantId();
  const markersRef = useRef<google.maps.Marker[]>([]);
  const loadedKeyRef = useRef<string | null>(null);

  const clear = useCallback(() => {
    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];
  }, []);

  const load = useCallback(async () => {
    if (!tenantId || !map) return;

    const zoom = map.getZoom() ?? 0;
    if (zoom < 14) {
      clear();
      loadedKeyRef.current = null;
      return;
    }

    const b = map.getBounds();
    if (!b) return;
    const ne = b.getNorthEast();
    const sw = b.getSouthWest();
    const minLat = sw.lat(), maxLat = ne.lat();
    const minLng = sw.lng(), maxLng = ne.lng();
    const key = `${minLat.toFixed(4)}_${maxLat.toFixed(4)}_${minLng.toFixed(4)}_${maxLng.toFixed(4)}`;
    if (loadedKeyRef.current === key) return;
    loadedKeyRef.current = key;

    const { data: contacts, error } = await supabase
      .from('contacts')
      .select(`
        id, first_name, last_name, address_street, latitude, longitude,
        lifecycle_stage, qualification_status,
        pipeline_entries(id, status, projects(id, status, name))
      `)
      .eq('tenant_id', tenantId)
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
      .gte('latitude', minLat).lte('latitude', maxLat)
      .gte('longitude', minLng).lte('longitude', maxLng)
      .limit(500);

    if (error) {
      console.error('[GoogleContactProjectMarkersLayer]', error);
      return;
    }

    clear();

    (contacts || []).forEach((c: any) => {
      const pe = (c.pipeline_entries || [])[0];
      const project = pe?.projects?.[0];
      const status = project?.status || c.qualification_status || pe?.status || c.lifecycle_stage;
      const isProject = !!project;
      const color = colorFor(status);
      const lat = Number(c.latitude);
      const lng = Number(c.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

      const marker = new google.maps.Marker({
        position: { lat, lng },
        map,
        zIndex: isProject ? 600 : 500,
        icon: {
          // Diamond
          path: 'M 0 -10 L 10 0 L 0 10 L -10 0 Z',
          fillColor: color,
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
          scale: zoom >= 16 ? 1.2 : 1,
        },
        title: `${c.first_name || ''} ${c.last_name || ''} · ${formatStatus(status)}`,
      });

      const name = `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'Contact';
      const infoWindow = new google.maps.InfoWindow({
        content: `
          <div style="font-family:-apple-system,sans-serif;min-width:180px">
            <div style="font-weight:700;font-size:13px;margin-bottom:2px">${name}</div>
            <div style="font-size:11px;color:#4B5563;margin-bottom:6px">${c.address_street || ''}</div>
            <div style="display:flex;align-items:center;gap:6px">
              <span style="display:inline-block;width:10px;height:10px;background:${color};transform:rotate(45deg)"></span>
              <span style="font-size:11px;font-weight:600">${isProject ? 'Project · ' : ''}${formatStatus(status)}</span>
            </div>
          </div>
        `,
      });

      marker.addListener('click', () => {
        if (onContactClick) {
          onContactClick(c);
        } else {
          infoWindow.open({ map, anchor: marker });
        }
      });
      marker.addListener('mouseover', () => infoWindow.open({ map, anchor: marker }));
      marker.addListener('mouseout', () => infoWindow.close());

      markersRef.current.push(marker);
    });
  }, [tenantId, map, clear, onContactClick]);

  useEffect(() => {
    if (!map) return;
    const idle = map.addListener('idle', load);
    load();
    return () => {
      google.maps.event.removeListener(idle);
      clear();
    };
  }, [map, load, clear]);

  return null;
}
