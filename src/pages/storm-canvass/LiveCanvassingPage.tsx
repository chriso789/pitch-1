import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Crosshair } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import GoogleLiveLocationMap from '@/components/storm-canvass/GoogleLiveLocationMap';
import LiveStatsOverlay from '@/components/storm-canvass/LiveStatsOverlay';
import MobileDispositionPanel from '@/components/storm-canvass/MobileDispositionPanel';
import AddressSearchBar from '@/components/storm-canvass/AddressSearchBar';
import NavigationPanel from '@/components/storm-canvass/NavigationPanel';
import GPSAcquiringOverlay from '@/components/storm-canvass/GPSAcquiringOverlay';
import MapStyleToggle, { MapStyle } from '@/components/storm-canvass/MapStyleToggle';
import MapSymbolSettings, { loadSymbolSettings, type SymbolSettings } from '@/components/storm-canvass/MapSymbolSettings';
import { OfflinePhotoSyncManager } from '@/components/storm-canvass/OfflinePhotoSyncManager';
import PropertyInfoPanel from '@/components/storm-canvass/PropertyInfoPanel';
import PropertyLoadingIndicator from '@/components/storm-canvass/PropertyLoadingIndicator';
import TerritoryBoundaryAlert from '@/components/storm-canvass/TerritoryBoundaryAlert';
import CanvassModeToggle from '@/components/storm-canvass/CanvassModeToggle';
import DropPinDialog from '@/components/storm-canvass/DropPinDialog';
import { useAssignedArea } from '@/hooks/useAssignedArea';
import { locationService } from '@/services/locationService';
import { gpsTrailService } from '@/services/gpsTrailService';
import { useToast } from '@/hooks/use-toast';
import { useStormCanvass } from '@/hooks/useStormCanvass';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { supabase } from '@/integrations/supabase/client';
import { useDeviceLayout } from '@/hooks/useDeviceLayout';

