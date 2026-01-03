import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Mic, Square, Play, Pause, Loader2, Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface VoiceNoteRecorderProps {
  onRecordingComplete: (audioBlob: Blob, base64Audio: string) => void;
  onTranscriptionComplete?: (text: string) => void;
  isTranscribing?: boolean;
  maxDurationSeconds?: number;
  className?: string;
}

export function VoiceNoteRecorder({
  onRecordingComplete,
  onTranscriptionComplete,
  isTranscribing = false,
  maxDurationSeconds = 120,
  className,
}: VoiceNoteRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      if (audioContextRef.current) audioContextRef.current.close();
    };
  }, [audioUrl]);

  // Auto-stop at max duration
  useEffect(() => {
    if (duration >= maxDurationSeconds && isRecording) {
      stopRecording();
    }
  }, [duration, maxDurationSeconds, isRecording]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Set up audio analysis for visualization
      audioContextRef.current = new AudioContext();
      analyserRef.current = audioContextRef.current.createAnalyser();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyserRef.current);
      analyserRef.current.fftSize = 256;
      
      // Start level monitoring
      monitorAudioLevel();
      
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      });
      
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      
      mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        
        // Create playback URL
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        
        // Convert to base64
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = reader.result as string;
          const base64Data = base64.split(',')[1]; // Remove data URL prefix
          onRecordingComplete(blob, base64Data);
        };
        reader.readAsDataURL(blob);
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };
      
      mediaRecorder.start(100); // Collect data every 100ms
      setIsRecording(true);
      setDuration(0);
      
      // Start timer
      timerRef.current = setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);
      
    } catch (error) {
      console.error('Failed to start recording:', error);
    }
  };

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);
      
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      
      setAudioLevel(0);
    }
  }, [isRecording]);

  const monitorAudioLevel = () => {
    if (!analyserRef.current) return;
    
    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    
    const updateLevel = () => {
      if (!analyserRef.current || !isRecording) return;
      
      analyserRef.current.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
      setAudioLevel(average / 255);
      
      animationFrameRef.current = requestAnimationFrame(updateLevel);
    };
    
    updateLevel();
  };

  const togglePlayback = () => {
    if (!audioUrl) return;
    
    if (!audioElementRef.current) {
      audioElementRef.current = new Audio(audioUrl);
      audioElementRef.current.onended = () => setIsPlaying(false);
    }
    
    if (isPlaying) {
      audioElementRef.current.pause();
      setIsPlaying(false);
    } else {
      audioElementRef.current.play();
      setIsPlaying(true);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const resetRecording = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioBlob(null);
    setAudioUrl(null);
    setDuration(0);
    audioElementRef.current = null;
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {!isRecording && !audioBlob && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={startRecording}
          className="flex items-center gap-2"
        >
          <Mic className="h-4 w-4" />
          Voice Note
        </Button>
      )}

      {isRecording && (
        <div className="flex items-center gap-2 bg-red-50 dark:bg-red-950/30 px-3 py-1.5 rounded-lg">
          {/* Pulsing recording indicator */}
          <div className="relative flex items-center justify-center">
            <div 
              className="absolute w-6 h-6 bg-red-500 rounded-full animate-ping opacity-30"
              style={{ transform: `scale(${0.8 + audioLevel * 0.4})` }}
            />
            <div className="w-3 h-3 bg-red-500 rounded-full" />
          </div>
          
          {/* Timer */}
          <span className="font-mono text-sm text-red-600 dark:text-red-400 min-w-[50px]">
            {formatTime(duration)}
          </span>
          
          {/* Audio level bars */}
          <div className="flex items-end gap-0.5 h-4">
            {[0.2, 0.4, 0.6, 0.8, 1.0].map((threshold, i) => (
              <div
                key={i}
                className={cn(
                  "w-1 rounded-full transition-all duration-75",
                  audioLevel >= threshold ? "bg-red-500" : "bg-red-200 dark:bg-red-800"
                )}
                style={{ height: `${(i + 1) * 3 + 2}px` }}
              />
            ))}
          </div>
          
          {/* Stop button */}
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={stopRecording}
            className="h-8 w-8 p-0"
          >
            <Square className="h-4 w-4" />
          </Button>
        </div>
      )}

      {audioBlob && !isRecording && (
        <div className="flex items-center gap-2 bg-muted/50 px-3 py-1.5 rounded-lg">
          <Volume2 className="h-4 w-4 text-muted-foreground" />
          
          <span className="font-mono text-sm text-muted-foreground">
            {formatTime(duration)}
          </span>
          
          {/* Playback controls */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={togglePlayback}
            className="h-8 w-8 p-0"
            disabled={isTranscribing}
          >
            {isPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </Button>
          
          {isTranscribing && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Transcribing...
            </div>
          )}
          
          {/* Re-record button */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={resetRecording}
            disabled={isTranscribing}
            className="text-xs"
          >
            Re-record
          </Button>
        </div>
      )}
    </div>
  );
}
