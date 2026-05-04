import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/components/ui/use-toast';
import { compressImage } from '@/lib/imageCompression';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';

export type PhotoCategory = 
  | 'before' | 'during' | 'after' | 'damage' | 'materials' 
  | 'roof' | 'siding' | 'gutters' | 'interior' | 'safety' 
  | 'inspection' | 'general' | 'other';

export interface CustomerPhoto {
  id: string;
  tenant_id: string;
  contact_id: string | null;
  lead_id: string | null;
  project_id: string | null;
  file_url: string;
  file_path?: string | null;
  file_name?: string | null;
  original_filename?: string | null;
  file_size: number | null;
  mime_type: string | null;
  category: string | null;
  description: string | null;
  display_order: number | null;
  uploaded_by: string | null;
  gps_latitude?: number | null;
  gps_longitude?: number | null;
  taken_at: string | null;
  include_in_estimate: boolean | null;
  is_primary: boolean | null;
  annotations_json?: Record<string, unknown> | null;
  ai_analysis?: Record<string, unknown> | null;
  uploaded_at?: string | null;
  created_at?: string;
  updated_at?: string | null;
}

interface UsePhotosOptions {
  contactId?: string;
  leadId?: string;
  projectId?: string;
  enabled?: boolean;
}

interface UploadPhotoOptions {
  file: File;
  category?: PhotoCategory;
  description?: string;
  contactId?: string;
  leadId?: string;
  projectId?: string;
}