// Neutral US center (geographic center of contiguous US) — only used if GPS never resolves
const NEUTRAL_FALLBACK = { lat: 39.8283, lng: -98.5795 };
const NEUTRAL_FALLBACK_ZOOM = 4; // zoomed out so it's obviously not "your location"

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
  const { assignedArea, areaPolygon, propertyIds: areaPropertyIds, loading: areaLoading } = useAssignedArea();

  // Compute assigned area centroid as intelligent fallback
  const areaGeoCentroid = useMemo(() => {
    if (!areaPolygon) return null;
    const coords = areaPolygon?.coordinates?.[0] || areaPolygon?.geometry?.coordinates?.[0];
    if (!coords || coords.length < 3) return null;
    let sumLat = 0, sumLng = 0;
    for (const c of coords) { sumLng += c[0]; sumLat += c[1]; }
    return { lat: sumLat / coords.length, lng: sumLng / coords.length };
  }, [areaPolygon]);

  // Fallback: compute centroid from tenant's geocoded contacts when no assigned area
  const [contactCentroid, setContactCentroid] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (areaGeoCentroid || !profile?.tenant_id) return; // area centroid exists, no need
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('contacts')
          .select('latitude, longitude')
          .eq('tenant_id', profile.tenant_id)
          .not('latitude', 'is', null)
          .not('longitude', 'is', null)
          .limit(500);
        if (cancelled || !data?.length) return;
        let sumLat = 0, sumLng = 0, count = 0;
        for (const c of data) {
          if (c.latitude && c.longitude) {
            sumLat += Number(c.latitude);
            sumLng += Number(c.longitude);
            count++;
          }
        }
        if (count > 0) {
          const centroid = { lat: sumLat / count, lng: sumLng / count };
          console.log(`[Canvassing] Contact centroid computed from ${count} contacts:`, centroid);
          setContactCentroid(centroid);
        }
      } catch (err) {
        console.warn('[Canvassing] Failed to compute contact centroid:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [areaGeoCentroid, profile?.tenant_id]);

  // Use area centroid if available, otherwise contact centroid
  const areaCentroid = areaGeoCentroid || contactCentroid;

  // Start with null — map won't render until we have a real GPS fix or fallback
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [initialZoom, setInitialZoom] = useState<number | undefined>(undefined);
  const [hasGPS, setHasGPS] = useState(false);
  const [hasRealGpsLock, setHasRealGpsLock] = useState(false); // true only when live GPS fix received
  const [gpsAttempted, setGpsAttempted] = useState(false);
  const [currentAddress, setCurrentAddress] = useState<string>('Acquiring location...');
  const [isTracking, setIsTracking] = useState(false);
  const [distanceTraveled, setDistanceTraveled] = useState(0);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [dispositions, setDispositions] = useState<Disposition[]>([]);
  const [mapStyle, setMapStyle] = useState<MapStyle>('satellite');
  const [selectedProperty, setSelectedProperty] = useState<any>(null);
  const [showPropertyPanel, setShowPropertyPanel] = useState(false);
  const [canvassMode, setCanvassMode] = useState<'knock' | 'canvas'>('knock');
  const [dropPinCoords, setDropPinCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [symbolSettings, setSymbolSettings] = useState<SymbolSettings>(() => 
    loadSymbolSettings(profile?.tenant_id || '')
  );
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
  const [markersRefreshKey, setMarkersRefreshKey] = useState(0);
  
  // Debounced stable loading state for smooth UI
  const [stableLoadingState, setStableLoadingState] = useState<'idle' | 'loading' | 'success'>('idle');
  const [stableCount, setStableCount] = useState<number | null>(null);
  const loadingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const successTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  const previousLocation = useRef<{ lat: number; lng: number } | null>(null);
  const gpsTrailStarted = useRef(false);
  
  // Auto-follow pause: user drags/zooms map → pause follow for 15s
  const [userInteractionPaused, setUserInteractionPaused] = useState(false);
  const interactionTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  const handleUserMapInteraction = useCallback(() => {
    setUserInteractionPaused(true);
    if (interactionTimerRef.current) clearTimeout(interactionTimerRef.current);
    interactionTimerRef.current = setTimeout(() => {
      setUserInteractionPaused(false);
    }, 5000); // Resume auto-follow after 5 seconds
  }, []);
  
  useEffect(() => {
    return () => {
      if (interactionTimerRef.current) clearTimeout(interactionTimerRef.current);
    };
  }, []);

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

  // Manual recenter handler — also resumes auto-follow
  // Uses two-stage fallback: strict first, then relaxed if strict fails
  const handleRecenterGPS = useCallback(async () => {
    // Resume auto-follow immediately
    setUserInteractionPaused(false);
    if (interactionTimerRef.current) clearTimeout(interactionTimerRef.current);

    const applyLocation = (location: any) => {
      setUserLocation({ lat: location.lat, lng: location.lng });
      setHasGPS(true);
      setHasRealGpsLock(true);
      previousLocation.current = { lat: location.lat, lng: location.lng };
      locationService['reverseGeocode'](location.lat, location.lng)
        .then(address => setCurrentAddress(address))
        .catch(() => {});
      toast({ title: 'Location Updated', description: `Accuracy: ${Math.round(location.accuracy || 0)}m` });
    };

    try {
      // Stage 1: Try strict fresh fix (5s timeout)
      const location = await locationService.getCurrentLocation({
        skipGeocoding: true,
        accuracyThreshold: 1000,
        timeout: 5000,
        maxAge: 0,
        stalenessThreshold: 60,
      });
      applyLocation(location);
    } catch {
      try {
        // Stage 2: Relaxed — accept cached positions (Safari workaround)
        const location = await locationService.getCurrentLocation({
          skipGeocoding: true,
          accuracyThreshold: 2000,
          timeout: 30000,
          maxAge: 30000,
          stalenessThreshold: 300,
        });
        applyLocation(location);
      } catch {
        toast({ title: 'GPS Unavailable', description: 'Could not get a location fix. Please check GPS settings.', variant: 'destructive' });
      }
    }
  }, [toast]);

  useEffect(() => {
    let permissionDeniedToastShown = false;

    const initLocation = async () => {
      // Check permission status first
      let permissionState: string | null = null;
      try {
        if (navigator.permissions) {
          const result = await navigator.permissions.query({ name: 'geolocation' });
          permissionState = result.state;
        }
      } catch {
        // permissions API not supported, proceed normally
      }

      if (permissionState === 'denied') {
        toast({
          title: 'Location Access Required',
          description: 'Please enable location access in your browser settings (click the lock icon in the address bar), then refresh this page.',
          variant: 'destructive',
        });
      }

      // Only attempt getCurrentPosition if permission isn't already denied
      if (permissionState !== 'denied') {
        let gotLock = false;

        // Stage 1: strict fresh fix (up to 3 attempts)
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const location = await locationService.getCurrentLocation({ skipGeocoding: true, timeout: 10000 });
            const gpsLoc = { lat: location.lat, lng: location.lng };

            // Sanity check: if assigned area exists and GPS is > 200 miles away, prefer area center
            if (areaCentroid) {
              const dist = locationService.calculateDistance(gpsLoc.lat, gpsLoc.lng, areaCentroid.lat, areaCentroid.lng, 'miles');
              if (dist.distance > 200) {
                console.warn(`[Canvassing] GPS fix ${dist.distance}mi from assigned area — using area center`);
                break; // fall through to fallback
              }
            }

            setUserLocation(gpsLoc);
            setHasGPS(true);
            setHasRealGpsLock(true);
            setIsTracking(true);
            previousLocation.current = gpsLoc;
            gotLock = true;

            locationService['reverseGeocode'](location.lat, location.lng)
              .then(address => setCurrentAddress(address))
              .catch(() => setCurrentAddress('Address unavailable'));
            break;
          } catch (error: any) {
            console.warn(`[Canvassing] Location attempt ${attempt + 1} failed:`, error?.message, 'code:', error?.code);
            if (error?.code === 1) {
              permissionDeniedToastShown = true;
              toast({
                title: 'Location Access Required',
                description: 'Please enable location access in your browser settings, then refresh this page.',
                variant: 'destructive',
              });
              break;
            }
            if (error?.code === 99 && attempt < 2) {
              await new Promise(r => setTimeout(r, 2000));
              continue;
            }
          }
        }

        // Stage 2: if strict failed, try relaxed (Safari cached fix workaround)
        if (!gotLock && !permissionDeniedToastShown) {
          try {
            console.log('[Canvassing] Stage 2: trying relaxed GPS acquisition');
            const location = await locationService.getCurrentLocation({
              skipGeocoding: true,
              timeout: 15000,
              maxAge: 30000,
              stalenessThreshold: 300,
              accuracyThreshold: 2000,
            });
            const gpsLoc = { lat: location.lat, lng: location.lng };

            if (areaCentroid) {
              const dist = locationService.calculateDistance(gpsLoc.lat, gpsLoc.lng, areaCentroid.lat, areaCentroid.lng, 'miles');
              if (dist.distance <= 200) {
                setUserLocation(gpsLoc);
                setHasGPS(true);
                setHasRealGpsLock(true);
                setIsTracking(true);
                previousLocation.current = gpsLoc;
                gotLock = true;
                locationService['reverseGeocode'](location.lat, location.lng)
                  .then(address => setCurrentAddress(address))
                  .catch(() => setCurrentAddress('Address unavailable'));
              }
            } else {
              setUserLocation(gpsLoc);
              setHasGPS(true);
              setHasRealGpsLock(true);
              setIsTracking(true);
              previousLocation.current = gpsLoc;
              gotLock = true;
            }
          } catch {
            console.warn('[Canvassing] Stage 2 relaxed GPS also failed');
          }
        }

        // Stage 3: show fallback immediately but DON'T mark as real GPS
        if (!gotLock) {
          const fallback = areaCentroid || NEUTRAL_FALLBACK;
          const zoom = areaCentroid ? 16 : NEUTRAL_FALLBACK_ZOOM;
          setUserLocation(fallback);
          setInitialZoom(zoom);
          setHasGPS(true); // dismiss overlay
          // hasRealGpsLock stays false — watch will upgrade when real fix arrives
          setCurrentAddress(areaCentroid ? 'Showing assigned area — GPS acquiring...' : 'Location unavailable — use search or tap recenter');
        }
      }

      setGpsAttempted(true);
    };

    initLocation();

    // Start watching location
    const stopWatching = locationService.watchLocation(
      (location) => {
        const accuracy = location.accuracy ?? Infinity;

        // Reject coarse/IP-based fixes (accuracy > 1000m)
        if (accuracy > 1000) {
          console.warn(`[Canvassing] Watch: ignoring coarse fix (${Math.round(accuracy)}m)`);
          return;
        }

        // Reject coarse watch fixes if we don't yet have GPS
        if (!previousLocation.current && accuracy > 500) {
          console.warn(`[Canvassing] Watch: ignoring medium-accuracy fix before first lock (${Math.round(accuracy)}m)`);
          return;
        }

        const newLat = location.lat;
        const newLng = location.lng;

        // Distance sanity check against assigned area (first fix only)
        if (areaCentroid && !previousLocation.current) {
          const dist = locationService.calculateDistance(newLat, newLng, areaCentroid.lat, areaCentroid.lng, 'miles');
          if (dist.distance > 200) {
            console.warn(`[Canvassing] Watch: fix ${dist.distance}mi from area — ignoring`);
            return;
          }
        }

        // Distance jump guard — reject anomalous jumps > 50 miles from previous real fix
        if (previousLocation.current) {
          const jumpDist = locationService.calculateDistance(
            previousLocation.current.lat,
            previousLocation.current.lng,
            newLat,
            newLng,
            'miles'
          );
          if (jumpDist.distance > 50) {
            console.warn(`[Canvassing] Watch: rejecting ${jumpDist.distance.toFixed(1)}mi jump from previous fix`);
            return;
          }
          setDistanceTraveled((prev) => prev + jumpDist.distance);
        }

        // Upgrade from fallback to real GPS — snap map to live user position
        setUserLocation({ lat: newLat, lng: newLng });
        previousLocation.current = { lat: newLat, lng: newLng };
        setHasGPS(true);
        setHasRealGpsLock(true);
        setIsTracking(true);
        
        if (location.address) {
          setCurrentAddress(location.address);
        }
      },
      (error: Error & { code?: number }) => {
        // Timeout (code 3): watchPosition keeps retrying — don't show error
        if (error.code === 3) {
          console.warn('GPS timeout, retrying in background...');
          return;
        }

        // Permission denied (code 1): show once
        if (error.code === 1 && !permissionDeniedToastShown) {
          permissionDeniedToastShown = true;
          toast({
            title: 'Location Access Required',
            description: 'Please enable location access in your browser settings, then refresh this page.',
            variant: 'destructive',
          });
          return;
        }

        // Position unavailable (code 2) or other: silently log, watchPosition keeps retrying
        if (error.code !== 1) {
          console.warn('[Canvassing] GPS watch error (retrying):', error.code, error.message);
        }
      }
    );

    return () => {
      stopWatching();
      locationService.stopWatching();
    };
  }, [areaCentroid]);

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
    const panAndRefresh = (lat: number, lng: number, address: string) => {
      // Pan map to the searched location
      setUserLocation({ lat, lng });
      // Force marker refresh so pins load for the new viewport
      setMarkersRefreshKey(prev => prev + 1);
      // Also calculate route
      calculateRoute({ lat, lng, address });
    };

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
          panAndRefresh(location.lat, location.lng, data.result.formatted_address || place.description);
        }
      } catch (error) {
        console.error('Failed to get place details:', error);
      }
    } else {
      panAndRefresh(
        place.geometry.location.lat,
        place.geometry.location.lng,
        place.description,
      );
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

  const handleParcelSelect = useCallback((property: any) => {
    setSelectedProperty(property);
    setShowPropertyPanel(true);
  }, []);

  return (
    <div className="h-[100dvh] w-full relative overflow-hidden bg-background" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      {/* Full-screen map — only render once we have a location */}
      <div className="absolute inset-0" style={{ top: 'env(safe-area-inset-top, 0px)' }}>
        {userLocation ? (
          <GoogleLiveLocationMap
            userLocation={userLocation}
            currentAddress={currentAddress}
            onContactSelect={setSelectedContact}
            onParcelSelect={handleParcelSelect}
            routeData={routeData}
            destination={destination}
            mapStyle={mapStyle}
            onLoadingChange={setRawIsLoading}
            onPropertiesLoaded={setRawLoadedCount}
            refreshKey={markersRefreshKey}
            areaPropertyIds={canvassMode === 'knock' && areaPropertyIds.length > 0 ? areaPropertyIds : undefined}
            areaPolygon={areaPolygon}
            onMapClick={canvassMode === 'canvas' ? (lat, lng) => setDropPinCoords({ lat, lng }) : undefined}
            followUser={!userInteractionPaused}
            onUserInteraction={handleUserMapInteraction}
            symbolSettings={symbolSettings}
            initialZoom={initialZoom}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-background">
            <div className="text-center">
              <Crosshair className="h-8 w-8 animate-pulse text-primary mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Waiting for GPS signal...</p>
            </div>
          </div>
        )}
      </div>

      {/* Overlaid Header Controls */}
      <div className="absolute top-0 left-0 right-0 z-10 pointer-events-none" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        {/* Top row: Back + Title + Mode Toggle */}
        <div className="flex items-center justify-between px-2 pt-2 pointer-events-auto">
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 bg-background/80 backdrop-blur-sm shadow-md border border-border/50"
              onClick={() => navigate('/storm-canvass')}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <span className="text-sm font-semibold text-foreground bg-background/80 backdrop-blur-sm px-2.5 py-1.5 rounded-md shadow-md border border-border/50">
              Live Canvassing
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <OfflinePhotoSyncManager compact className="cursor-pointer" />
          </div>
        </div>

        {/* Search bar */}
        <div className="px-2 pt-2 pointer-events-auto">
          <AddressSearchBar
            userLocation={userLocation || NEUTRAL_FALLBACK}
            onAddressSelect={handleAddressSelect}
          />
        </div>

        {/* Map style toggle + Stats */}
        <div className="flex items-center gap-2 px-2 pt-2 pointer-events-auto">
          <MapStyleToggle value={mapStyle} onChange={setMapStyle} />
          {profile?.tenant_id && (
            <MapSymbolSettings
              tenantId={profile.tenant_id}
              symbolSettings={symbolSettings}
              onSettingsChange={setSymbolSettings}
            />
          )}
          <LiveStatsOverlay distanceTraveled={distanceTraveled} />
        </div>
      </div>

      {/* Navigation Panel */}
      {routeData && destination && (
        <div className="absolute bottom-24 left-2 right-2 z-20">
          <NavigationPanel
            routeData={routeData}
            destination={destination}
            onStartNavigation={openDeviceNavigation}
            onClearRoute={clearRoute}
            onRecalculateRoute={() => calculateRoute(destination)}
          />
        </div>
      )}


      {/* Territory Boundary Alert */}
      {assignedArea && areaPolygon && userLocation && (
        <TerritoryBoundaryAlert userLocation={userLocation} areaPolygon={areaPolygon} />
      )}

      {/* Property Loading Indicator */}
      <PropertyLoadingIndicator
        state={stableLoadingState}
        loadedCount={stableCount}
      />

      {/* Floating Recenter + Knock/Canvas Toggle */}
      <div className="fixed z-40 pointer-events-auto flex items-center gap-2" style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)', right: '12px' }}>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 bg-background/90 backdrop-blur-sm shadow-md border border-border/50 rounded-full"
          onClick={handleRecenterGPS}
          title="Center on my location"
        >
          <Crosshair className="h-5 w-5" />
        </Button>
        <CanvassModeToggle mode={canvassMode} onModeChange={setCanvassMode} />
      </div>


      {/* GPS Acquiring Overlay */}
      {!hasGPS && <GPSAcquiringOverlay />}

      {/* Drop Pin Dialog */}
      {dropPinCoords && profile?.tenant_id && profile?.id && (
        <DropPinDialog
          open={!!dropPinCoords}
          onOpenChange={(open) => { if (!open) setDropPinCoords(null); }}
          lat={dropPinCoords.lat}
          lng={dropPinCoords.lng}
          tenantId={profile.tenant_id}
          userId={profile.id}
          onSuccess={() => {
            setDropPinCoords(null);
            setMarkersRefreshKey(prev => prev + 1);
          }}
        />
      )}

      {/* Mobile Disposition Panel (for contacts) */}
      <MobileDispositionPanel
        contact={selectedContact}
        userLocation={userLocation || NEUTRAL_FALLBACK}
        dispositions={dispositions}
        onClose={() => setSelectedContact(null)}
        onUpdate={() => {
          setSelectedContact(null);
        }}
        onNavigate={handleNavigateToContact}
      />


      {/* Property Info Panel (Bottom Sheet) */}
      <PropertyInfoPanel
        open={showPropertyPanel}
        onOpenChange={(open) => {
          setShowPropertyPanel(open);
          if (!open) setSelectedProperty(null);
        }}
        property={selectedProperty}
        userLocation={userLocation || NEUTRAL_FALLBACK}
        onDispositionUpdate={() => {
          // Force refresh markers by incrementing the key
          setMarkersRefreshKey(prev => prev + 1);
        }}
        onNavigate={handleNavigateToProperty}
      />
    </div>
  );
}
