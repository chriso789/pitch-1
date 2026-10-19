import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { 
  Camera, 
  X, 
  Check, 
  MapPin, 
  Loader2, 
  Image as ImageIcon,
  RotateCcw,
  Upload,
  Wifi,
  WifiOff,
  Mic
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { uploadCanvassPhoto } from '@/lib/canvass/canvassPhotos';
import { savePhotoOffline, getPendingPhotoCount } from './OfflinePhotoSyncManager';
import { VoiceNoteRecorder } from './VoiceNoteRecorder';
import { VoiceNoteRecorder } from './VoiceNoteRecorder';

interface CanvassPhotoCaptureProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId?: string;
  propertyAddress?: string;
  userLocation?: { lat: number; lng: number };
  onPhotoUploaded?: (photoUrl: string) => void;
}

type PhotoCategory = 'roof_damage' | 'siding_damage' | 'before' | 'after' | 'condition' | 'other';

const PHOTO_CATEGORIES: { value: PhotoCategory; label: string; color: string }[] = [
  { value: 'roof_damage', label: 'Roof Damage', color: 'bg-red-500' },
  { value: 'siding_damage', label: 'Siding Damage', color: 'bg-orange-500' },
  { value: 'before', label: 'Before', color: 'bg-blue-500' },
  { value: 'after', label: 'After', color: 'bg-green-500' },
  { value: 'condition', label: 'Condition', color: 'bg-purple-500' },
  { value: 'other', label: 'Other', color: 'bg-gray-500' },
];


