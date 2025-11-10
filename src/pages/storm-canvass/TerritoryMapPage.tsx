import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { GlobalLayout } from '@/shared/components/layout/GlobalLayout';
import { TerritoryMapControls } from '@/components/storm-canvass/TerritoryMapControls';
import { DispositionPanel } from '@/components/storm-canvass/DispositionPanel';
import { useStormCanvass, ActivityFilters, CanvassActivity } from '@/hooks/useStormCanvass';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

mapboxgl.accessToken = 'pk.eyJ1IjoibG92YWJsZS1kZW1vIiwiYSI6ImNtMXoxZHdwejBhMnAyanM0dzA3ZW1yMG4ifQ.7tYMl9RfRHOaC4K5eKrXRQ';

const TerritoryMapPage = () => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markers = useRef<mapboxgl.Marker[]>([]);
  
  const [activities, setActivities] = useState<CanvassActivity[]>([]);
  const [selectedActivity, setSelectedActivity] = useState<CanvassActivity | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [dispositions, setDispositions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const { getActivities, getDispositions } = useStormCanvass();
  const { toast } = useToast();

  // Fetch initial data
  useEffect(() => {
    const fetchInitialData = async () => {
      setLoading(true);
      try {
        // Fetch users
        const { data: usersData } = await supabase
          .from('profiles')
          .select('id, first_name, last_name')
          .order('first_name');
        setUsers(usersData || []);

        // Fetch locations
        const { data: locationsData } = await supabase
          .from('locations')
          .select('id, name')
          .order('name');
        setLocations(locationsData || []);

        // Fetch dispositions
        const dispositionsData = await getDispositions();
        setDispositions(dispositionsData);

        // Fetch activities
        const activitiesData = await getActivities();
        setActivities(activitiesData);
      } catch (error: any) {
        toast({
          title: 'Error loading data',
          description: error.message,
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    };

    fetchInitialData();
  }, []);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [-98.5795, 39.8283], // Center of USA
      zoom: 4,
    });

    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');
    map.current.addControl(new mapboxgl.FullscreenControl(), 'top-right');

    return () => {
      markers.current.forEach((marker) => marker.remove());
      map.current?.remove();
    };
  }, []);

  // Update markers when activities change
  useEffect(() => {
    if (!map.current || !activities.length) return;

    // Clear existing markers
    markers.current.forEach((marker) => marker.remove());
    markers.current = [];

    // Filter activities with valid coordinates
    const validActivities = activities.filter(
      (activity) => activity.latitude && activity.longitude
    );

    if (validActivities.length === 0) return;

    // Add new markers
    validActivities.forEach((activity) => {
      const color = getMarkerColor(activity.contact?.qualification_status);
      
      const el = document.createElement('div');
      el.className = 'custom-marker';
      el.style.backgroundColor = color;
      el.style.width = '24px';
      el.style.height = '24px';
      el.style.borderRadius = '50%';
      el.style.border = '3px solid white';
      el.style.cursor = 'pointer';
      el.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';

      const marker = new mapboxgl.Marker(el)
        .setLngLat([activity.longitude!, activity.latitude!])
        .addTo(map.current!);

      el.addEventListener('click', () => {
        setSelectedActivity(activity);
      });

      markers.current.push(marker);
    });

    // Fit map to bounds
    const bounds = new mapboxgl.LngLatBounds();
    validActivities.forEach((activity) => {
      bounds.extend([activity.longitude!, activity.latitude!]);
    });
    map.current.fitBounds(bounds, { padding: 100, maxZoom: 15 });
  }, [activities]);

  const getMarkerColor = (status?: string) => {
    switch (status?.toLowerCase()) {
      case 'qualified':
      case 'interested':
        return '#10b981'; // green
      case 'not_qualified':
      case 'not_interested':
        return '#ef4444'; // red
      case 'callback':
      case 'follow_up':
        return '#f59e0b'; // yellow
      default:
        return '#9ca3af'; // gray
    }
  };

  const handleFiltersChange = async (filters: ActivityFilters) => {
    setLoading(true);
    try {
      const activitiesData = await getActivities(filters);
      setActivities(activitiesData);
    } catch (error: any) {
      toast({
        title: 'Error applying filters',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateActivity = async () => {
    // Refresh activities after disposition update
    const activitiesData = await getActivities();
    setActivities(activitiesData);
  };

  return (
    <GlobalLayout>
      <div className="relative h-[calc(100vh-4rem)]">
        {loading && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}
        
        <div ref={mapContainer} className="h-full w-full" />
        
        <TerritoryMapControls
          onFiltersChange={handleFiltersChange}
          users={users}
          locations={locations}
          dispositions={dispositions}
        />
        
        <DispositionPanel
          activity={selectedActivity}
          dispositions={dispositions}
          onClose={() => setSelectedActivity(null)}
          onUpdate={handleUpdateActivity}
        />
      </div>
    </GlobalLayout>
  );
};

export default TerritoryMapPage;
