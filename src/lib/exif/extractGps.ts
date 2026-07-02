import exifr from 'exifr';

export interface PhotoGeo {
  latitude: number | null;
  longitude: number | null;
  takenAt: string | null;
}

/**
 * Extract GPS coordinates and capture date from an image File via EXIF.
 * Returns nulls silently on failure (non-image, no EXIF, corrupt tags, etc.).
 */
export async function extractPhotoGeo(file: File): Promise<PhotoGeo> {
  try {
    const data = await exifr.parse(file, {
      gps: true,
      pick: ['latitude', 'longitude', 'GPSLatitude', 'GPSLongitude', 'DateTimeOriginal', 'CreateDate'],
    });
    if (!data) return { latitude: null, longitude: null, takenAt: null };
    const lat = typeof data.latitude === 'number' ? data.latitude : null;
    const lng = typeof data.longitude === 'number' ? data.longitude : null;
    const rawDate: Date | string | undefined = data.DateTimeOriginal || data.CreateDate;
    let takenAt: string | null = null;
    if (rawDate) {
      const d = rawDate instanceof Date ? rawDate : new Date(rawDate);
      if (!Number.isNaN(d.getTime())) takenAt = d.toISOString();
    }
    return { latitude: lat, longitude: lng, takenAt };
  } catch {
    return { latitude: null, longitude: null, takenAt: null };
  }
}

/** Haversine distance in meters between two lat/lng points. */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
