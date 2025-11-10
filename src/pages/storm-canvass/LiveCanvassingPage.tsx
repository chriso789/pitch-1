import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Navigation } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import LiveLocationMap from '@/components/storm-canvass/LiveLocationMap';
import QuickActivityPanel from '@/components/storm-canvass/QuickActivityPanel';
import LiveStatsOverlay from '@/components/storm-canvass/LiveStatsOverlay';
import MobileDispositionPanel from '@/components/storm-canvass/MobileDispositionPanel';
import { locationService } from '@/services/locationService';
import { useToast } from '@/hooks/use-toast';
import { useStormCanvass } from '@/hooks/useStormCanvass';

interface Contact {
  id: string;
  first_name: string;
  last_name: string;
  address_street: string;
  address_city?: string;
  address_state?: string;
  address_zip?: string;
  latitude: number;
  longitude: number;
  qualification_status?: string;
  metadata?: any;
  phone?: string;
  email?: string;
}

interface Disposition {
  id: string;
  name: string;
  qualification_status?: string;
  is_qualified?: boolean;
  color?: string;
}

export default function LiveCanvassingPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { getDispositions } = useStormCanvass();
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [currentAddress, setCurrentAddress] = useState<string>('Loading location...');
  const [isTracking, setIsTracking] = useState(false);
  const [distanceTraveled, setDistanceTraveled] = useState(0);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [dispositions, setDispositions] = useState<Disposition[]>([]);

  useEffect(() => {
    // Load dispositions
    const loadDispositions = async () => {
      const disps = await getDispositions();
      setDispositions(disps);
    };
    loadDispositions();
  }, []);

  useEffect(() => {
    // Request initial location
    locationService.getCurrentLocation()
      .then((location) => {
        setUserLocation({ lat: location.lat, lng: location.lng });
        setCurrentAddress(location.address || 'Address unavailable');
        setIsTracking(true);
      })
      .catch((error) => {
        console.error('Location error:', error);
        toast({
          title: 'Location Error',
          description: 'Unable to access your location. Please enable location services.',
          variant: 'destructive',
        });
      });

    // Start watching location
    const stopWatching = locationService.watchLocation(
      (location) => {
        const newLat = location.lat;
        const newLng = location.lng;

        // Calculate distance traveled if we have previous location
        if (userLocation) {
          const distance = locationService.calculateDistance(
            userLocation.lat,
            userLocation.lng,
            newLat,
            newLng,
            'miles'
          );
          setDistanceTraveled((prev) => prev + distance.distance);
        }

        setUserLocation({ lat: newLat, lng: newLng });
        
        if (location.address) {
          setCurrentAddress(location.address);
        }
      },
      (error) => {
        console.error('Location watch error:', error);
        toast({
          title: 'GPS Tracking Error',
          description: error.message,
          variant: 'destructive',
        });
      }
    );

    return () => {
      stopWatching();
      locationService.stopWatching();
    };
  }, []);

  return (
    <div className="h-screen w-full flex flex-col bg-background">
      {/* Header */}
      <Card className="rounded-none border-x-0 border-t-0">
        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/storm-canvass')}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-lg font-semibold">Live Canvassing</h1>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Navigation className="h-3 w-3" />
                <span className="truncate max-w-[200px]">{currentAddress}</span>
              </div>
            </div>
          </div>
          <Badge variant={isTracking ? 'default' : 'secondary'}>
            {isTracking ? 'Tracking Active' : 'Not Tracking'}
          </Badge>
        </div>
      </Card>

      {/* Map Container */}
      <div className="flex-1 relative">
        {userLocation ? (
          <>
            <LiveLocationMap
              userLocation={userLocation}
              currentAddress={currentAddress}
              onContactSelect={setSelectedContact}
            />
            <LiveStatsOverlay distanceTraveled={distanceTraveled} />
          </>
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <Navigation className="h-12 w-12 mx-auto mb-4 text-muted-foreground animate-pulse" />
              <p className="text-muted-foreground">Getting your location...</p>
            </div>
          </div>
        )}
      </div>

      {/* Quick Activity Panel */}
      {userLocation && (
        <QuickActivityPanel userLocation={userLocation} />
      )}

      {/* Mobile Disposition Panel */}
      {userLocation && (
        <MobileDispositionPanel
          contact={selectedContact}
          userLocation={userLocation}
          dispositions={dispositions}
          onClose={() => setSelectedContact(null)}
          onUpdate={() => {
            // Refresh map/markers after disposition update
            setSelectedContact(null);
          }}
        />
      )}
    </div>
  );
}
