import { useState, useEffect } from 'react';
import { useToast } from '@/components/ui/use-toast';

interface LocationData {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
  address?: string;
}

export const useLocationPermission = () => {
  const [location, setLocation] = useState<LocationData | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<'prompt' | 'granted' | 'denied' | 'unsupported'>('prompt');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const requestLocationPermission = async () => {
    if (!navigator.geolocation) {
      setPermissionStatus('unsupported');
      toast({
        title: "Location not supported",
        description: "Your browser doesn't support location services.",
        variant: "destructive"
      });
      return false;
    }

    setLoading(true);

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          resolve,
          reject,
          {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 300000 // 5 minutes
          }
        );
      });

      const locationData: LocationData = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: Date.now()
      };

      setLocation(locationData);
      setPermissionStatus('granted');
      
      toast({
        title: "Location access granted",
        description: "Your location will be used for project mapping and nearby features.",
      });

      return true;
    } catch (error: any) {
      console.error('Location permission error:', error);
      
      if (error.code === 1) { // PERMISSION_DENIED
        setPermissionStatus('denied');
        toast({
          title: "Location access denied",
          description: "You can enable location access later in your browser settings for enhanced features.",
          variant: "destructive"
        });
      } else if (error.code === 2) { // POSITION_UNAVAILABLE
        toast({
          title: "Location unavailable",
          description: "Unable to retrieve your location. Please try again later.",
          variant: "destructive"
        });
      } else if (error.code === 3) { // TIMEOUT
        toast({
          title: "Location timeout",
          description: "Location request timed out. Please try again.",
          variant: "destructive"
        });
      } else {
        toast({
          title: "Location error",
          description: "An error occurred while accessing your location.",
          variant: "destructive"
        });
      }
      
      return false;
    } finally {
      setLoading(false);
    }
  };

  const checkPermissionStatus = async () => {
    if (!navigator.permissions) {
      return;
    }

    try {
      const result = await navigator.permissions.query({ name: 'geolocation' });
      
      switch (result.state) {
        case 'granted':
          setPermissionStatus('granted');
          break;
        case 'denied':
          setPermissionStatus('denied');
          break;
        default:
          setPermissionStatus('prompt');
      }
    } catch (error) {
      console.error('Permission check error:', error);
    }
  };

  useEffect(() => {
    checkPermissionStatus();
  }, []);

  return {
    location,
    permissionStatus,
    loading,
    requestLocationPermission
  };
};