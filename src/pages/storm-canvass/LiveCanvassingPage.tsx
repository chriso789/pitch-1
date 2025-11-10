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
import AddressSearchBar from '@/components/storm-canvass/AddressSearchBar';
import NavigationPanel from '@/components/storm-canvass/NavigationPanel';
import { locationService } from '@/services/locationService';
import { useToast } from '@/hooks/use-toast';
import { useStormCanvass } from '@/hooks/useStormCanvass';
import { supabase } from '@/integrations/supabase/client';

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
  const [destination, setDestination] = useState<{
    lat: number;
    lng: number;
    address: string;
  } | null>(null);
  const [routeData, setRouteData] = useState<{
    distance: { distance: number; unit: string };
    duration: number;
    polyline: string;
  } | null>(null);
  const [isCalculatingRoute, setIsCalculatingRoute] = useState(false);

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

  // Calculate route when destination is selected
  const calculateRoute = async (dest: { lat: number; lng: number; address: string }) => {
    if (!userLocation) return;

    setIsCalculatingRoute(true);
    try {
      const route = await locationService.getRoute(
        { lat: userLocation.lat, lng: userLocation.lng },
        { lat: dest.lat, lng: dest.lng }
      );

      if (route.polyline) {
        setRouteData({
          distance: route.distance,
          duration: route.duration,
          polyline: route.polyline,
        });
        setDestination(dest);

        toast({
          title: 'Route Calculated',
          description: `${route.distance.distance.toFixed(1)} miles · ${Math.round(route.duration / 60)} min`,
        });
      } else {
        throw new Error('No route polyline available');
      }
    } catch (error) {
      console.error('Route calculation error:', error);
      toast({
        title: 'Route Error',
        description: 'Failed to calculate route',
        variant: 'destructive',
      });
    } finally {
      setIsCalculatingRoute(false);
    }
  };

  // Clear active route
  const clearRoute = () => {
    setDestination(null);
    setRouteData(null);
  };

  // Handle address selection from search
  const handleAddressSelect = async (place: any) => {
    if (!place.geometry?.location) {
      // Fetch place details if geometry not provided
      try {
        const { data, error } = await supabase.functions.invoke('google-maps-proxy', {
          body: {
            endpoint: 'details',
            params: {
              place_id: place.place_id,
              fields: 'geometry,formatted_address',
            },
          },
        });

        if (error) throw error;

        const location = data?.result?.geometry?.location;
        if (location) {
          await calculateRoute({
            lat: location.lat,
            lng: location.lng,
            address: data.result.formatted_address || place.description,
          });
        }
      } catch (error) {
        console.error('Failed to get place details:', error);
      }
    } else {
      await calculateRoute({
        lat: place.geometry.location.lat,
        lng: place.geometry.location.lng,
        address: place.description,
      });
    }
  };

  // Handle "Navigate Here" on contact properties
  const handleNavigateToContact = async (contact: Contact) => {
    await calculateRoute({
      lat: contact.latitude,
      lng: contact.longitude,
      address: contact.address_street,
    });
  };

  // Open device navigation
  const openDeviceNavigation = () => {
    if (!destination) return;

    const destCoords = `${destination.lat},${destination.lng}`;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isAndroid = /Android/.test(navigator.userAgent);

    let navigationUrl = '';

    if (isIOS) {
      navigationUrl = `maps://?daddr=${destCoords}&dirflg=d`;
    } else if (isAndroid) {
      navigationUrl = `google.navigation:q=${destCoords}&mode=d`;
    } else {
      navigationUrl = `https://www.google.com/maps/dir/?api=1&destination=${destCoords}&travelmode=driving`;
    }

    window.open(navigationUrl, '_blank');
  };

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
            <div className="min-w-0">
              <h1 className="text-lg font-semibold">Live Canvassing</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={isTracking ? 'default' : 'secondary'} className="hidden sm:flex">
              {isTracking ? 'Tracking' : 'Not Tracking'}
            </Badge>
          </div>
        </div>
        
        {/* Search Bar */}
        {userLocation && (
          <div className="px-4 pb-4">
            <AddressSearchBar
              userLocation={userLocation}
              onAddressSelect={handleAddressSelect}
            />
          </div>
        )}
      </Card>

      {/* Navigation Panel */}
      {routeData && destination && (
        <NavigationPanel
          routeData={routeData}
          destination={destination}
          onStartNavigation={openDeviceNavigation}
          onClearRoute={clearRoute}
          onRecalculateRoute={() => calculateRoute(destination)}
        />
      )}

      {/* Map Container */}
      <div className="flex-1 relative">
        {userLocation ? (
          <>
            <LiveLocationMap
              userLocation={userLocation}
              currentAddress={currentAddress}
              onContactSelect={setSelectedContact}
              routeData={routeData}
              destination={destination}
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
          onNavigate={handleNavigateToContact}
        />
      )}
    </div>
  );
}
