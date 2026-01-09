import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useCrewAuth } from './useCrewAuth';
import { toast } from 'sonner';

interface UploadedPhoto {
  id: string;
  bucketId: string;
  fileUrl: string;
  takenAt: string;
  gpsLat: number | null;
  gpsLng: number | null;
}

interface UploadOptions {
  jobId: string;
  bucketId: string;
  file: File;
  gpsLat?: number;
  gpsLng?: number;
}

export function useCrewPhotos(jobId: string | null) {
  const { user, companyId } = useCrewAuth();
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchPhotos = useCallback(async () => {
    if (!user || !companyId || !jobId) return;
    setLoading(true);
    // Placeholder - photos will be fetched via edge function
    setPhotos([]);
    setLoading(false);
  }, [user, companyId, jobId]);

  const uploadPhoto = async (options: UploadOptions) => {
    if (!user || !companyId) {
      toast.error('Not authenticated');
      return null;
    }

    try {
      setUploading(true);

      const timestamp = Date.now();
      const ext = options.file.name.split('.').pop() || 'jpg';
      const filename = `${companyId}/${options.jobId}/${options.bucketId}/${timestamp}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('crew-photos')
        .upload(filename, options.file, {
          contentType: options.file.type,
          upsert: false,
        });

      if (uploadError) throw uploadError;

      toast.success('Photo uploaded successfully');
      await fetchPhotos();
      return { id: filename };
    } catch (err) {
      console.error('[useCrewPhotos] Error:', err);
      toast.error('Failed to upload photo');
      return null;
    } finally {
      setUploading(false);
    }
  };

  const getPhotosByBucket = (bucketId: string) => photos.filter(p => p.bucketId === bucketId);

  const getCurrentLocation = (): Promise<{ lat: number; lng: number } | null> => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  };

  const uploadPhotoWithGPS = async (options: Omit<UploadOptions, 'gpsLat' | 'gpsLng'>) => {
    const location = await getCurrentLocation();
    return uploadPhoto({ ...options, gpsLat: location?.lat, gpsLng: location?.lng });
  };

  return { photos, loading, uploading, fetchPhotos, uploadPhoto, uploadPhotoWithGPS, getPhotosByBucket, getCurrentLocation };
}
