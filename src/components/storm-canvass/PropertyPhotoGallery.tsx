import React, { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { 
  ArrowLeft, 
  Camera, 
  ChevronLeft, 
  ChevronRight, 
  Download,
  Grid3X3,
  Image as ImageIcon,
  Layers,
  MapPin,
  X,
  Maximize2,
  Clock
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { BeforeAfterSlider } from './BeforeAfterSlider';
import { DamageAnnotationTool } from './DamageAnnotationTool';

interface PhotoData {
  id: string;
  photo_url: string;
  category: string;
  notes?: string;
  latitude?: number;
  longitude?: number;
  created_at: string;
  transcription?: string;
}

export function PropertyPhotoGallery() {
  const { propertyId } = useParams<{ propertyId: string }>();
  const navigate = useNavigate();
  const { profile } = useUserProfile();
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoData | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'timeline' | 'compare'>('grid');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [showAnnotationTool, setShowAnnotationTool] = useState(false);
  const [comparePhotos, setComparePhotos] = useState<{ before?: PhotoData; after?: PhotoData }>({});

  // Fetch photos for this property
  const { data: photos = [], isLoading } = useQuery({
    queryKey: ['property-photos', propertyId, profile?.tenant_id],
    queryFn: async () => {
      if (!profile?.tenant_id || !propertyId) return [];
      
      const { data, error } = await supabase
        .from('canvass_activity_log')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .eq('activity_type', 'photo_uploaded')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      
      // Filter by property and extract photo data
      return (data || [])
        .filter((log: any) => {
          const activityData = typeof log.activity_data === 'string' 
            ? JSON.parse(log.activity_data) 
            : log.activity_data;
          return activityData?.property_id === propertyId;
        })
        .map((log: any) => {
          const activityData = typeof log.activity_data === 'string'
            ? JSON.parse(log.activity_data)
            : log.activity_data;
          return {
            id: log.id,
            photo_url: activityData.photo_url,
            category: activityData.category || 'other',
            notes: activityData.notes,
            latitude: log.latitude,
            longitude: log.longitude,
            created_at: log.created_at,
            transcription: activityData.transcription,
          } as PhotoData;
        });
    },
    enabled: !!profile?.tenant_id && !!propertyId,
  });

  // Get unique categories
  const categories = useMemo(() => {
    const cats = new Set(photos.map(p => p.category));
    return ['all', ...Array.from(cats)];
  }, [photos]);

  // Filter photos by category
  const filteredPhotos = useMemo(() => {
    if (selectedCategory === 'all') return photos;
    return photos.filter(p => p.category === selectedCategory);
  }, [photos, selectedCategory]);

  // Find matching before/after pairs
  const photoPairs = useMemo(() => {
    const befores = photos.filter(p => p.category === 'before');
    const afters = photos.filter(p => p.category === 'after');
    return befores.map((before, i) => ({
      before,
      after: afters[i],
    })).filter(pair => pair.after);
  }, [photos]);

  const handleSelectForCompare = (photo: PhotoData, type: 'before' | 'after') => {
    setComparePhotos(prev => ({ ...prev, [type]: photo }));
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'roof_damage': return 'bg-red-500';
      case 'siding_damage': return 'bg-orange-500';
      case 'before': return 'bg-blue-500';
      case 'after': return 'bg-green-500';
      case 'condition': return 'bg-purple-500';
      default: return 'bg-muted-foreground';
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b">
        <div className="container max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <div>
                <h1 className="text-xl font-semibold">Property Photos</h1>
                <p className="text-sm text-muted-foreground">{photos.length} photos</p>
              </div>
            </div>

            {/* View mode toggle */}
            <div className="flex items-center gap-2">
              <Button
                variant={viewMode === 'grid' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('grid')}
              >
                <Grid3X3 className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === 'timeline' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('timeline')}
              >
                <Clock className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === 'compare' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('compare')}
                disabled={photoPairs.length === 0}
              >
                <Layers className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Category filter */}
          <div className="flex gap-2 mt-4 overflow-x-auto pb-2">
            {categories.map(cat => (
              <Badge
                key={cat}
                variant={selectedCategory === cat ? 'default' : 'outline'}
                className="cursor-pointer whitespace-nowrap"
                onClick={() => setSelectedCategory(cat)}
              >
                {cat === 'all' ? 'All Photos' : cat.replace('_', ' ')}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container max-w-6xl mx-auto px-4 py-6">
        {/* Grid View */}
        {viewMode === 'grid' && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredPhotos.map((photo) => (
              <div
                key={photo.id}
                className="relative aspect-square rounded-lg overflow-hidden cursor-pointer group"
                onClick={() => setSelectedPhoto(photo)}
              >
                <img
                  src={photo.photo_url}
                  alt={photo.category}
                  className="w-full h-full object-cover transition-transform group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <Badge
                  className={cn(
                    "absolute top-2 left-2 text-white text-xs",
                    getCategoryColor(photo.category)
                  )}
                >
                  {photo.category.replace('_', ' ')}
                </Badge>
                <div className="absolute bottom-2 left-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <p className="text-xs text-white truncate">
                    {format(new Date(photo.created_at), 'MMM d, h:mm a')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Timeline View */}
        {viewMode === 'timeline' && (
          <div className="space-y-6">
            {filteredPhotos.map((photo, index) => (
              <div key={photo.id} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className="w-3 h-3 rounded-full bg-primary" />
                  {index < filteredPhotos.length - 1 && (
                    <div className="w-0.5 flex-1 bg-border" />
                  )}
                </div>
                <div className="flex-1 pb-6">
                  <div className="flex items-start gap-4">
                    <div
                      className="w-32 h-24 rounded-lg overflow-hidden cursor-pointer shrink-0"
                      onClick={() => setSelectedPhoto(photo)}
                    >
                      <img
                        src={photo.photo_url}
                        alt={photo.category}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className={cn("text-xs text-white", getCategoryColor(photo.category))}>
                          {photo.category.replace('_', ' ')}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(photo.created_at), 'MMM d, yyyy h:mm a')}
                        </span>
                      </div>
                      {photo.notes && (
                        <p className="text-sm text-muted-foreground">{photo.notes}</p>
                      )}
                      {photo.transcription && (
                        <p className="text-sm text-muted-foreground italic mt-1">
                          🎤 "{photo.transcription}"
                        </p>
                      )}
                      {photo.latitude && photo.longitude && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                          <MapPin className="h-3 w-3" />
                          {photo.latitude.toFixed(6)}, {photo.longitude.toFixed(6)}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Compare View */}
        {viewMode === 'compare' && (
          <div className="space-y-8">
            {photoPairs.length > 0 ? (
              photoPairs.map((pair, index) => (
                <div key={index} className="space-y-2">
                  <h3 className="text-sm font-medium text-muted-foreground">
                    Comparison {index + 1}
                  </h3>
                  <BeforeAfterSlider
                    beforeImage={pair.before.photo_url}
                    afterImage={pair.after.photo_url}
                    beforeLabel="Before"
                    afterLabel="After"
                  />
                </div>
              ))
            ) : (
              <div className="text-center py-12">
                <Layers className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">
                  No matching before/after pairs found
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Upload photos with 'before' and 'after' categories to compare
                </p>
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {filteredPhotos.length === 0 && (
          <div className="text-center py-12">
            <ImageIcon className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No photos found</p>
          </div>
        )}
      </div>

      {/* Photo Detail Modal */}
      <Dialog open={!!selectedPhoto} onOpenChange={() => setSelectedPhoto(null)}>
        <DialogContent className="max-w-4xl p-0">
          {selectedPhoto && (
            <div className="relative">
              <img
                src={selectedPhoto.photo_url}
                alt={selectedPhoto.category}
                className="w-full h-auto max-h-[80vh] object-contain"
              />
              <Button
                variant="ghost"
                size="sm"
                className="absolute top-2 right-2"
                onClick={() => setSelectedPhoto(null)}
              >
                <X className="h-4 w-4" />
              </Button>
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Badge className={cn("text-white mb-2", getCategoryColor(selectedPhoto.category))}>
                      {selectedPhoto.category.replace('_', ' ')}
                    </Badge>
                    <p className="text-white text-sm">
                      {format(new Date(selectedPhoto.created_at), 'MMMM d, yyyy h:mm a')}
                    </p>
                    {selectedPhoto.notes && (
                      <p className="text-white/80 text-sm mt-1">{selectedPhoto.notes}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setShowAnnotationTool(true)}
                    >
                      Annotate
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      asChild
                    >
                      <a href={selectedPhoto.photo_url} download>
                        <Download className="h-4 w-4" />
                      </a>
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Annotation Tool Modal */}
      {showAnnotationTool && selectedPhoto && (
        <DamageAnnotationTool
          open={showAnnotationTool}
          onOpenChange={setShowAnnotationTool}
          imageUrl={selectedPhoto.photo_url}
          onSave={(annotatedImageUrl) => {
            console.log('Annotated image saved:', annotatedImageUrl);
            setShowAnnotationTool(false);
          }}
        />
      )}
    </div>
  );
}

export default PropertyPhotoGallery;
