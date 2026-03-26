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
  private watchers: Map<number, { lastReportedPosition: { lat: number; lng: number } | null }> = new Map();
  private nextWatcherId = 1;

  /**
   * Get current user location
   * @param options.skipGeocoding - If true, resolves immediately without waiting for address
   */
  /** Maximum accuracy radius (meters) to accept for initial map centering */
  static readonly ACCURACY_THRESHOLD = 5000; // relaxed — real protection is distance-from-area check

  /**
   * Get current user location
   * @param options.skipGeocoding - If true, resolves immediately without waiting for address
   * @param options.accuracyThreshold - Max accuracy radius in meters to accept (default 500m)
   */
  async getCurrentLocation(options?: { skipGeocoding?: boolean; accuracyThreshold?: number }): Promise<LocationData> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Geolocation is not supported by this browser"));
        return;
      }

      const geoOptions = {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0, // Always get fresh position for initial lock
      };

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const threshold = options?.accuracyThreshold ?? LocationService.ACCURACY_THRESHOLD;

          // Reject coarse fixes (e.g. IP-based geolocation returning ~2000m accuracy)
          if (position.coords.accuracy > threshold) {
            console.warn(
              `[LocationService] Rejecting coarse fix: accuracy=${position.coords.accuracy}m > threshold=${threshold}m`
            );
            const coarseError = new Error(`Location too imprecise (${Math.round(position.coords.accuracy)}m)`) as Error & { code?: number };
            coarseError.code = 99; // custom code for "too imprecise"
            reject(coarseError);
            return;
          }

          // Reject stale GPS fixes — Mobile Safari can return cached positions even with maximumAge: 0
          const fixAge = Date.now() - position.timestamp;
          if (fixAge > 60000) {
            console.warn(`[LocationService] Rejecting stale GPS fix: age=${Math.round(fixAge / 1000)}s`);
            const staleError = new Error(`GPS fix is stale (${Math.round(fixAge / 1000)}s old)`) as Error & { code?: number };
            staleError.code = 99;
            reject(staleError);
            return;
          }

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
          const geoError = new Error(`Geolocation error: ${error.message}`) as Error & { code?: number };
          geoError.code = error.code;
          reject(geoError);
        },
        geoOptions
      );
    });
  }

  /** Minimum distance in meters to report a new position (prevents jitter) */
  private static readonly MIN_DISTANCE_METERS = 5;

  /**
   * Calculate distance between two points in meters (Haversine)
   */
  private distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000;
    const dLat = this.toRadians(lat2 - lat1);
    const dLng = this.toRadians(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * Watch user location changes
   * Returns a cleanup function. Each call gets its own independent watcher.
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
      timeout: 30000,
      maximumAge: 0, // Force fresh GPS fixes — never use cached/stale positions
    };

    const watcherId = this.nextWatcherId++;
    this.watchers.set(watcherId, { lastReportedPosition: null });

    const browserWatchId = navigator.geolocation.watchPosition(
      async (position) => {
        const watcherState = this.watchers.get(watcherId);
        if (!watcherState) return; // watcher was cleaned up

        // Reject stale watch fixes (> 60s old)
        const fixAge = Date.now() - position.timestamp;
        if (fixAge > 60000) {
          console.warn(`[LocationService] Watch: rejecting stale fix (${Math.round(fixAge / 1000)}s old)`);
          return;
        }

        const newLat = position.coords.latitude;
        const newLng = position.coords.longitude;

        // Distance filter: only report if moved ≥5 meters from last reported position
        if (watcherState.lastReportedPosition) {
          const moved = this.distanceMeters(
            watcherState.lastReportedPosition.lat,
            watcherState.lastReportedPosition.lng,
            newLat,
            newLng
          );
          if (moved < LocationService.MIN_DISTANCE_METERS) {
            return; // Haven't moved enough — suppress jitter
          }
        }

        watcherState.lastReportedPosition = { lat: newLat, lng: newLng };

        const locationData: LocationData = {
          lat: newLat,
          lng: newLng,
          accuracy: position.coords.accuracy,
          timestamp: new Date().toISOString(),
        };

        // Fire location update immediately — don't wait for geocode
        onLocationUpdate(locationData);

        // Update address asynchronously (non-blocking)
        this.reverseGeocode(locationData.lat, locationData.lng)
          .then(address => { locationData.address = address; })
          .catch(() => {});
      },
      (error) => {
        const geoError = new Error(error.message) as Error & { code?: number };
        geoError.code = error.code;
        onError(geoError);
      },
      options
    );

    // Return cleanup function for this specific watcher
    return () => {
      navigator.geolocation.clearWatch(browserWatchId);
      this.watchers.delete(watcherId);
    };
  }

  /**
   * Stop all watchers (legacy compat)
   */
  stopWatching(): void {
    // Individual cleanup functions handle their own watchers now
    // This is kept for backward compat but is a no-op with the new pattern
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