export function usePhotos({ contactId, leadId, projectId, enabled = true }: UsePhotosOptions) {
  const queryClient = useQueryClient();
  const effectiveTenantId = useEffectiveTenantId();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Query key based on entity
  const queryKey = useMemo(
    () => ['customer-photos', effectiveTenantId, contactId || null, leadId || null, projectId || null],
    [effectiveTenantId, contactId, leadId, projectId]
  );

  // Fetch photos
  const { data: photos = [], isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      let query = supabase
        .from('customer_photos')
        .select('id, tenant_id, contact_id, lead_id, project_id, file_url, file_name, original_filename, file_size, mime_type, category, description, display_order, uploaded_by, gps_latitude, gps_longitude, taken_at, include_in_estimate, is_primary, uploaded_at')
        .eq('tenant_id', effectiveTenantId!)
        .order('display_order', { ascending: true, nullsFirst: false })
        .order('uploaded_at', { ascending: false });

      if (leadId) {
        query = query.eq('lead_id', leadId);
      } else if (contactId) {
        query = query.eq('contact_id', contactId);
      } else if (projectId) {
        query = query.eq('project_id', projectId);
      } else {
        return [];
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as unknown as CustomerPhoto[];
    },
    enabled: enabled && !!effectiveTenantId && !!(contactId || leadId || projectId),
    staleTime: 60_000,
    initialData: leadId ? () => queryClient.getQueryData<CustomerPhoto[]>(['lead-photos', leadId, effectiveTenantId]) : undefined,
  });

  // Upload photo
  const uploadPhoto = useCallback(async (options: UploadPhotoOptions) => {
    const { file, category = 'general', description } = options;
    const entityContactId = options.contactId || contactId;
    const entityLeadId = options.leadId || leadId;
    const entityProjectId = options.projectId || projectId;

    if (!entityContactId && !entityLeadId && !entityProjectId) {
      throw new Error('At least one entity ID required');
    }

    setIsUploading(true);
    setUploadProgress(10);

    try {
      // Get user and tenant
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id, active_tenant_id')
        .eq('id', user.id)
        .single();

      if (!profile) throw new Error('Profile not found');
      const tenantId = profile.active_tenant_id || profile.tenant_id;

      setUploadProgress(20);

      // Compress image client-side (converts HEIC, resizes large photos)
      const compressedFile = await compressImage(file);
      console.log(`[usePhotos] Compressed: ${file.name} ${(file.size/1024).toFixed(0)}KB → ${(compressedFile.size/1024).toFixed(0)}KB`);

      setUploadProgress(40);

      // Build storage path
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(7);
      const fileExt = compressedFile.name.split('.').pop() || 'jpg';
      const entityFolder = entityLeadId ? `leads/${entityLeadId}` : 
                           entityContactId ? `contacts/${entityContactId}` :
                           `projects/${entityProjectId}`;
      const storagePath = `${tenantId}/${entityFolder}/${timestamp}_${randomId}.${fileExt}`;

      // Upload directly to storage bucket (bypasses edge function memory limits)
      const { error: uploadError } = await supabase.storage
        .from('customer-photos')
        .upload(storagePath, compressedFile, {
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

      setUploadProgress(70);

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('customer-photos')
        .getPublicUrl(storagePath);

      // Insert record directly into customer_photos table
      const { data: photoRecord, error: dbError } = await supabase
        .from('customer_photos')
        .insert({
          tenant_id: tenantId,
          contact_id: entityContactId || null,
          lead_id: entityLeadId || null,
          project_id: entityProjectId || null,
          file_url: publicUrl,
          file_name: storagePath,
          original_filename: file.name,
          description: description || file.name,
          category,
          mime_type: compressedFile.type,
          file_size: compressedFile.size,
          uploaded_by: user.id,
          include_in_estimate: false,
        })
        .select()
        .single();

      if (dbError) {
        // Clean up orphaned storage file
        await supabase.storage.from('customer-photos').remove([storagePath]);
        throw new Error(`Database insert failed: ${dbError.message}`);
      }

      setUploadProgress(100);

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey });

      toast({
        title: 'Photo uploaded',
        description: 'Photo has been uploaded successfully',
      });

      return photoRecord as unknown as CustomerPhoto;
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  }, [contactId, leadId, projectId, queryClient, queryKey]);

  // Update photo
  const updatePhotoMutation = useMutation({
    mutationFn: async ({ 
      photoId, 
      category, 
      description, 
      includeInEstimate 
    }: { 
      photoId: string; 
      category?: string; 
      description?: string; 
      includeInEstimate?: boolean;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id, active_tenant_id')
        .eq('id', user.id)
        .single();

      if (!profile) throw new Error('Profile not found');

      const { data, error } = await supabase.functions.invoke('photo-upload', {
        body: {
          action: 'update',
          tenant_id: profile.active_tenant_id || profile.tenant_id,
          photo_id: photoId,
          category,
          description,
          include_in_estimate: includeInEstimate,
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Update failed');

      return data.data as CustomerPhoto;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  // Delete photo(s)
  const deletePhotosMutation = useMutation({
    mutationFn: async (photoIds: string[]) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id, active_tenant_id')
        .eq('id', user.id)
        .single();

      if (!profile) throw new Error('Profile not found');

      const { data, error } = await supabase.functions.invoke('photo-upload', {
        body: {
          action: 'delete',
          tenant_id: profile.active_tenant_id || profile.tenant_id,
          photo_ids: photoIds,
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Delete failed');

      return data.data;
    },
    onMutate: async (photoIds) => {
      await queryClient.cancelQueries({ queryKey });
      const previousPhotos = queryClient.getQueryData<CustomerPhoto[]>(queryKey);
      queryClient.setQueryData<CustomerPhoto[]>(queryKey, (current = []) =>
        current.filter((photo) => !photoIds.includes(photo.id))
      );
      return { previousPhotos };
    },
    onError: (_error, _photoIds, context) => {
      if (context?.previousPhotos) {
        queryClient.setQueryData(queryKey, context.previousPhotos);
      }
    },
    onSuccess: (_data, photoIds) => {
      queryClient.setQueryData<CustomerPhoto[]>(queryKey, (current = []) =>
        current.filter((photo) => !photoIds.includes(photo.id))
      );
      queryClient.invalidateQueries({ queryKey });
      if (leadId) queryClient.invalidateQueries({ queryKey: ['lead-photos', leadId, effectiveTenantId] });
      toast({
        title: 'Photos deleted',
        description: 'Selected photos have been deleted',
      });
    },
  });

  // Reorder photos
  const reorderPhotosMutation = useMutation({
    mutationFn: async (photoIds: string[]) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id, active_tenant_id')
        .eq('id', user.id)
        .single();

      if (!profile) throw new Error('Profile not found');

      const { data, error } = await supabase.functions.invoke('photo-upload', {
        body: {
          action: 'reorder',
          tenant_id: profile.active_tenant_id || profile.tenant_id,
          photo_ids: photoIds,
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Reorder failed');

      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  // Set primary photo
  const setPrimaryMutation = useMutation({
    mutationFn: async (photoId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id, active_tenant_id')
        .eq('id', user.id)
        .single();

      if (!profile) throw new Error('Profile not found');

      const { data, error } = await supabase.functions.invoke('photo-upload', {
        body: {
          action: 'set_primary',
          tenant_id: profile.active_tenant_id || profile.tenant_id,
          photo_id: photoId,
          lead_id: leadId,
          contact_id: contactId,
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Set primary failed');

      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({
        title: 'Primary photo set',
        description: 'This photo is now the primary photo',
      });
    },
  });

  // Toggle estimate inclusion
  const toggleEstimateMutation = useMutation({
    mutationFn: async ({ photoId, include }: { photoId: string; include: boolean }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id, active_tenant_id')
        .eq('id', user.id)
        .single();

      if (!profile) throw new Error('Profile not found');

      const { data, error } = await supabase.functions.invoke('photo-upload', {
        body: {
          action: 'toggle_estimate',
          tenant_id: profile.active_tenant_id || profile.tenant_id,
          photo_id: photoId,
          include_in_estimate: include,
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Toggle failed');

      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  // Get estimate photos only
  const estimatePhotos = photos.filter(p => p.include_in_estimate);

  // Get primary photo
  const primaryPhoto = photos.find(p => p.is_primary) || photos[0];

  // Group by category
  const photosByCategory = photos.reduce((acc, photo) => {
    const cat = photo.category || 'general';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(photo);
    return acc;
  }, {} as Record<string, CustomerPhoto[]>);

  return {
    photos,
    isLoading,
    error,
    refetch,
    isUploading,
    uploadProgress,
    uploadPhoto,
    updatePhoto: updatePhotoMutation.mutateAsync,
    deletePhotos: deletePhotosMutation.mutateAsync,
    reorderPhotos: reorderPhotosMutation.mutateAsync,
    setPrimaryPhoto: setPrimaryMutation.mutateAsync,
    toggleEstimateInclusion: toggleEstimateMutation.mutateAsync,
    estimatePhotos,
    primaryPhoto,
    photosByCategory,
  };
}