export function CanvassPhotoCapture({
  open,
  onOpenChange,
  propertyId,
  propertyAddress,
  userLocation,
  onPhotoUploaded,
}: CanvassPhotoCaptureProps) {
  const { user } = useAuth();
  const tenantId = useEffectiveTenantId();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [category, setCategory] = useState<PhotoCategory>('roof_damage');
  const [notes, setNotes] = useState('');
  const [uploading, setUploading] = useState(false);
  const [gpsLocation, setGpsLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [voiceNoteBlob, setVoiceNoteBlob] = useState<Blob | null>(null);
  const [voiceNoteBase64, setVoiceNoteBase64] = useState<string | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);

  // Monitor online status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Check pending photos count
  useEffect(() => {
    async function checkPending() {
      try {
        const count = await getPendingPhotoCount();
        setPendingCount(count);
      } catch (e) {
        console.warn('Failed to check pending photos:', e);
      }
    }
    checkPending();
  }, []);

  // Start camera when dialog opens
  useEffect(() => {
    if (open) {
      startCamera();
      getGPSLocation();
    } else {
      stopCamera();
      setCapturedImage(null);
      setNotes('');
    }
  }, [open]);

  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      
      setStream(mediaStream);
      
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (error) {
      console.error('Failed to start camera:', error);
      toast.error('Could not access camera. Please check permissions.');
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  };

  const getGPSLocation = () => {
    if (userLocation) {
      setGpsLocation(userLocation);
      return;
    }

    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setGpsLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
        },
        (error) => {
          console.warn('GPS error:', error);
          toast.warning('Could not get GPS location');
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    }
  };

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    if (!ctx) return;

    // Set canvas size to video dimensions
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw video frame to canvas
    ctx.drawImage(video, 0, 0);

    // Add timestamp overlay
    const timestamp = new Date().toLocaleString();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, canvas.height - 40, canvas.width, 40);
    ctx.fillStyle = 'white';
    ctx.font = '16px monospace';
    ctx.fillText(timestamp, 10, canvas.height - 15);

    // Add GPS if available
    if (gpsLocation) {
      ctx.fillText(`📍 ${gpsLocation.lat.toFixed(6)}, ${gpsLocation.lng.toFixed(6)}`, 10, canvas.height - 55);
    }

    // Get image data
    const imageData = canvas.toDataURL('image/jpeg', 0.8);
    setCapturedImage(imageData);
    stopCamera();
  }, [gpsLocation]);

  const retakePhoto = () => {
    setCapturedImage(null);
    startCamera();
  };

  const uploadPhoto = async () => {
    if (!capturedImage || !tenantId || !user?.id) return;

    setUploading(true);

    try {
      // Convert base64 to blob
      const response = await fetch(capturedImage);
      const blob = await response.blob();

      if (!isOnline) {
        // Queue for the offline sync manager — it uploads and records
        // the photo automatically once the device is back online.
        await savePhotoOffline({
          blob,
          fileName: `${Date.now()}.jpg`,
          category,
          propertyId: propertyId ?? undefined,
          propertyAddress: propertyAddress ?? undefined,
          latitude: gpsLocation?.lat ?? 0,
          longitude: gpsLocation?.lng ?? 0,
          timestamp: new Date().toISOString(),
          tenantId,
          userId: user.id,
        });

        setPendingCount(prev => prev + 1);
        toast.success('Photo saved offline. Will upload when online.');
        onOpenChange(false);
        return;
      }

      // Upload to the private canvass-photos bucket, save the photo record
      // (canvass_photos) and log the activity.
      const recordId = await uploadCanvassPhoto({
        blob,
        tenantId,
        userId: user.id,
        propertyId,
        propertyAddress,
        category,
        notes,
        latitude: gpsLocation?.lat ?? null,
        longitude: gpsLocation?.lng ?? null,
      });

      const { data: { signedUrl } } = await supabase.storage
        .from('canvass-photos')
        .createSignedUrl(
          `${tenantId}/${propertyId || 'general'}/${Date.now()}.jpg`,
          60,
        );

      toast.success('Photo uploaded successfully');
      onPhotoUploaded?.(signedUrl || recordId);
      onOpenChange(false);

    } catch (error: any) {
      console.error('Upload error:', error);
      toast.error('Failed to upload photo: ' + error.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 overflow-hidden">
        <DialogHeader className="p-4 pb-2">
          <DialogTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Camera className="h-5 w-5" />
              Capture Photo
            </span>
            <div className="flex items-center gap-2">
              {isOnline ? (
                <Badge variant="outline" className="text-green-600">
                  <Wifi className="h-3 w-3 mr-1" />
                  Online
                </Badge>
              ) : (
                <Badge variant="outline" className="text-orange-600">
                  <WifiOff className="h-3 w-3 mr-1" />
                  Offline ({pendingCount} pending)
                </Badge>
              )}
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="px-4 space-y-4">
          {/* Property Info */}
          {propertyAddress && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4" />
              <span className="truncate">{propertyAddress}</span>
            </div>
          )}

          {/* Camera / Preview */}
          <div className="relative aspect-[4/3] bg-black rounded-lg overflow-hidden">
            {!capturedImage ? (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                
                {/* GPS indicator */}
                {gpsLocation && (
                  <div className="absolute top-2 left-2 bg-black/50 text-white text-xs px-2 py-1 rounded flex items-center gap-1">
                    <MapPin className="h-3 w-3 text-green-400" />
                    GPS Ready
                  </div>
                )}

                {/* Capture button */}
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
                  <Button
                    size="lg"
                    className="h-16 w-16 rounded-full"
                    onClick={capturePhoto}
                  >
                    <Camera className="h-8 w-8" />
                  </Button>
                </div>
              </>
            ) : (
              <>
                <img
                  src={capturedImage}
                  alt="Captured"
                  className="w-full h-full object-cover"
                />
                
                {/* Retake button */}
                <Button
                  variant="secondary"
                  size="sm"
                  className="absolute top-2 right-2"
                  onClick={retakePhoto}
                >
                  <RotateCcw className="h-4 w-4 mr-1" />
                  Retake
                </Button>
              </>
            )}
          </div>

          {/* Hidden canvas for capture */}
          <canvas ref={canvasRef} className="hidden" />

          {/* Category Selection */}
          {capturedImage && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">Category</label>
                <div className="flex flex-wrap gap-2">
                  {PHOTO_CATEGORIES.map((cat) => (
                    <Badge
                      key={cat.value}
                      variant={category === cat.value ? 'default' : 'outline'}
                      className={cn(
                        "cursor-pointer transition-all",
                        category === cat.value && cat.color
                      )}
                      onClick={() => setCategory(cat.value)}
                    >
                      {cat.label}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Notes with Voice Recording */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Notes (optional)</label>
                  <VoiceNoteRecorder
                    onRecordingComplete={async (blob, base64) => {
                      setVoiceNoteBlob(blob);
                      setVoiceNoteBase64(base64);
                      
                      // Transcribe if online
                      if (isOnline && tenantId) {
                        setIsTranscribing(true);
                        try {
                          const { data, error } = await supabase.functions.invoke('voice-transcribe', {
                            body: { 
                              audio: base64,
                              tenantId,
                            },
                          });
                          
                          if (data?.text) {
                            setNotes(prev => prev ? `${prev}\n\n🎤 ${data.text}` : `🎤 ${data.text}`);
                          }
                        } catch (err) {
                          console.error('Transcription error:', err);
                          toast.error('Could not transcribe voice note');
                        } finally {
                          setIsTranscribing(false);
                        }
                      }
                    }}
                    isTranscribing={isTranscribing}
                    maxDurationSeconds={60}
                  />
                </div>
                <Textarea
                  placeholder="Add notes about this photo or record a voice note..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                />
              </div>

              {/* Upload Button */}
              <div className="flex gap-2 pb-4">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  onClick={uploadPhoto}
                  disabled={uploading}
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4 mr-2" />
                  )}
                  {isOnline ? 'Upload' : 'Save Offline'}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
