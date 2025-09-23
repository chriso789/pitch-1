import React, { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Mic, MicOff, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface VoiceInterfaceProps {
  onTranscription: (text: string) => void;
  className?: string;
}

const VoiceInterface: React.FC<VoiceInterfaceProps> = ({ onTranscription, className = "" }) => {
  const { toast } = useToast();
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 24000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await processAudio(audioBlob);
        
        // Clean up stream
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);

      toast({
        title: "Recording started",
        description: "Speak now, click stop when finished",
      });
    } catch (error) {
      console.error('Error starting recording:', error);
      toast({
        title: "Recording failed",
        description: "Could not access microphone. Please check permissions.",
        variant: "destructive",
      });
    }
  }, [toast]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsProcessing(true);
    }
  }, [isRecording]);

  const processAudio = async (audioBlob: Blob) => {
    try {
      // Convert blob to base64
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64Audio = (reader.result as string).split(',')[1];
        
        // Send to transcription service
        const { data, error } = await supabase.functions.invoke('voice-transcribe', {
          body: { audio: base64Audio }
        });

        if (error) {
          throw error;
        }

        if (data?.text) {
          onTranscription(data.text);
          toast({
            title: "Transcription complete",
            description: `Detected: "${data.text}"`,
          });
        } else {
          toast({
            title: "No speech detected",
            description: "Please try recording again with clearer audio",
            variant: "destructive",
          });
        }
      };

      reader.readAsDataURL(audioBlob);
    } catch (error) {
      console.error('Error processing audio:', error);
      toast({
        title: "Transcription failed",
        description: "Could not process audio. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleToggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Button
        onClick={handleToggleRecording}
        disabled={isProcessing}
        size="sm"
        variant={isRecording ? "destructive" : "secondary"}
        className="flex items-center gap-2"
      >
        {isProcessing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : isRecording ? (
          <MicOff className="h-4 w-4" />
        ) : (
          <Mic className="h-4 w-4" />
        )}
        {isProcessing 
          ? "Processing..." 
          : isRecording 
          ? "Stop Recording" 
          : "Voice Input"
        }
      </Button>
      
      {isRecording && (
        <div className="flex items-center gap-1 text-red-600 text-sm">
          <div className="w-2 h-2 bg-red-600 rounded-full animate-pulse" />
          Recording...
        </div>
      )}
    </div>
  );
};

export default VoiceInterface;