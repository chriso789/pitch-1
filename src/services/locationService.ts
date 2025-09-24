import { supabase } from "@/integrations/supabase/client";

export interface LocationData {
  lat: number;
  lng: number;
  accuracy?: number;
  timestamp: string;
  address?: string;
}

export interface DistanceCalculation {
  distance: number;
  unit: "miles" | "km";
  duration?: number;
}

class LocationService {
  private watchId: number | null = null;

  /**
   * Get current user location
   */
  async getCurrentLocation(): Promise<LocationData> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Geolocation is not supported by this browser"));
        return;
      }

      const options = {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 300000, // 5 minutes
      };

      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const locationData: LocationData = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: new Date().toISOString(),
          };

          // Try to get address from coordinates
          try {
            const address = await this.reverseGeocode(locationData.lat, locationData.lng);
            locationData.address = address;
          } catch (error) {
            console.warn("Failed to reverse geocode location:", error);
          }

          resolve(locationData);
        },
        (error) => {
          reject(new Error(`Geolocation error: ${error.message}`));
        },
        options
      );
    });
  }

  /**
   * Watch user location changes
   */
  watchLocation(
    onLocationUpdate: (location: LocationData) => void,
    onError: (error: Error) => void
  ): () => void {
    if (!navigator.geolocation) {
      onError(new Error("Geolocation is not supported"));
      return () => {};
    }

    const options = {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000, // 1 minute
    };

    this.watchId = navigator.geolocation.watchPosition(
      async (position) => {
        const locationData: LocationData = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: new Date().toISOString(),
        };

        try {
          const address = await this.reverseGeocode(locationData.lat, locationData.lng);
          locationData.address = address;
        } catch (error) {
          console.warn("Failed to reverse geocode location:", error);
        }

        onLocationUpdate(locationData);
      },
      (error) => onError(new Error(`Geolocation error: ${error.message}`)),
      options
    );

    // Return cleanup function
    return () => this.stopWatching();
  }

  /**
   * Stop watching location
   */
  stopWatching(): void {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  /**
   * Calculate distance between two points using Haversine formula
   */
  calculateDistance(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
    unit: "miles" | "km" = "miles"
  ): DistanceCalculation {
    const R = unit === "miles" ? 3959 : 6371; // Earth's radius
    const dLat = this.toRadians(lat2 - lat1);
    const dLng = this.toRadians(lng2 - lng1);
    
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) *
        Math.cos(this.toRadians(lat2)) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    return {
      distance: Math.round(distance * 100) / 100,
      unit,
    };
  }

  /**
   * Check if location is within radius using database function
   */
  async isWithinRadius(
    userLocation: LocationData,
    targetLat: number,
    targetLng: number,
    radiusMiles: number = 50
  ): Promise<boolean> {
    try {
      const { data, error } = await supabase.rpc('check_location_radius', {
        user_location: {
          lat: userLocation.lat,
          lng: userLocation.lng,
        },
        target_lat: targetLat,
        target_lng: targetLng,
        radius_miles: radiusMiles,
      });

      if (error) throw error;
      return data;
    } catch (error) {
      console.error("Error checking location radius:", error);
      // Fallback to client-side calculation
      const result = this.calculateDistance(
        userLocation.lat,
        userLocation.lng,
        targetLat,
        targetLng,
        "miles"
      );
      return result.distance <= radiusMiles;
    }
  }

  /**
   * Update user's current location in database
   */
  async updateUserLocation(location: LocationData): Promise<void> {
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          current_location: {
            lat: location.lat,
            lng: location.lng,
            accuracy: location.accuracy,
            address: location.address,
          },
          location_updated_at: new Date().toISOString(),
        })
        .eq("id", (await supabase.auth.getUser()).data.user?.id);

      if (error) throw error;
    } catch (error) {
      console.error("Error updating user location:", error);
      throw error;
    }
  }

  /**
   * Get user's last known location from database
   */
  async getUserLocation(userId?: string): Promise<LocationData | null> {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("current_location, location_updated_at")
        .eq("id", userId || (await supabase.auth.getUser()).data.user?.id)
        .single();

      if (error) throw error;
      if (!data?.current_location) return null;

      const location = data.current_location as any;
      return {
        lat: location.lat,
        lng: location.lng,
        accuracy: location.accuracy,
        timestamp: data.location_updated_at || new Date().toISOString(),
        address: location.address,
      };
    } catch (error) {
      console.error("Error getting user location:", error);
      return null;
    }
  }

  /**
   * Reverse geocode coordinates to address
   */
  private async reverseGeocode(lat: number, lng: number): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!window.google?.maps) {
        reject(new Error("Google Maps not loaded"));
        return;
      }

      // @ts-ignore - Google Maps API
      const geocoder = new window.google.maps.Geocoder();
      // @ts-ignore - Google Maps API
      const latlng = new window.google.maps.LatLng(lat, lng);

      geocoder.geocode({ location: latlng }, (results, status) => {
        if (status === "OK" && results && results[0]) {
          resolve(results[0].formatted_address);
        } else {
          reject(new Error(`Geocoding failed: ${status}`));
        }
      });
    });
  }

  /**
   * Convert degrees to radians
   */
  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /**
   * Get route information between two points
   */
  async getRoute(
    origin: { lat: number; lng: number },
    destination: { lat: number; lng: number }
  ): Promise<{
    distance: DistanceCalculation;
    duration: number;
    polyline?: string;
  }> {
    return new Promise((resolve, reject) => {
      if (!window.google?.maps) {
        reject(new Error("Google Maps not loaded"));
        return;
      }

      // @ts-ignore - Google Maps API
      const directionsService = new window.google.maps.DirectionsService();

      directionsService.route(
        {
          // @ts-ignore - Google Maps API
          origin: new window.google.maps.LatLng(origin.lat, origin.lng),
          // @ts-ignore - Google Maps API
          destination: new window.google.maps.LatLng(destination.lat, destination.lng),
          // @ts-ignore - Google Maps API
          travelMode: window.google.maps.TravelMode.DRIVING,
        },
        (result, status) => {
          // @ts-ignore - Google Maps API
          if (status === window.google.maps.DirectionsStatus.OK && result) {
            const route = result.routes[0];
            const leg = route.legs[0];

            resolve({
              distance: {
                distance: leg.distance?.value ? leg.distance.value * 0.000621371 : 0, // Convert meters to miles
                unit: "miles" as const,
              },
              duration: leg.duration?.value || 0, // seconds
              polyline: route.overview_polyline?.points,
            });
          } else {
            reject(new Error(`Directions request failed: ${status}`));
          }
        }
      );
    });
  }
}

export const locationService = new LocationService();