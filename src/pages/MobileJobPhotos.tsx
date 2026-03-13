import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveTenantId } from '@/hooks/useActiveTenantId';
import { logMobileActivity } from '@/lib/mobileActivityLogger';
import { Camera, ArrowLeft, X, ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import PendingSyncBadge from '@/components/mobile/PendingSyncBadge';
import { useToast } from '@/hooks/use-toast';

const LABELS = ['front_slope', 'rear_slope', 'valley', 'ridge', 'damage', 'drone', 'other'] as const;

const MobileJobPhotos = () => {
  const { id: jobId } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { activeTenantId } = useActiveTenantId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const { data: photos = [], isLoading } = useQuery({
    queryKey: ['job-media', jobId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_media')
        .select('*')
        .eq('job_id', jobId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!jobId,
  });

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !jobId || !user?.id || !activeTenantId) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('jobId', jobId);

      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mobile-upload`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${session?.access_token}` },
          body: formData,
        }
      );

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Upload failed');

      // Insert job_media record
      await supabase.from('job_media').insert({
        job_id: jobId,
        company_id: activeTenantId,
        uploaded_by: user.id,
        file_url: result.url,
        category: 'roof_photo',
        label: 'other',
        metadata_json: {
          capturedAt: new Date().toISOString(),
          capturedBy: user.id,
          source: 'mobile_camera',
        },
      });

      logMobileActivity({ activity_type: 'photo_uploaded', entity_type: 'job', entity_id: jobId });
      queryClient.invalidateQueries({ queryKey: ['job-media', jobId] });
      toast({ title: 'Photo uploaded' });
    } catch (err: any) {
      toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  // Group by label
  const grouped = photos.reduce((acc: Record<string, any[]>, photo: any) => {
    const label = photo.label || 'other';
    if (!acc[label]) acc[label] = [];
    acc[label].push(photo);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b border-border px-4 py-3 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-semibold text-foreground flex-1">Job Photos</h1>
        <label className="cursor-pointer">
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleUpload} />
          <Button asChild variant="default" size="sm" disabled={uploading}>
            <span><Camera className="h-4 w-4 mr-1" />{uploading ? 'Uploading...' : 'Capture'}</span>
          </Button>
        </label>
      </div>

      <ScrollArea className="h-[calc(100vh-56px)]">
        {isLoading ? (
          <div className="flex justify-center py-20">
            <ImageIcon className="h-8 w-8 animate-pulse text-muted-foreground" />
          </div>
        ) : photos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
            <Camera className="h-10 w-10" />
            <p className="text-sm">No photos yet — capture your first one</p>
          </div>
        ) : (
          <div className="p-4 space-y-6">
            {Object.entries(grouped).map(([label, items]) => (
              <div key={label}>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  {label.replace(/_/g, ' ')}
                </h3>
                <div className="grid grid-cols-3 gap-2">
                  {(items as any[]).map((photo: any) => (
                    <button
                      key={photo.id}
                      onClick={() => setPreviewUrl(photo.file_url)}
                      className="aspect-square rounded-lg overflow-hidden border border-border bg-muted"
                    >
                      <img src={photo.file_url} alt={label} className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Full-screen preview */}
      {previewUrl && (
        <div className="fixed inset-0 z-50 bg-black flex items-center justify-center" onClick={() => setPreviewUrl(null)}>
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-4 right-4 text-white"
            onClick={() => setPreviewUrl(null)}
          >
            <X className="h-6 w-6" />
          </Button>
          <img src={previewUrl} alt="Preview" className="max-w-full max-h-full object-contain" />
        </div>
      )}
    </div>
  );
};

export default MobileJobPhotos;
