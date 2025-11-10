import { useEffect, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface NearbyPropertiesLayerProps {
  map: mapboxgl.Map;
  userLocation: { lat: number; lng: number };
}

interface Contact {
  id: string;
  first_name: string;
  last_name: string;
  latitude: number;
  longitude: number;
  metadata: any;
}

export default function NearbyPropertiesLayer({ map, userLocation }: NearbyPropertiesLayerProps) {
  const { user } = useAuth();
  const [markers, setMarkers] = useState<mapboxgl.Marker[]>([]);

  useEffect(() => {
    if (!user) return;

    const fetchNearbyContacts = async () => {
      // Get user's active tenant
      const { data: profile } = await supabase
        .from('profiles')
        .select('active_tenant_id, tenant_id')
        .eq('id', user.id)
        .single();

      const tenantId = profile?.active_tenant_id || profile?.tenant_id;
      if (!tenantId) return;

      // Fetch contacts with GPS coordinates
      const { data: contacts, error } = await supabase
        .from('contacts')
        .select('id, first_name, last_name, latitude, longitude, metadata')
        .eq('tenant_id', tenantId)
        .not('latitude', 'is', null)
        .not('longitude', 'is', null);

      if (error) {
        console.error('Error fetching contacts:', error);
        return;
      }

      // Clear existing markers
      markers.forEach((marker) => marker.remove());

      // Filter contacts within 1 mile radius (approximately 1609 meters)
      const radiusMiles = 1;
      const nearbyContacts = (contacts as Contact[]).filter((contact) => {
        const distance = calculateDistance(
          userLocation.lat,
          userLocation.lng,
          contact.latitude,
          contact.longitude
        );
        return distance <= radiusMiles;
      });

      // Create new markers
      const newMarkers = nearbyContacts.map((contact) => {
        const disposition = contact.metadata?.qualification_status || 'not_contacted';
        
        // Color-code by disposition
        const color =
          disposition === 'qualified' || disposition === 'interested'
            ? '#22c55e' // green
            : disposition === 'not_interested'
            ? '#ef4444' // red
            : disposition === 'follow_up'
            ? '#eab308' // yellow
            : '#9ca3af'; // gray

        const el = document.createElement('div');
        el.style.width = '32px';
        el.style.height = '32px';
        el.style.borderRadius = '50%';
        el.style.backgroundColor = color;
        el.style.border = '3px solid white';
        el.style.cursor = 'pointer';
        el.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.style.fontSize = '14px';
        el.style.fontWeight = 'bold';
        el.style.color = 'white';
        el.textContent = contact.first_name?.charAt(0) || 'C';

        const marker = new mapboxgl.Marker(el)
          .setLngLat([contact.longitude, contact.latitude])
          .setPopup(
            new mapboxgl.Popup({ offset: 25 }).setHTML(`
              <div class="p-2">
                <strong>${contact.first_name} ${contact.last_name}</strong><br/>
                <span class="text-sm text-muted-foreground">Status: ${formatDisposition(disposition)}</span><br/>
                <span class="text-xs text-muted-foreground">
                  ${calculateDistance(userLocation.lat, userLocation.lng, contact.latitude, contact.longitude).toFixed(2)} mi away
                </span>
              </div>
            `)
          )
          .addTo(map);

        return marker;
      });

      setMarkers(newMarkers);
    };

    fetchNearbyContacts();

    // Refresh every 30 seconds
    const interval = setInterval(fetchNearbyContacts, 30000);

    return () => {
      clearInterval(interval);
      markers.forEach((marker) => marker.remove());
    };
  }, [map, userLocation, user]);

  return null;
}

// Haversine formula for distance calculation
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8; // Earth's radius in miles
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

function formatDisposition(disposition: string): string {
  return disposition
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
