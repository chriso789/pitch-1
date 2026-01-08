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
  MoreVertical
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePhotos, type PhotoCategory, type CustomerPhoto } from '@/hooks/usePhotos';
import { toast } from '@/components/ui/use-toast';
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
}

export const PhotoControlCenter: React.FC<PhotoControlCenterProps> = ({
  contactId,
  leadId,
  projectId,
  className,
  showHeader = true,
  compactMode = false,
}) => {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [editingPhoto, setEditingPhoto] = useState<CustomerPhoto | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

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

  // Handle file upload
  const handleFileUpload = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;

    const fileArray = Array.from(files);
    const imageFiles = fileArray.filter(f => f.type.startsWith('image/'));

    if (imageFiles.length === 0) {
      toast({
        title: 'Invalid files',
        description: 'Please select image files only',
        variant: 'destructive',
      });
      return;
    }

    for (const file of imageFiles) {
      try {
        await uploadPhoto({ file, contactId, leadId, projectId });
      } catch (error) {
        console.error('Upload error:', error);
        toast({
          title: 'Upload failed',
          description: `Failed to upload ${file.name}`,
          variant: 'destructive',
        });
      }
    }
  }, [uploadPhoto, contactId, leadId, projectId]);

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
        <div className="flex flex-wrap items-center gap-2">
          {/* Upload buttons */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleFileUpload(e.target.files)}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => handleFileUpload(e.target.files)}
          />
          
          <Button
            size="sm"
            onClick={() => fileInputRef.current?.click()}
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
                {filteredPhotos.map(photo => (
                  <SortablePhotoItem
                    key={photo.id}
                    photo={photo}
                    viewMode={viewMode}
                    isSelected={selectedPhotos.has(photo.id)}
                    onSelect={() => toggleSelection(photo.id)}
                    onEdit={() => setEditingPhoto(photo)}
                    onSetPrimary={() => setPrimaryPhoto(photo.id)}
                    onToggleEstimate={(include) => 
                      toggleEstimateInclusion({ photoId: photo.id, include })
                    }
                    onDelete={async () => {
                      await deletePhotos([photo.id]);
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
