import { useState, useEffect, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Camera } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import GoogleLiveLocationMap from '@/components/storm-canvass/GoogleLiveLocationMap';
import LiveStatsOverlay from '@/components/storm-canvass/LiveStatsOverlay';
import MobileDispositionPanel from '@/components/storm-canvass/MobileDispositionPanel';
import AddressSearchBar from '@/components/storm-canvass/AddressSearchBar';
import NavigationPanel from '@/components/storm-canvass/NavigationPanel';
import GPSAcquiringOverlay from '@/components/storm-canvass/GPSAcquiringOverlay';
import MapStyleToggle, { MapStyle } from '@/components/storm-canvass/MapStyleToggle';
import { CanvassPhotoCapture } from '@/components/storm-canvass/CanvassPhotoCapture';
import { OfflinePhotoSyncManager } from '@/components/storm-canvass/OfflinePhotoSyncManager';
import PropertyInfoPanel from '@/components/storm-canvass/PropertyInfoPanel';
import PropertyLoadingIndicator from '@/components/storm-canvass/PropertyLoadingIndicator';
import { locationService } from '@/services/locationService';
import { gpsTrailService } from '@/services/gpsTrailService';
import { useToast } from '@/hooks/use-toast';
import { useStormCanvass } from '@/hooks/useStormCanvass';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { supabase } from '@/integrations/supabase/client';
import { useDeviceLayout } from '@/hooks/useDeviceLayout';

