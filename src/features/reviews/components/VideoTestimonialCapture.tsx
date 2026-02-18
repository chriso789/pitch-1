import { useState, useRef, useCallback } from 'react';
import { Video, Square, Play, Upload, Loader2, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface VideoTestimonialCaptureProps {
  projectId?: string;
  contactId?: string;
  tenantId: string;
  onCaptured?: (id: string) => void;
}

export const VideoTestimonialCapture = ({
  projectId,
  contactId,
  tenantId,
  onCaptured,
}: VideoTestimonialCaptureProps) => {
  const { toast } = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const [recording, setRecording] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [uploading, setUploading] = useState(false);
  const [duration, setDuration] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        videoRef.current.play();
      }

      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        setRecordedBlob(blob);
        setPreviewUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach(t => t.stop());
      };

      mediaRecorderRef.current = recorder;
      recorder.start(1000);
      setRecording(true);
      setDuration(0);
      intervalRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    } catch {
      toast({ title: 'Camera Error', description: 'Could not access camera/microphone.', variant: 'destructive' });
    }
  }, [toast]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
    clearInterval(intervalRef.current);
  }, []);

  const discardRecording = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setRecordedBlob(null);
    setDuration(0);
  };

  const uploadRecording = async () => {
    if (!recordedBlob) return;
    setUploading(true);
    try {
      const fileName = `${tenantId}/${Date.now()}.webm`;
      const { error: uploadErr } = await supabase.storage
        .from('video-testimonials')
        .upload(fileName, recordedBlob, { contentType: 'video/webm' });
      if (uploadErr) throw uploadErr;

      const { data: urlData } = supabase.storage.from('video-testimonials').getPublicUrl(fileName);

      const { data: row, error: insertErr } = await supabase
        .from('video_testimonials')
        .insert({
          tenant_id: tenantId,
          project_id: projectId || null,
          contact_id: contactId || null,
          video_url: urlData.publicUrl,
          duration_seconds: duration,
          status: 'pending',
        })
        .select('id')
        .single();

      if (insertErr) throw insertErr;
      toast({ title: 'Uploaded', description: 'Video testimonial submitted for review.' });
      onCaptured?.(row.id);
      discardRecording();
    } catch (err) {
      console.error(err);
      toast({ title: 'Upload Failed', description: 'Could not upload video.', variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Video className="h-4 w-4" />
          Record Testimonial
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative rounded-lg overflow-hidden bg-black aspect-video">
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            src={previewUrl || undefined}
            controls={!!previewUrl}
            playsInline
          />
          {recording && (
            <div className="absolute top-3 right-3 flex items-center gap-2 bg-red-600 text-white px-2 py-1 rounded-full text-xs font-medium">
              <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
              REC {formatTime(duration)}
            </div>
          )}
        </div>

        <div className="flex gap-2 justify-center">
          {!recording && !previewUrl && (
            <Button onClick={startRecording}>
              <Play className="h-4 w-4 mr-1" /> Start Recording
            </Button>
          )}
          {recording && (
            <Button variant="destructive" onClick={stopRecording}>
              <Square className="h-4 w-4 mr-1" /> Stop
            </Button>
          )}
          {previewUrl && (
            <>
              <Button variant="outline" onClick={discardRecording}>
                <Trash2 className="h-4 w-4 mr-1" /> Discard
              </Button>
              <Button onClick={uploadRecording} disabled={uploading}>
                {uploading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
                Upload
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
