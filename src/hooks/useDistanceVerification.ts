/**
 * Hook for distance verification during canvassing
 * Calculates distance between rep and property and provides verification status
 */

import { useMemo } from 'react';

export interface DistanceVerification {
  distanceMeters: number;
  distanceFeet: number;
  distanceMiles: number;
  isWithinRange: boolean;
  isWarning: boolean;
  isBlocked: boolean;
  verificationStatus: 'verified' | 'warning' | 'blocked';
  badgeVariant: 'default' | 'secondary' | 'destructive';
  badgeText: string;
}

// Distance thresholds in meters
const VERIFIED_THRESHOLD = 50; // < 50m = verified (green)
const WARNING_THRESHOLD = 100; // 50-100m = warning (yellow)
// > 100m = blocked (red)

/**
 * Calculate distance between two coordinates in meters
 */
export function calculateDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  if (!lat1 || !lng1 || !lat2 || !lng2) return 0;
  
  const R = 6371000; // Earth's radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

/**
 * Convert meters to feet
 */
export function metersToFeet(meters: number): number {
  return meters * 3.28084;
}

/**
 * Convert meters to miles
 */
export function metersToMiles(meters: number): number {
  return meters / 1609.344;
}

/**
 * Get verification status based on distance
 */
export function getVerificationStatus(
  distanceMeters: number
): DistanceVerification {
  const distanceFeet = metersToFeet(distanceMeters);
  const distanceMiles = metersToMiles(distanceMeters);
  
  const isWithinRange = distanceMeters <= VERIFIED_THRESHOLD;
  const isWarning = distanceMeters > VERIFIED_THRESHOLD && distanceMeters <= WARNING_THRESHOLD;
  const isBlocked = distanceMeters > WARNING_THRESHOLD;
  
  let verificationStatus: 'verified' | 'warning' | 'blocked';
  let badgeVariant: 'default' | 'secondary' | 'destructive';
  let badgeText: string;
  
  if (isWithinRange) {
    verificationStatus = 'verified';
    badgeVariant = 'default';
    badgeText = distanceFeet < 50 
      ? `📍 ${Math.round(distanceFeet)} ft - At door` 
      : `📍 ${Math.round(distanceFeet)} ft away`;
  } else if (isWarning) {
    verificationStatus = 'warning';
    badgeVariant = 'secondary';
    badgeText = `⚠️ ${Math.round(distanceFeet)} ft away`;
  } else {
    verificationStatus = 'blocked';
    badgeVariant = 'destructive';
    badgeText = distanceFeet > 1000 
      ? `🚫 ${distanceMiles.toFixed(2)} mi away - Too far` 
      : `🚫 ${Math.round(distanceFeet)} ft away - Too far`;
  }
  
  return {
    distanceMeters,
    distanceFeet,
    distanceMiles,
    isWithinRange,
    isWarning,
    isBlocked,
    verificationStatus,
    badgeVariant,
    badgeText,
  };
}

/**
 * Hook to get distance verification between user and property
 */
export function useDistanceVerification(
  userLocation: { lat: number; lng: number } | null,
  propertyLocation: { lat: number; lng: number } | null
): DistanceVerification | null {
  return useMemo(() => {
    if (!userLocation || !propertyLocation) return null;
    
    const distanceMeters = calculateDistanceMeters(
      userLocation.lat,
      userLocation.lng,
      propertyLocation.lat,
      propertyLocation.lng
    );
    
    return getVerificationStatus(distanceMeters);
  }, [userLocation, propertyLocation]);
}

export default useDistanceVerification;