// Default location (Tampa, FL) for instant map load before GPS acquires
const DEFAULT_LOCATION = { lat: 27.9506, lng: -82.4572 };

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
  const { profile } = useUserProfile();
  const layout = useDeviceLayout();
  // Start with default location for instant map load
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number }>(DEFAULT_LOCATION);
  const [hasGPS, setHasGPS] = useState(false);
  const [currentAddress, setCurrentAddress] = useState<string>('Acquiring location...');
  const [isTracking, setIsTracking] = useState(false);
  const [distanceTraveled, setDistanceTraveled] = useState(0);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [dispositions, setDispositions] = useState<Disposition[]>([]);
  const [mapStyle, setMapStyle] = useState<MapStyle>('satellite');
  const [showPhotoCapture, setShowPhotoCapture] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState<any>(null);
  const [showPropertyPanel, setShowPropertyPanel] = useState(false);
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
  // Raw loading state from markers layer
  const [rawIsLoading, setRawIsLoading] = useState(false);
  const [rawLoadedCount, setRawLoadedCount] = useState<number | null>(null);
  
  // Debounced stable loading state for smooth UI
  const [stableLoadingState, setStableLoadingState] = useState<'idle' | 'loading' | 'success'>('idle');
  const [stableCount, setStableCount] = useState<number | null>(null);
  const loadingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const successTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  const previousLocation = useRef<{ lat: number; lng: number } | null>(null);
  const gpsTrailStarted = useRef(false);

  useEffect(() => {
    // Load dispositions
    const loadDispositions = async () => {
      const disps = await getDispositions();
      setDispositions(disps);
    };
    loadDispositions();
  }, []);

  // Debounce loading state to prevent rapid flickering
  useEffect(() => {
    // Clear any existing timers
    if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
    if (successTimerRef.current) clearTimeout(successTimerRef.current);

    if (rawIsLoading) {
      // Only show loading after 150ms to ignore micro-loads
      loadingTimerRef.current = setTimeout(() => {
        setStableLoadingState('loading');
      }, 150);
    } else if (rawLoadedCount !== null && rawLoadedCount > 0) {
      // Immediately show success when loading completes
      setStableCount(rawLoadedCount);
      setStableLoadingState('success');
      
      // Auto-hide after 1.5s
      successTimerRef.current = setTimeout(() => {
        setStableLoadingState('idle');
      }, 1500);
    } else {
      setStableLoadingState('idle');
    }

    return () => {
      if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, [rawIsLoading, rawLoadedCount]);

  // Start GPS trail recording when user profile is available
  useEffect(() => {
    if (profile?.id && profile?.tenant_id && !gpsTrailStarted.current) {
      gpsTrailStarted.current = true;
      gpsTrailService.startRecording(profile.id, profile.tenant_id)
        .then((sessionId) => {
          console.log('[LiveCanvassingPage] GPS trail recording started:', sessionId);
        })
        .catch((err) => {
          console.error('[LiveCanvassingPage] Failed to start GPS trail:', err);
        });
    }

    // Cleanup on unmount
    return () => {
      if (gpsTrailStarted.current) {
        gpsTrailService.stopRecording();
        gpsTrailStarted.current = false;
      }
    };
  }, [profile?.id, profile?.tenant_id]);

  useEffect(() => {
    // Request initial location with skipGeocoding for faster response
    locationService.getCurrentLocation({ skipGeocoding: true })
      .then((location) => {
        setUserLocation({ lat: location.lat, lng: location.lng });
        setHasGPS(true);
        setIsTracking(true);
        previousLocation.current = { lat: location.lat, lng: location.lng };
        
        // Fetch address in background (non-blocking)
        locationService['reverseGeocode'](location.lat, location.lng)
          .then(address => setCurrentAddress(address))
          .catch(() => setCurrentAddress('Address unavailable'));
      })
      .catch((error) => {
        console.error('Location error:', error);
        toast({
          title: 'Location Error',
          description: 'Unable to access your location. Using default location.',
          variant: 'destructive',
        });
      });

    // Start watching location
    const stopWatching = locationService.watchLocation(
      (location) => {
        const newLat = location.lat;
        const newLng = location.lng;

        // Calculate distance traveled if we have previous location
        if (previousLocation.current) {
          const distance = locationService.calculateDistance(
            previousLocation.current.lat,
            previousLocation.current.lng,
            newLat,
            newLng,
            'miles'
          );
          setDistanceTraveled((prev) => prev + distance.distance);
        }

        setUserLocation({ lat: newLat, lng: newLng });
        previousLocation.current = { lat: newLat, lng: newLng };
        setHasGPS(true);
        
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

  // Handle navigation from property panel
  const handleNavigateToProperty = async (lat: number, lng: number, address: string) => {
    await calculateRoute({ lat, lng, address });
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
            <OfflinePhotoSyncManager compact className="cursor-pointer" />
          </div>
        </div>
        
        {/* Search Bar and Style Toggle */}
        <div className="px-4 pb-4 flex flex-col gap-3">
          <AddressSearchBar
            userLocation={userLocation}
            onAddressSelect={handleAddressSelect}
          />
          <MapStyleToggle value={mapStyle} onChange={setMapStyle} />
        </div>
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

      {/* Map Container - Always render map immediately */}
      <div className="flex-1 relative">
        <GoogleLiveLocationMap
          userLocation={userLocation}
          currentAddress={currentAddress}
          onContactSelect={setSelectedContact}
          onParcelSelect={(property) => {
            // Open bottom sheet instead of navigating
            setSelectedProperty(property);
            setShowPropertyPanel(true);
          }}
          routeData={routeData}
          destination={destination}
          mapStyle={mapStyle}
          onLoadingChange={setRawIsLoading}
          onPropertiesLoaded={setRawLoadedCount}
        />
        <LiveStatsOverlay distanceTraveled={distanceTraveled} />
        
        {/* Property Loading Indicator */}
        <PropertyLoadingIndicator
          state={stableLoadingState}
          loadedCount={stableCount}
        />
        
        {/* Camera Floating Action Button - Device adaptive positioning */}
        <Button
          size="lg"
          className="fixed rounded-full shadow-lg z-50 bg-primary hover:bg-primary/90"
          style={{
            bottom: layout.fabPosition.bottom,
            right: layout.fabPosition.right,
            width: layout.fabSize,
            height: layout.fabSize,
          }}
          onClick={() => setShowPhotoCapture(true)}
        >
          <Camera className={layout.isTablet || layout.isDesktop ? 'h-7 w-7' : 'h-6 w-6'} />
        </Button>
        
        {/* GPS Acquiring Overlay - show while waiting for real GPS */}
        {!hasGPS && <GPSAcquiringOverlay />}
      </div>

      {/* Mobile Disposition Panel (for contacts) */}
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

      {/* Photo Capture Dialog */}
      <CanvassPhotoCapture
        open={showPhotoCapture}
        onOpenChange={setShowPhotoCapture}
        propertyAddress={selectedContact?.address_street || selectedProperty?.address?.street}
        userLocation={userLocation}
      />

      {/* Property Info Panel (Bottom Sheet) */}
      <PropertyInfoPanel
        open={showPropertyPanel}
        onOpenChange={(open) => {
          setShowPropertyPanel(open);
          if (!open) setSelectedProperty(null);
        }}
        property={selectedProperty}
        userLocation={userLocation}
        onDispositionUpdate={() => {
          // Keep panel open, property will be refreshed by markers layer
        }}
        onNavigate={handleNavigateToProperty}
      />
    </div>
  );
}
