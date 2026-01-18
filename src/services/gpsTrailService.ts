/**
 * GPS Trail Recording Service
 * Records rep location every 5-10 seconds during canvassing for verification
 */

import { supabase } from '@/integrations/supabase/client';

interface GPSPosition {
  lat: number;
  lng: number;
  accuracy?: number;
  speed?: number | null;
  heading?: number | null;
  altitude?: number | null;
}

interface TrailSession {
  sessionId: string;
  userId: string;
  tenantId: string;
  isRecording: boolean;
  watchId: number | null;
  recordingInterval: NodeJS.Timeout | null;
  lastPosition: GPSPosition | null;
  positionBuffer: GPSPosition[];
}

class GPSTrailService {
  private session: TrailSession | null = null;
  private readonly RECORDING_INTERVAL_MS = 5000; // Record every 5 seconds
  private readonly BATCH_SIZE = 10; // Flush to DB every 10 positions
  private readonly MIN_DISTANCE_METERS = 3; // Only record if moved at least 3 meters

  /**
   * Start recording GPS trail for a canvassing session
   */
  async startRecording(userId: string, tenantId: string): Promise<string> {
    // Stop any existing session
    await this.stopRecording();

    const sessionId = crypto.randomUUID();
    
    this.session = {
      sessionId,
      userId,
      tenantId,
      isRecording: true,
      watchId: null,
      recordingInterval: null,
      lastPosition: null,
      positionBuffer: [],
    };

    // Start watching position
    if ('geolocation' in navigator) {
      this.session.watchId = navigator.geolocation.watchPosition(
        (position) => this.onPositionUpdate(position),
        (error) => console.error('[GPSTrailService] Watch error:', error),
        {
          enableHighAccuracy: true,
          maximumAge: 1000,
          timeout: 10000,
        }
      );
    }

    // Set up interval to flush buffer to database
    this.session.recordingInterval = setInterval(
      () => this.flushBuffer(),
      this.RECORDING_INTERVAL_MS * this.BATCH_SIZE
    );

    console.log(`[GPSTrailService] Started recording session ${sessionId}`);
    return sessionId;
  }

  /**
   * Stop recording GPS trail
   */
  async stopRecording(): Promise<void> {
    if (!this.session) return;

    // Clear watch
    if (this.session.watchId !== null) {
      navigator.geolocation.clearWatch(this.session.watchId);
    }

    // Clear interval
    if (this.session.recordingInterval) {
      clearInterval(this.session.recordingInterval);
    }

    // Flush remaining buffer
    await this.flushBuffer();

    console.log(`[GPSTrailService] Stopped recording session ${this.session.sessionId}`);
    this.session = null;
  }

  /**
   * Handle position updates from geolocation API
   */
  private onPositionUpdate(position: GeolocationPosition): void {
    if (!this.session?.isRecording) return;

    const newPosition: GPSPosition = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy,
      speed: position.coords.speed,
      heading: position.coords.heading,
      altitude: position.coords.altitude,
    };

    // Check if we've moved enough to record
    if (this.session.lastPosition) {
      const distance = this.calculateDistanceMeters(
        this.session.lastPosition.lat,
        this.session.lastPosition.lng,
        newPosition.lat,
        newPosition.lng
      );

      if (distance < this.MIN_DISTANCE_METERS) {
        return; // Haven't moved enough
      }
    }

    // Add to buffer
    this.session.positionBuffer.push(newPosition);
    this.session.lastPosition = newPosition;

    // Flush if buffer is full
    if (this.session.positionBuffer.length >= this.BATCH_SIZE) {
      this.flushBuffer();
    }
  }

  /**
   * Flush position buffer to database
   */
  private async flushBuffer(): Promise<void> {
    if (!this.session || this.session.positionBuffer.length === 0) return;

    const positions = [...this.session.positionBuffer];
    this.session.positionBuffer = [];

    try {
      const records = positions.map((pos) => ({
        tenant_id: this.session!.tenantId,
        user_id: this.session!.userId,
        session_id: this.session!.sessionId,
        lat: pos.lat,
        lng: pos.lng,
        accuracy_meters: pos.accuracy || null,
        speed_mps: pos.speed || null,
        heading: pos.heading || null,
        altitude: pos.altitude || null,
        recorded_at: new Date().toISOString(),
      }));

      const { error } = await supabase
        .from('canvass_gps_trail')
        .insert(records);

      if (error) {
        console.error('[GPSTrailService] Failed to insert trail records:', error);
        // Add back to buffer for retry
        this.session!.positionBuffer.unshift(...positions);
      } else {
        console.log(`[GPSTrailService] Flushed ${records.length} positions to database`);
      }
    } catch (err) {
      console.error('[GPSTrailService] Error flushing buffer:', err);
    }
  }

  /**
   * Calculate distance between two coordinates in meters
   */
  calculateDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000; // Earth's radius in meters
    const dLat = this.toRad(lat2 - lat1);
    const dLng = this.toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  /**
   * Get current session info
   */
  getSession(): TrailSession | null {
    return this.session;
  }

  /**
   * Check if currently recording
   */
  isRecording(): boolean {
    return this.session?.isRecording ?? false;
  }

  /**
   * Get current position (latest recorded)
   */
  getLastPosition(): GPSPosition | null {
    return this.session?.lastPosition ?? null;
  }
}

// Export singleton instance
export const gpsTrailService = new GPSTrailService();
export default gpsTrailService;
