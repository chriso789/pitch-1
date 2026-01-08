import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/components/ui/use-toast';

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
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Query key based on entity
  const queryKey = ['customer-photos', contactId, leadId, projectId].filter(Boolean);

  // Fetch photos
  const { data: photos = [], isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      let query = supabase
        .from('customer_photos')
        .select('*')
        .order('display_order', { ascending: true });

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
    enabled: enabled && !!(contactId || leadId || projectId),
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

      // Convert file to base64
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const fileData = await base64Promise;

      setUploadProgress(40);

      // Call edge function
      const { data, error } = await supabase.functions.invoke('photo-upload', {
        body: {
          action: 'upload',
          tenant_id: tenantId,
          contact_id: entityContactId,
          lead_id: entityLeadId,
          project_id: entityProjectId,
          file_data: fileData,
          file_name: file.name,
          mime_type: file.type,
          category,
          description,
        },
      });

      setUploadProgress(90);

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Upload failed');

      setUploadProgress(100);

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey });

      toast({
        title: 'Photo uploaded',
        description: 'Photo has been uploaded successfully',
      });

      return data.data as CustomerPhoto;
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
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
