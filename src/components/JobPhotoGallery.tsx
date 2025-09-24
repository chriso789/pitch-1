import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/components/ui/use-toast';
import { 
  Camera, 
  Upload, 
  Image as ImageIcon, 
  Download, 
  Trash2, 
  Eye,
  Grid,
  List,
  Filter
} from 'lucide-react';

interface Photo {
  id: string;
  filename: string;
  file_path: string;
  file_size: number;
  description?: string;
  document_type: string;
  metadata?: {
    category?: string;
    step_id?: string;
    ai_analysis?: any;
  };
  created_at: string;
  uploaded_by: string;
}

interface JobPhotoGalleryProps {
  jobId: string;
}

export const JobPhotoGallery = ({ jobId }: JobPhotoGalleryProps) => {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
  const [uploadCategory, setUploadCategory] = useState('general');

  useEffect(() => {
    fetchPhotos();
  }, [jobId]);

  const fetchPhotos = async () => {
    try {
      // Mock data for now - replace with actual database query
      const mockPhotos: Photo[] = [
        {
          id: '1',
          filename: 'before_roof_01.jpg',
          file_path: '/storage/photos/before_roof_01.jpg',
          file_size: 2048576,
          description: 'Before photo - Front view of damaged roof',
          document_type: 'inspection_photo',
          metadata: {
            category: 'before',
            step_id: 'roof_overview'
          },
          created_at: '2024-01-15T10:30:00Z',
          uploaded_by: 'user123'
        },
        {
          id: '2', 
          filename: 'damage_detail_01.jpg',
          file_path: '/storage/photos/damage_detail_01.jpg',
          file_size: 1867432,
          description: 'Close-up of shingle damage on south side',
          document_type: 'inspection_photo',
          metadata: {
            category: 'damage',
            step_id: 'damage_assessment'
          },
          created_at: '2024-01-15T10:35:00Z',
          uploaded_by: 'user123'
        },
        {
          id: '3',
          filename: 'progress_day_3.jpg', 
          file_path: '/storage/photos/progress_day_3.jpg',
          file_size: 3145728,
          description: 'Progress photo - Day 3 of installation',
          document_type: 'progress_photo',
          metadata: {
            category: 'progress',
            step_id: 'installation'
          },
          created_at: '2024-01-18T15:20:00Z',
          uploaded_by: 'user123'
        },
        {
          id: '4',
          filename: 'completed_roof_final.jpg',
          file_path: '/storage/photos/completed_roof_final.jpg', 
          file_size: 4194304,
          description: 'Final completion photo - Full roof view',
          document_type: 'completion_photo',
          metadata: {
            category: 'after',
            step_id: 'final_inspection'
          },
          created_at: '2024-01-25T14:00:00Z',
          uploaded_by: 'user123'
        }
      ];
      
      setPhotos(mockPhotos);
    } catch (error) {
      console.error('Error fetching photos:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async () => {
    if (!selectedFiles || selectedFiles.length === 0) return;

    try {
      const uploadPromises = Array.from(selectedFiles).map(async (file) => {
        // Mock upload - replace with actual Supabase storage upload
        const mockPhoto: Photo = {
          id: Date.now().toString() + Math.random(),
          filename: file.name,
          file_path: `/storage/photos/${file.name}`,
          file_size: file.size,
          description: `Uploaded ${file.name}`,
          document_type: 'job_photo',
          metadata: {
            category: uploadCategory
          },
          created_at: new Date().toISOString(),
          uploaded_by: 'current_user'
        };
        return mockPhoto;
      });

      const newPhotos = await Promise.all(uploadPromises);
      setPhotos(prev => [...prev, ...newPhotos]);
      setShowUploadDialog(false);
      setSelectedFiles(null);

      toast({
        title: 'Success',
        description: `Uploaded ${newPhotos.length} photo(s) successfully`
      });
    } catch (error) {
      console.error('Error uploading photos:', error);
      toast({
        title: 'Error',
        description: 'Failed to upload photos',
        variant: 'destructive'
      });
    }
  };

  const deletePhoto = async (photoId: string) => {
    try {
      setPhotos(prev => prev.filter(p => p.id !== photoId));
      toast({
        title: 'Success',
        description: 'Photo deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting photo:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete photo',
        variant: 'destructive'
      });
    }
  };

  const downloadPhoto = (photo: Photo) => {
    // Mock download - replace with actual download logic
    toast({
      title: 'Download started',
      description: `Downloading ${photo.filename}`
    });
  };

  const filteredPhotos = photos.filter(photo => {
    if (categoryFilter === 'all') return true;
    return photo.metadata?.category === categoryFilter;
  });

  const getCategoryColor = (category?: string) => {
    const colors = {
      'before': 'bg-red-100 text-red-800',
      'progress': 'bg-blue-100 text-blue-800', 
      'after': 'bg-green-100 text-green-800',
      'damage': 'bg-orange-100 text-orange-800',
      'general': 'bg-gray-100 text-gray-800'
    };
    return colors[category as keyof typeof colors] || 'bg-gray-100 text-gray-800';
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const categories = ['all', 'before', 'progress', 'after', 'damage', 'general'];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Photo Gallery</h3>
          <p className="text-muted-foreground">{photos.length} photos uploaded</p>
        </div>
        <div className="flex items-center space-x-2">
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categories.map(cat => (
                <SelectItem key={cat} value={cat}>
                  {cat === 'all' ? 'All Categories' : cat.charAt(0).toUpperCase() + cat.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <Button
            variant="outline"
            size="sm"
            onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
          >
            {viewMode === 'grid' ? <List className="h-4 w-4" /> : <Grid className="h-4 w-4" />}
          </Button>

          <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Upload className="h-4 w-4 mr-2" />
                Upload Photos
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Upload Photos</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="photo_files">Select Photos</Label>
                  <Input
                    id="photo_files"
                    type="file"
                    multiple
                    accept="image/*"
                    onChange={(e) => setSelectedFiles(e.target.files)}
                  />
                </div>
                <div>
                  <Label htmlFor="category">Category</Label>
                  <Select value={uploadCategory} onValueChange={setUploadCategory}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="before">Before</SelectItem>
                      <SelectItem value="progress">Progress</SelectItem>
                      <SelectItem value="after">After</SelectItem>
                      <SelectItem value="damage">Damage</SelectItem>
                      <SelectItem value="general">General</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setShowUploadDialog(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleFileUpload} disabled={!selectedFiles}>
                    Upload
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Photos Grid/List */}
      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredPhotos.map((photo) => (
            <Card key={photo.id} className="overflow-hidden">
              <div className="aspect-square bg-muted flex items-center justify-center relative group">
                <ImageIcon className="h-12 w-12 text-muted-foreground" />
                {/* Overlay with actions */}
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center space-x-2">
                  <Button size="sm" variant="secondary" onClick={() => downloadPhoto(photo)}>
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => downloadPhoto(photo)}>
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => deletePhoto(photo.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <CardContent className="p-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-sm truncate">{photo.filename}</p>
                    {photo.metadata?.category && (
                      <Badge className={getCategoryColor(photo.metadata.category)} variant="outline">
                        {photo.metadata.category}
                      </Badge>
                    )}
                  </div>
                  {photo.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{photo.description}</p>
                  )}
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{formatFileSize(photo.file_size)}</span>
                    <span>{new Date(photo.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="space-y-0">
              {filteredPhotos.map((photo, index) => (
                <div key={photo.id} className={`p-4 flex items-center justify-between ${index > 0 ? 'border-t' : ''}`}>
                  <div className="flex items-center space-x-4">
                    <div className="h-12 w-12 bg-muted rounded flex items-center justify-center">
                      <ImageIcon className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium">{photo.filename}</p>
                      <p className="text-sm text-muted-foreground">{photo.description}</p>
                      <div className="flex items-center space-x-3 text-xs text-muted-foreground">
                        <span>{formatFileSize(photo.file_size)}</span>
                        <span>{new Date(photo.created_at).toLocaleDateString()}</span>
                        {photo.metadata?.category && (
                          <Badge className={getCategoryColor(photo.metadata.category)} variant="outline">
                            {photo.metadata.category}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button size="sm" variant="outline" onClick={() => downloadPhoto(photo)}>
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => downloadPhoto(photo)}>
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => deletePhoto(photo.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {filteredPhotos.length === 0 && (
        <Card>
          <CardContent className="p-12 text-center">
            <Camera className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-semibold text-lg mb-2">No photos found</h3>
            <p className="text-muted-foreground mb-4">
              {categoryFilter === 'all' 
                ? 'Upload some photos to get started'
                : `No photos in the "${categoryFilter}" category`
              }
            </p>
            <Button onClick={() => setShowUploadDialog(true)}>
              <Upload className="h-4 w-4 mr-2" />
              Upload Photos
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
};