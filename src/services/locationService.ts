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
   * @param options.skipGeocoding - If true, resolves immediately without waiting for address
   */
  async getCurrentLocation(options?: { skipGeocoding?: boolean }): Promise<LocationData> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Geolocation is not supported by this browser"));
        return;
      }

      const geoOptions = {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 300000, // 5 minutes
      };

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const locationData: LocationData = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: new Date().toISOString(),
          };

          // Resolve immediately if skipGeocoding is true
          if (options?.skipGeocoding) {
            resolve(locationData);
            // Fetch address in background (non-blocking)
            this.reverseGeocode(locationData.lat, locationData.lng)
              .then(address => {
                locationData.address = address;
              })
              .catch(error => {
                console.warn("Background geocode failed:", error);
              });
            return;
          }

          // Otherwise, wait for address (original behavior)
          this.reverseGeocode(locationData.lat, locationData.lng)
            .then(address => {
              locationData.address = address;
              resolve(locationData);
            })
            .catch(error => {
              console.warn("Failed to reverse geocode location:", error);
              resolve(locationData); // Resolve anyway without address
            });
        },
        (error) => {
          reject(new Error(`Geolocation error: ${error.message}`));
        },
        geoOptions
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
    // Use edge function proxy instead of direct Google Maps API
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await supabase.functions.invoke("google-maps-proxy", {
        body: {
          endpoint: "geocode",
          params: {
            latlng: `${lat},${lng}`
          }
        }
      });

      if (error) throw error;
      if (data.status === "OK" && data.results && data.results[0]) {
        return data.results[0].formatted_address;
      } else {
        throw new Error(`Geocoding failed: ${data.status}`);
      }
    } catch (error) {
      console.error("Reverse geocode error:", error);
      throw new Error("Failed to reverse geocode address");
    }
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
    // Use Google Distance Matrix API via edge function proxy
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await supabase.functions.invoke("google-maps-proxy", {
        body: {
          endpoint: "directions",
          params: {
            origin: `${origin.lat},${origin.lng}`,
            destination: `${destination.lat},${destination.lng}`,
            mode: "driving"
          }
        }
      });

      if (error) throw error;
      if (data.status === "OK" && data.routes && data.routes[0]) {
        const route = data.routes[0];
        const leg = route.legs[0];

        return {
          distance: {
            distance: leg.distance?.value ? leg.distance.value * 0.000621371 : 0, // Convert meters to miles
            unit: "miles" as const,
          },
          duration: leg.duration?.value || 0, // seconds
          polyline: route.overview_polyline?.points,
        };
      } else {
        throw new Error(`Directions request failed: ${data.status}`);
      }
    } catch (error) {
      console.error("Get route error:", error);
      throw new Error("Failed to calculate route");
    }
  }
}

export const locationService = new LocationService();