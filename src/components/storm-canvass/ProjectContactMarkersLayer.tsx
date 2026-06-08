/**
 * ProjectContactMarkersLayer
 * Renders CRM contacts (leads & projects) on the canvass map so reps can see
 * which houses are already in the pipeline, their status, and who set it.
 *
 * Distinct from PropertyMarkersLayer (canvassiq_properties) — these are
 * diamond-shaped pins to stand out from prospecting circles.
 */

import { useEffect, useRef, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import { supabase } from '@/integrations/supabase/client';
import { useUserProfile } from '@/contexts/UserProfileContext';

interface Props {
  map: mapboxgl.Map;
  onContactClick?: (contact: any) => void;
}

// Status → color (project lifecycle / pipeline)
const STATUS_COLOR: Record<string, string> = {
  // Pipeline
  new: '#6366F1',
  contacted: '#6366F1',
  appointment_set: '#0EA5E9',
  inspection_scheduled: '#0EA5E9',
  inspection_complete: '#06B6D4',
  estimate_sent: '#F59E0B',
  estimate_approved: '#22C55E',
  contract_signed: '#22C55E',
  legal_review: '#A855F7',
  in_production: '#10B981',
  completed: '#0D9488',
  closed_won: '#22C55E',
  closed_lost: '#EF4444',
  // Project
  active: '#10B981',
  on_hold: '#F59E0B',
  cancelled: '#EF4444',
  default: '#6366F1',
};

function colorFor(status?: string | null): string {
  if (!status) return STATUS_COLOR.default;
  return STATUS_COLOR[status] || STATUS_COLOR.default;
}

function formatStatus(s?: string | null): string {
  if (!s) return 'Lead';
  return s.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export default function ProjectContactMarkersLayer({ map, onContactClick }: Props) {
  const { profile } = useUserProfile();
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const loadedBoundsRef = useRef<string | null>(null);

  const clear = useCallback(() => {
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
  }, []);

  const load = useCallback(async () => {
    const tenantId = profile?.active_tenant_id || profile?.tenant_id;
    if (!tenantId || !map) return;

    const zoom = map.getZoom();
    if (zoom < 13) {
      clear();
      return;
    }

    const b = map.getBounds();
    const minLat = b.getSouth(), maxLat = b.getNorth();
    const minLng = b.getWest(), maxLng = b.getEast();
    const key = `${minLat.toFixed(4)}_${maxLat.toFixed(4)}_${minLng.toFixed(4)}_${maxLng.toFixed(4)}`;
    if (loadedBoundsRef.current === key) return;
    loadedBoundsRef.current = key;

    const { data: contacts, error } = await supabase
      .from('contacts')
      .select(`
        id, first_name, last_name, address_street, latitude, longitude,
        lifecycle_stage, qualification_status, assigned_to,
        pipeline_entries(id, status, assigned_to, updated_at,
          projects(id, status, name)
        )
      `)
      .eq('tenant_id', tenantId)
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
      .gte('latitude', minLat).lte('latitude', maxLat)
      .gte('longitude', minLng).lte('longitude', maxLng)
      .limit(400);

    if (error) {
      console.error('[ProjectContactMarkersLayer]', error);
      return;
    }

    // Collect assignee IDs to resolve names
    const userIds = new Set<string>();
    (contacts || []).forEach((c: any) => {
      if (c.assigned_to) userIds.add(c.assigned_to);
      (c.pipeline_entries || []).forEach((pe: any) => {
        if (pe.assigned_to) userIds.add(pe.assigned_to);
      });
    });

    let userMap = new Map<string, string>();
    if (userIds.size > 0) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, first_name, last_name')
        .in('id', Array.from(userIds));
      (profs || []).forEach((p: any) => {
        userMap.set(p.id, `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unassigned');
      });
    }

    clear();

    (contacts || []).forEach((c: any) => {
      const pe = (c.pipeline_entries || [])[0];
      const project = pe?.projects?.[0];
      const status = project?.status || pe?.status || c.lifecycle_stage;
      const isProject = !!project;
      const assigneeId = pe?.assigned_to || c.assigned_to;
      const assigneeName = assigneeId ? (userMap.get(assigneeId) || 'Unknown') : 'Unassigned';

      const color = colorFor(status);

      const el = document.createElement('div');
      el.style.cssText = `
        display: flex; flex-direction: column; align-items: center;
        cursor: pointer; pointer-events: auto;
      `;

      // Diamond shape badge
      const badge = document.createElement('div');
      const size = zoom >= 16 ? 22 : 18;
      badge.style.cssText = `
        width: ${size}px; height: ${size}px;
        background: ${color};
        border: 2px solid white;
        box-shadow: 0 2px 6px rgba(0,0,0,0.35);
        transform: rotate(45deg);
        display: flex; align-items: center; justify-content: center;
      `;
      if (isProject) {
        const inner = document.createElement('div');
        inner.style.cssText = `
          width: 6px; height: 6px; background: white; border-radius: 50%;
          transform: rotate(-45deg);
        `;
        badge.appendChild(inner);
      }
      el.appendChild(badge);

      if (zoom >= 16) {
        const label = document.createElement('div');
        label.textContent = isProject ? 'PROJECT' : formatStatus(status).toUpperCase();
        label.style.cssText = `
          margin-top: 4px; font-size: 9px; font-weight: 700;
          color: #111827; background: rgba(255,255,255,0.92);
          padding: 1px 4px; border-radius: 3px; white-space: nowrap;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          box-shadow: 0 1px 2px rgba(0,0,0,0.2);
        `;
        el.appendChild(label);
      }

      const name = `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'Contact';
      const popupHtml = `
        <div style="font-family:-apple-system,sans-serif;min-width:200px">
          <div style="font-weight:700;font-size:13px;margin-bottom:2px">${name}</div>
          <div style="font-size:11px;color:#4B5563;margin-bottom:6px">${c.address_street || ''}</div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
            <span style="display:inline-block;width:10px;height:10px;background:${color};border-radius:2px"></span>
            <span style="font-size:11px;font-weight:600">${isProject ? 'Project · ' : ''}${formatStatus(status)}</span>
          </div>
          <div style="font-size:11px;color:#374151">
            <strong>Owner:</strong> ${assigneeName}
          </div>
        </div>
      `;

      const popup = new mapboxgl.Popup({ offset: 18, closeButton: false }).setHTML(popupHtml);

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (onContactClick) onContactClick(c);
      });
      el.addEventListener('mouseenter', () => popup.addTo(map).setLngLat([c.longitude, c.latitude]));
      el.addEventListener('mouseleave', () => popup.remove());

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([c.longitude, c.latitude])
        .addTo(map);
      markersRef.current.push(marker);
    });
  }, [profile?.tenant_id, profile?.active_tenant_id, map, clear, onContactClick]);

  useEffect(() => {
    const onMove = () => load();
    const onZoom = () => { loadedBoundsRef.current = null; load(); };
    const onStyle = () => { loadedBoundsRef.current = null; load(); };

    map.on('moveend', onMove);
    map.on('zoomend', onZoom);
    map.on('style.load', onStyle);
    load();

    return () => {
      map.off('moveend', onMove);
      map.off('zoomend', onZoom);
      map.off('style.load', onStyle);
      clear();
    };
  }, [map, load, clear]);

  return null;
}
