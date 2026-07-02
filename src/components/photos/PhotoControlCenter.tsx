import React, { useState, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  DndContext, 
  closestCenter, 
  KeyboardSensor, 
  PointerSensor, 
  useSensor, 
  useSensors,
  DragEndEvent 
} from '@dnd-kit/core';
import { 
  arrayMove, 
  SortableContext, 
  sortableKeyboardCoordinates,
  rectSortingStrategy 
} from '@dnd-kit/sortable';
import { 
  Upload, 
  Camera, 
  Trash2, 
  Star, 
  FileText, 
  Grid3X3, 
  List, 
  Loader2,
  X,
  Check,
  ImageIcon,
  Edit2,
  Download,
  MoreVertical,
  MapPin,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePhotos, type PhotoCategory, type CustomerPhoto } from '@/hooks/usePhotos';
import { toast } from '@/components/ui/use-toast';
import { extractPhotoGeo, distanceMeters, type PhotoGeo } from '@/lib/exif/extractGps';
import { pickNativePhotos } from '@/lib/native/pickPhotos';
import { isNativeApp } from '@/lib/native/appMode';
import { exportPhotoReport } from '@/lib/photos/exportPhotoReport';
import { SortablePhotoItem } from './SortablePhotoItem';
import { PhotoMarkupEditor } from './PhotoMarkupEditor';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const CATEGORY_OPTIONS: { value: PhotoCategory; label: string; color: string }[] = [
  { value: 'before', label: 'Before', color: 'bg-blue-500/10 text-blue-600 border-blue-500/20' },
  { value: 'after', label: 'After', color: 'bg-green-500/10 text-green-600 border-green-500/20' },
  { value: 'damage', label: 'Damage', color: 'bg-red-500/10 text-red-600 border-red-500/20' },
  { value: 'materials', label: 'Materials', color: 'bg-orange-500/10 text-orange-600 border-orange-500/20' },
  { value: 'inspection', label: 'Inspection', color: 'bg-purple-500/10 text-purple-600 border-purple-500/20' },
  { value: 'roof', label: 'Roof', color: 'bg-amber-500/10 text-amber-600 border-amber-500/20' },
  { value: 'general', label: 'General', color: 'bg-gray-500/10 text-gray-600 border-gray-500/20' },
];

interface PhotoControlCenterProps {
  contactId?: string;
  leadId?: string;
  projectId?: string;
  className?: string;
  showHeader?: boolean;
  compactMode?: boolean;
  /** Project/lead location — enables geotagged sort so on-site photos upload first. */
  projectLatitude?: number;
  projectLongitude?: number;
  /** Radius (meters) considered "on-site". Default 500m. */
  onSiteRadiusMeters?: number;
  /** Address printed on the exported Photo Report cover. */
  propertyAddress?: string;
  /** Title for the exported Photo Report. Defaults to "Photo Report". */
  reportTitle?: string;
}


interface PendingPreview {
  id: string;
  file: File;
  previewUrl: string;
  geo: PhotoGeo;
  onSite: boolean;
  distanceM: number | null;
  status: 'queued' | 'uploading' | 'done' | 'error';
}

