import { useQuery } from '@tanstack/react-query';
import { Video, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';

interface TestimonialGalleryProps {
  tenantId: string;
  statusFilter?: string;
}

export const TestimonialGallery = ({ tenantId, statusFilter = 'published' }: TestimonialGalleryProps) => {
  const { data: testimonials, isLoading } = useQuery({
    queryKey: ['video-testimonials', tenantId, statusFilter],
    queryFn: async () => {
      let query = supabase
        .from('video_testimonials')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!testimonials?.length) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <Video className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No testimonials yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {testimonials.map((t: any) => (
        <Card key={t.id} className="overflow-hidden">
          <div className="aspect-video bg-black">
            <video src={t.video_url} controls className="w-full h-full object-cover" preload="metadata" />
          </div>
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {t.duration_seconds ? `${Math.floor(t.duration_seconds / 60)}:${(t.duration_seconds % 60).toString().padStart(2, '0')}` : '—'}
              </span>
              <Badge variant="outline" className="text-xs border-0 bg-muted">
                {t.status}
              </Badge>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};
