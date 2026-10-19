import { useMemo, useState } from 'react';
import { SafeImage } from '@/components/ui/safe-image';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { GlobalLayout } from '@/shared/components/layout/GlobalLayout';
import { ArrowLeft, Search, Calendar, User, MapPin, Image as ImageIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { fetchCanvassPhotos, type CanvassPhotoRecord } from '@/lib/canvass/canvassPhotos';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { inspectCanvassPath } from '@/lib/photo-intelligence/training/canvass';

export default function StormCanvassPhotos() {
  const navigate = useNavigate();
  const tenantId = useEffectiveTenantId();
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFilter, setDateFilter] = useState<string>('all');
  const [selected, setSelected] = useState<CanvassPhotoRecord | null>(null);

  const { data: photos, isLoading } = useQuery({
    queryKey: ['canvass-photos', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      return fetchCanvassPhotos({ tenantId });
    },
    enabled: !!tenantId,
  });

  // Resolve uploader names (uploaded_by is a plain uuid, no FK to join on)
  const uploaderIds = useMemo(
    () => Array.from(new Set((photos ?? []).map((p) => p.uploaded_by).filter(Boolean) as string[])),
    [photos],
  );
  const { data: uploaderNames } = useQuery({
    queryKey: ['canvass-photo-uploaders', uploaderIds.join(',')],
    queryFn: async () => {
      if (uploaderIds.length === 0) return {} as Record<string, string>;
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', uploaderIds);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((p: any) => [p.id, p.full_name])) as Record<string, string>;
    },
    enabled: uploaderIds.length > 0,
  });

  const filteredPhotos = useMemo(() => (photos ?? []).filter((photo) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      !q || photo.property_address?.toLowerCase().includes(q) ||
      uploaderNames?.[photo.uploaded_by ?? '']?.toLowerCase().includes(q);
    if (!matchesSearch) return false;

    if (dateFilter === 'all') return true;
    const created = new Date(photo.created_at);
    const now = new Date();
    if (dateFilter === 'today') return created.toDateString() === now.toDateString();
    if (dateFilter === 'week') return now.getTime() - created.getTime() <= 7 * 24 * 60 * 60 * 1000;
    return true;
  }), [photos, searchQuery, dateFilter, uploaderNames]);

  return (
    <GlobalLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate('/storm-canvass')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">Photo Gallery</h1>
              <p className="text-muted-foreground">
                View and manage storm damage photos
              </p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by address or rep..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={dateFilter} onValueChange={setDateFilter}>
            <SelectTrigger className="w-[180px]">
              <Calendar className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Filter by date" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Time</SelectItem>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">This Week</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Photo Grid */}
        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">
            Loading photos...
          </div>
        ) : !filteredPhotos?.length ? (
          <Card className="py-12">
            <CardContent className="text-center">
              <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No photos yet</h3>
              <p className="text-muted-foreground mb-4">
                Photos captured during canvassing will appear here
              </p>
              <Button onClick={() => navigate('/storm-canvass/live')}>
                Start Canvassing
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filteredPhotos.map((photo) => (
              <Card key={photo.id} className="overflow-hidden group cursor-pointer hover:ring-2 hover:ring-primary transition-all" onClick={() => setSelected(photo)}>
                <div className="aspect-square bg-muted relative">
                  <SafeImage
                    src={photo.signed_url ?? ''}
                    alt={photo.property_address || 'Canvass photo'}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
                    <div className="text-white text-xs space-y-1">
                      {photo.property_address && (
                        <div className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          <span className="truncate">{photo.property_address}</span>
                        </div>
                      )}
                      {photo.uploaded_by && uploaderNames?.[photo.uploaded_by] && (
                        <div className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          <span>{uploaderNames[photo.uploaded_by]}</span>
                        </div>
                      )}
                      <div className="text-white/70">
                        {format(new Date(photo.created_at), 'MMM d, yyyy h:mm a')}
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Photo detail */}
        <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
          <DialogContent className="max-w-3xl p-0">
            {selected && (
              <div className="space-y-3">
                <SafeImage
                  src={selected.signed_url ?? ''}
                  alt={selected.property_address || 'Canvass photo'}
                  className="w-full max-h-[70vh] object-contain rounded-lg"
                />
                <div className="px-4 pb-4 space-y-1 text-sm">
                  {selected.property_address && (
                    <p className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      {selected.property_address}
                    </p>
                  )}
                  {selected.uploaded_by && uploaderNames?.[selected.uploaded_by] && (
                    <p className="flex items-center gap-2 text-muted-foreground">
                      <User className="h-4 w-4" />
                      {uploaderNames[selected.uploaded_by]} · {format(new Date(selected.created_at), 'MMM d, yyyy h:mm a')}
                    </p>
                  )}
                  {selected.category && selected.category !== 'other' && (
                    <p className="capitalize text-muted-foreground">Rep observation: {selected.category.replace('_', ' ')} · unverified</p>
                  )}
                  {selected.notes && <p className="text-muted-foreground">{selected.notes}</p>}
                  <Button variant="outline" disabled={!selected.property_id} onClick={() => navigate(inspectCanvassPath(selected.id))}>Inspect with Photo Intelligence</Button>
                  {!selected.property_id && <p className="text-muted-foreground">Property association required</p>}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </GlobalLayout>
  );
}