export const PhotoControlCenter: React.FC<PhotoControlCenterProps> = ({
  contactId,
  leadId,
  projectId,
  className,
  showHeader = true,
  compactMode = false,
  projectLatitude,
  projectLongitude,
  onSiteRadiusMeters = 500,
  propertyAddress,
  reportTitle,
}) => {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [editingPhoto, setEditingPhoto] = useState<CustomerPhoto | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [pendingPreviews, setPendingPreviews] = useState<PendingPreview[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const projectCoords =
    typeof projectLatitude === 'number' &&
    typeof projectLongitude === 'number' &&
    (projectLatitude !== 0 || projectLongitude !== 0)
      ? { lat: projectLatitude, lng: projectLongitude }
      : null;


  const {
    photos,
    isLoading,
    isUploading,
    uploadProgress,
    uploadPhoto,
    updatePhoto,
    deletePhotos,
    reorderPhotos,
    setPrimaryPhoto,
    toggleEstimateInclusion,
    estimatePhotos,
    photosByCategory,
  } = usePhotos({ contactId, leadId, projectId });

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Filter photos
  const filteredPhotos = filterCategory === 'all' 
    ? photos 
    : photos.filter(p => p.category === filterCategory);

  // Handle file upload — multi-file with instant previews + geotag prioritization
  const handleFileUpload = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;

    const fileArray = Array.from(files);
    const imageFiles = fileArray.filter(f =>
      f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name)
    );

    if (imageFiles.length === 0) {
      toast({
        title: 'Invalid files',
        description: 'Please select image files only',
        variant: 'destructive',
      });
      return;
    }

    // 1. Extract EXIF GPS from each file in parallel, then build previews
    const withGeo = await Promise.all(
      imageFiles.map(async (file) => {
        const geo = await extractPhotoGeo(file);
        const distanceM =
          projectCoords && geo.latitude != null && geo.longitude != null
            ? distanceMeters(projectCoords, { lat: geo.latitude, lng: geo.longitude })
            : null;
        const onSite = distanceM != null && distanceM <= onSiteRadiusMeters;
        return { file, geo, distanceM, onSite };
      })
    );

    // 2. Sort: on-site geotagged first, then any-geotagged nearest-first, then no-geo last
    withGeo.sort((a, b) => {
      if (a.onSite !== b.onSite) return a.onSite ? -1 : 1;
      const ad = a.distanceM ?? Number.POSITIVE_INFINITY;
      const bd = b.distanceM ?? Number.POSITIVE_INFINITY;
      return ad - bd;
    });

    // 3. Push instant previews into local state so the user sees thumbnails immediately
    const queued: PendingPreview[] = withGeo.map((w) => ({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      file: w.file,
      previewUrl: URL.createObjectURL(w.file),
      geo: w.geo,
      onSite: w.onSite,
      distanceM: w.distanceM,
      status: 'queued',
    }));
    setPendingPreviews((prev) => [...queued, ...prev]);

    const onSiteCount = queued.filter((q) => q.onSite).length;
    if (projectCoords && onSiteCount > 0) {
      toast({
        title: `${onSiteCount} photo${onSiteCount !== 1 ? 's' : ''} match this project's location`,
        description: 'On-site photos will upload first.',
      });
    }

    // 4. Upload serially, updating status per item
    for (const item of queued) {
      setPendingPreviews((prev) =>
        prev.map((p) => (p.id === item.id ? { ...p, status: 'uploading' } : p))
      );
      try {
        await uploadPhoto({
          file: item.file,
          contactId,
          leadId,
          projectId,
          geo: item.geo,
        });
        // Remove the preview once the real record lands via query invalidation
        setPendingPreviews((prev) => {
          const rest = prev.filter((p) => p.id !== item.id);
          URL.revokeObjectURL(item.previewUrl);
          return rest;
        });
      } catch (error) {
        console.error('Upload error:', error);
        setPendingPreviews((prev) =>
          prev.map((p) => (p.id === item.id ? { ...p, status: 'error' } : p))
        );
        toast({
          title: 'Upload failed',
          description: `Failed to upload ${item.file.name}`,
          variant: 'destructive',
        });
      }
    }
  }, [uploadPhoto, contactId, leadId, projectId, projectCoords, onSiteRadiusMeters]);


  // Handle drag end
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = photos.findIndex(p => p.id === active.id);
    const newIndex = photos.findIndex(p => p.id === over.id);
    
    const newOrder = arrayMove(photos, oldIndex, newIndex);
    reorderPhotos(newOrder.map(p => p.id));
  }, [photos, reorderPhotos]);

  // Toggle selection
  const toggleSelection = useCallback((photoId: string) => {
    setSelectedPhotos(prev => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  }, []);

  // Select all
  const handleSelectAll = useCallback(() => {
    if (selectedPhotos.size === filteredPhotos.length) {
      setSelectedPhotos(new Set());
    } else {
      setSelectedPhotos(new Set(filteredPhotos.map(p => p.id)));
    }
  }, [filteredPhotos, selectedPhotos.size]);

  // Bulk delete
  const handleBulkDelete = useCallback(async () => {
    if (selectedPhotos.size === 0) return;
    try {
      await deletePhotos(Array.from(selectedPhotos));
      setSelectedPhotos(new Set());
      setDeleteConfirmOpen(false);
    } catch (error) {
      console.error('Delete error:', error);
      toast({
        title: 'Delete failed',
        description: 'Failed to delete selected photos',
        variant: 'destructive',
      });
    }
  }, [deletePhotos, selectedPhotos]);

  // Bulk include in estimate
  const handleBulkEstimate = useCallback(async (include: boolean) => {
    for (const photoId of selectedPhotos) {
      try {
        await toggleEstimateInclusion({ photoId, include });
      } catch (error) {
        console.error('Toggle error:', error);
      }
    }
    setSelectedPhotos(new Set());
    toast({
      title: include ? 'Added to estimate' : 'Removed from estimate',
      description: `${selectedPhotos.size} photos updated`,
    });
  }, [selectedPhotos, toggleEstimateInclusion]);

  return (
    <Card className={cn('overflow-hidden', className)}>
      {showHeader && (
        <CardHeader className="pb-3 border-b">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Camera className="h-4 w-4" />
              Photo Gallery
              {photos.length > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {photos.length}
                </Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-8 w-8', viewMode === 'grid' && 'bg-muted')}
                onClick={() => setViewMode('grid')}
              >
                <Grid3X3 className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-8 w-8', viewMode === 'list' && 'bg-muted')}
                onClick={() => setViewMode('list')}
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
      )}

      <CardContent className={cn('space-y-4', showHeader ? 'pt-4' : 'pt-0')}>
        {/* Action Bar */}
        <div className="flex flex-wrap items-center gap-2 relative z-10">
          {/* Upload buttons */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.heic,.heif"
            multiple
            className="hidden"
            onChange={(e) => {
              handleFileUpload(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*,.heic,.heif"
            capture="environment"
            multiple
            className="hidden"
            onChange={(e) => {
              handleFileUpload(e.target.files);
              e.target.value = '';
            }}
          />

          
          <Button
            size="sm"
            onClick={async () => {
              // On native (Capacitor iOS/Android) use the OS photo picker so the
              // user gets a true multi-select from the Photos library. EXIF is
              // preserved so on-site photos still sort to the top via geotag.
              if (isNativeApp()) {
                const files = await pickNativePhotos();
                if (files && files.length) {
                  const dt = new DataTransfer();
                  files.forEach((f) => dt.items.add(f));
                  handleFileUpload(dt.files);
                  return;
                }
              }
              fileInputRef.current?.click();
            }}
            disabled={isUploading}
          >
            {isUploading ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                {uploadProgress}%
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-1.5" />
                Upload
              </>
            )}
          </Button>
          
          <Button
            size="sm"
            variant="outline"
            onClick={() => cameraInputRef.current?.click()}
            disabled={isUploading}
          >
            <Camera className="h-4 w-4 mr-1.5" />
            Take Photo
          </Button>

          <div className="flex-1" />

          {/* Category filter */}
          <Select value={filterCategory} onValueChange={setFilterCategory}>
            <SelectTrigger className="w-[130px] h-8 text-xs">
              <SelectValue placeholder="All Photos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Photos</SelectItem>
              {CATEGORY_OPTIONS.map(cat => (
                <SelectItem key={cat.value} value={cat.value}>
                  {cat.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Pending upload previews — visible instantly while photos upload */}
        {pendingPreviews.length > 0 && (
          <div className="space-y-2 rounded-lg border bg-muted/30 p-2">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-medium text-muted-foreground">
                Uploading {pendingPreviews.length} photo{pendingPreviews.length !== 1 ? 's' : ''}
                {projectCoords && pendingPreviews.some((p) => p.onSite) && (
                  <> · on-site photos prioritized</>
                )}
              </span>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
              {pendingPreviews.map((p) => (
                <div
                  key={p.id}
                  className={cn(
                    'relative aspect-square rounded-md overflow-hidden border bg-background',
                    p.status === 'error' && 'border-destructive'
                  )}
                >
                  <img
                    src={p.previewUrl}
                    alt={p.file.name}
                    className={cn(
                      'h-full w-full object-cover',
                      p.status === 'uploading' && 'opacity-60'
                    )}
                  />
                  {p.status === 'uploading' && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Loader2 className="h-5 w-5 animate-spin text-white drop-shadow" />
                    </div>
                  )}
                  {p.onSite && (
                    <Badge
                      variant="outline"
                      className="absolute top-1 left-1 h-5 px-1.5 py-0 text-[9px] bg-green-500/90 text-white border-0 gap-0.5"
                    >
                      <MapPin className="h-2.5 w-2.5" />
                      On-site
                    </Badge>
                  )}
                  {!p.onSite && p.distanceM != null && (
                    <Badge
                      variant="outline"
                      className="absolute top-1 left-1 h-5 px-1.5 py-0 text-[9px] bg-background/85 gap-0.5"
                    >
                      <MapPin className="h-2.5 w-2.5" />
                      {p.distanceM < 1000
                        ? `${Math.round(p.distanceM)}m`
                        : `${(p.distanceM / 1000).toFixed(1)}km`}
                    </Badge>
                  )}
                  {p.status === 'error' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-destructive/70">
                      <X className="h-5 w-5 text-white" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}


        {/* Bulk actions */}
        {selectedPhotos.size > 0 && (
          <div className="flex items-center gap-2 p-2 bg-muted rounded-lg">
            <Checkbox
              checked={selectedPhotos.size === filteredPhotos.length}
              onCheckedChange={handleSelectAll}
            />
            <span className="text-sm font-medium">
              {selectedPhotos.size} selected
            </span>
            <div className="flex-1" />
            <Button size="sm" variant="ghost" onClick={() => handleBulkEstimate(true)}>
              <FileText className="h-3.5 w-3.5 mr-1" />
              Add to Estimate
            </Button>
            <Button 
              size="sm" 
              variant="ghost" 
              className="text-destructive"
              onClick={() => setDeleteConfirmOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedPhotos(new Set())}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        {/* Photo Grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredPhotos.length === 0 ? (
          <div 
            className="flex flex-col items-center justify-center py-12 text-center border-2 border-dashed rounded-lg cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            <ImageIcon className="h-12 w-12 text-muted-foreground/50 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No photos yet</p>
            <p className="text-xs text-muted-foreground/75 mt-1">
              Click to upload or take a photo
            </p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={filteredPhotos.map(p => p.id)}
              strategy={rectSortingStrategy}
            >
              <div className={cn(
                viewMode === 'grid' 
                  ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3'
                  : 'space-y-2'
              )}>
                {filteredPhotos.map((photo, index) => (
                  <SortablePhotoItem
                    key={photo.id}
                    photo={photo}
                    viewMode={viewMode}
                    imageLoading={index < 8 ? 'eager' : 'lazy'}
                    isSelected={selectedPhotos.has(photo.id)}
                    onSelect={() => toggleSelection(photo.id)}
                    onEdit={() => setEditingPhoto(photo)}
                    onSetPrimary={() => setPrimaryPhoto(photo.id)}
                    onToggleEstimate={(include) => 
                      toggleEstimateInclusion({ photoId: photo.id, include })
                    }
                    onDelete={async () => {
                      try {
                        await deletePhotos([photo.id]);
                      } catch (err) {
                        console.error('[PhotoControlCenter] Delete failed:', err);
                      }
                    }}
                    onUpdateCategory={async (category) => {
                      await updatePhoto({ photoId: photo.id, category });
                    }}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        {/* Estimate photos summary */}
        {estimatePhotos.length > 0 && (
          <div className="flex items-center gap-2 p-2 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200 dark:border-green-900">
            <FileText className="h-4 w-4 text-green-600" />
            <span className="text-sm text-green-700 dark:text-green-400">
              {estimatePhotos.length} photo{estimatePhotos.length !== 1 ? 's' : ''} included in estimate
            </span>
          </div>
        )}
      </CardContent>

      {/* Markup Editor Dialog */}
      {editingPhoto && (
        <PhotoMarkupEditor
          photo={editingPhoto}
          open={!!editingPhoto}
          onOpenChange={(open) => !open && setEditingPhoto(null)}
          onSave={async (annotatedUrl) => {
            // Save annotated version
            toast({
              title: 'Annotations saved',
              description: 'Photo markup has been saved',
            });
            setEditingPhoto(null);
          }}
        />
      )}

      {/* Delete confirmation */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Photos</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedPhotos.size} photo{selectedPhotos.size !== 1 ? 's' : ''}? 
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleBulkDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};

export default PhotoControlCenter;
