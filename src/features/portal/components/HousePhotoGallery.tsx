import React, { useState, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
  ChevronLeft, ChevronRight, Upload, X, 
  Image as ImageIcon, Maximize2, Loader2 
} from 'lucide-react';
import { CustomerPhoto } from '../hooks/useCustomerPortal';
import { cn } from '@/lib/utils';

interface HousePhotoGalleryProps {
  photos: CustomerPhoto[];
  onUpload: (file: File, description?: string) => Promise<void>;
  isUploading?: boolean;
}

export function HousePhotoGallery({ photos, onUpload, isUploading }: HousePhotoGalleryProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [fullscreenPhoto, setFullscreenPhoto] = useState<CustomerPhoto | null>(null);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [uploadDescription, setUploadDescription] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePrev = () => {
    setCurrentIndex(prev => (prev > 0 ? prev - 1 : photos.length - 1));
  };

  const handleNext = () => {
    setCurrentIndex(prev => (prev < photos.length - 1 ? prev + 1 : 0));
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      setShowUploadDialog(true);
    }
  };

  const handleUploadSubmit = async () => {
    if (!selectedFile) return;
    
    try {
      await onUpload(selectedFile, uploadDescription);
      setShowUploadDialog(false);
      setSelectedFile(null);
      setPreviewUrl(null);
      setUploadDescription('');
    } catch (error) {
      // Error handled in hook
    }
  };

  const handleCloseUpload = () => {
    setShowUploadDialog(false);
    setSelectedFile(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    setUploadDescription('');
  };

  if (photos.length === 0) {
    return (
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="relative aspect-video bg-muted flex flex-col items-center justify-center gap-4">
            <ImageIcon className="w-16 h-16 text-muted-foreground/50" />
            <p className="text-muted-foreground">No photos yet</p>
            <Button onClick={() => fileInputRef.current?.click()} variant="outline">
              <Upload className="w-4 h-4 mr-2" />
              Upload Photo
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {/* Main Image */}
          <div className="relative aspect-video bg-black">
            <img
              src={photos[currentIndex]?.file_url}
              alt={photos[currentIndex]?.file_name || 'Property photo'}
              className="w-full h-full object-contain"
            />
            
            {/* Navigation Arrows */}
            {photos.length > 1 && (
              <>
                <button
                  onClick={handlePrev}
                  className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition-colors"
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>
                <button
                  onClick={handleNext}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition-colors"
                >
                  <ChevronRight className="w-6 h-6" />
                </button>
              </>
            )}

            {/* Fullscreen Button */}
            <button
              onClick={() => setFullscreenPhoto(photos[currentIndex])}
              className="absolute top-2 right-2 w-10 h-10 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition-colors"
            >
              <Maximize2 className="w-5 h-5" />
            </button>

            {/* Upload Button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="absolute bottom-2 right-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-black/50 text-white hover:bg-black/70 transition-colors"
            >
              <Upload className="w-4 h-4" />
              <span className="text-sm">Add Photo</span>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
            />

            {/* Photo Counter */}
            <div className="absolute bottom-2 left-2 px-3 py-1 rounded-full bg-black/50 text-white text-sm">
              {currentIndex + 1} / {photos.length}
            </div>
          </div>

          {/* Thumbnail Strip */}
          {photos.length > 1 && (
            <div className="flex gap-2 p-3 overflow-x-auto bg-muted/50">
              {photos.map((photo, index) => (
                <button
                  key={photo.id}
                  onClick={() => setCurrentIndex(index)}
                  className={cn(
                    "w-16 h-16 rounded-md overflow-hidden shrink-0 border-2 transition-all",
                    index === currentIndex 
                      ? "border-primary ring-2 ring-primary/30" 
                      : "border-transparent hover:border-muted-foreground/30"
                  )}
                >
                  <img
                    src={photo.file_url}
                    alt={photo.file_name || 'Thumbnail'}
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Fullscreen Dialog */}
      <Dialog open={!!fullscreenPhoto} onOpenChange={() => setFullscreenPhoto(null)}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] p-0 bg-black border-none">
          <button
            onClick={() => setFullscreenPhoto(null)}
            className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70"
          >
            <X className="w-6 h-6" />
          </button>
          {fullscreenPhoto && (
            <img
              src={fullscreenPhoto.file_url}
              alt={fullscreenPhoto.file_name || 'Property photo'}
              className="w-full h-full object-contain"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Upload Dialog */}
      <Dialog open={showUploadDialog} onOpenChange={handleCloseUpload}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload Photo</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {previewUrl && (
              <div className="aspect-video rounded-lg overflow-hidden bg-muted">
                <img
                  src={previewUrl}
                  alt="Preview"
                  className="w-full h-full object-contain"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Input
                id="description"
                placeholder="Add a description..."
                value={uploadDescription}
                onChange={(e) => setUploadDescription(e.target.value)}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={handleCloseUpload}>
                Cancel
              </Button>
              <Button onClick={handleUploadSubmit} disabled={isUploading}>
                {isUploading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Upload
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
