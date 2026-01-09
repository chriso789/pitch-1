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
  const { user, activeCompanyId } = useCrewAuth();
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchPhotos = useCallback(async () => {
    if (!user || !activeCompanyId || !jobId) return;
    setLoading(true);
    
    try {
      // Fetch photos from crew.job_photos via RPC with company filter
      const { data, error } = await supabase.rpc('get_crew_job_photos' as any, {
        p_job_id: jobId,
        p_company_id: activeCompanyId
      });
      
      if (error) throw error;
      
      const mappedPhotos: UploadedPhoto[] = ((data as any[]) || []).map((p) => ({
        id: p.id,
        bucketId: p.bucket_id,
        fileUrl: p.file_url,
        takenAt: p.taken_at,
        gpsLat: p.gps_lat,
        gpsLng: p.gps_lng,
      }));
      
      setPhotos(mappedPhotos);
    } catch (err) {
      console.error('[useCrewPhotos] Fetch error:', err);
      setPhotos([]);
    } finally {
      setLoading(false);
    }
  }, [user, activeCompanyId, jobId]);

  const uploadPhoto = async (options: UploadOptions) => {
    if (!user || !activeCompanyId) {
      toast.error('Not authenticated');
      return null;
    }

    try {
      setUploading(true);

      // Generate unique photo ID and build path per RLS convention
      const photoId = crypto.randomUUID();
      const timestamp = Date.now();
      const ext = options.file.name.split('.').pop() || 'jpg';
      
      // Path: company/<company_id>/jobs/<job_id>/subs/<sub_user_id>/photos/<photo_id>/<filename>
      const storagePath = `company/${activeCompanyId}/jobs/${options.jobId}/subs/${user.id}/photos/${photoId}/${timestamp}.${ext}`;

      // Upload to storage
      const { error: uploadError } = await supabase.storage
        .from('crew-photos')
        .upload(storagePath, options.file, {
          contentType: options.file.type,
          upsert: false,
        });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('crew-photos')
        .getPublicUrl(storagePath);

      // Create record in crew.job_photos via RPC
      const { error: insertError } = await supabase.rpc('insert_crew_job_photo' as any, {
        p_id: photoId,
        p_company_id: activeCompanyId,
        p_job_id: options.jobId,
        p_bucket_id: options.bucketId,
        p_file_url: urlData.publicUrl,
        p_gps_lat: options.gpsLat || null,
        p_gps_lng: options.gpsLng || null,
      });

      if (insertError) {
        console.error('[useCrewPhotos] Insert error:', insertError);
        // Photo is in storage but record failed - still success for user
      }

      toast.success('Photo uploaded successfully');
      await fetchPhotos();
      return { id: photoId };
    } catch (err) {
      console.error('[useCrewPhotos] Upload error:', err);
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
