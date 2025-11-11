import { useState, useEffect, useCallback } from 'react';
import { screenRecorder } from '@/services/screenRecorder';
import type { RecordingOptions, RecordingState, AnnotationMarker } from '@/types/screenRecorder';
import { toast } from 'sonner';

export function useScreenRecorder() {
  const [recordingState, setRecordingState] = useState<RecordingState>({
    isRecording: false,
    isPaused: false,
    duration: 0,
    startTime: null,
    chunks: [],
  });
  const [isSupported, setIsSupported] = useState(true);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);

  // Check browser support on mount
  useEffect(() => {
    setIsSupported(screenRecorder.isRecordingSupported());
  }, []);

  // Update state periodically while recording
  useEffect(() => {
    if (!recordingState.isRecording) return;

    const interval = setInterval(() => {
      const state = screenRecorder.getRecordingState();
      setRecordingState(state);
    }, 100);

    return () => clearInterval(interval);
  }, [recordingState.isRecording]);

  /**
   * Start recording
   */
  const startRecording = useCallback(async (options: RecordingOptions) => {
    try {
      await screenRecorder.startRecording(options);
      setRecordingState(screenRecorder.getRecordingState());
      setRecordedBlob(null);
      toast.success('Recording started');
    } catch (error: any) {
      console.error('Failed to start recording:', error);
      toast.error(error.message || 'Failed to start recording');
      throw error;
    }
  }, []);

  /**
   * Stop recording
   */
  const stopRecording = useCallback(async () => {
    try {
      const blob = await screenRecorder.stopRecording();
      setRecordedBlob(blob);
      setRecordingState(screenRecorder.getRecordingState());
      toast.success('Recording stopped');
      return blob;
    } catch (error: any) {
      console.error('Failed to stop recording:', error);
      toast.error(error.message || 'Failed to stop recording');
      throw error;
    }
  }, []);

  /**
   * Pause recording
   */
  const pauseRecording = useCallback(async () => {
    try {
      await screenRecorder.pauseRecording();
      setRecordingState(screenRecorder.getRecordingState());
      toast.info('Recording paused');
    } catch (error: any) {
      console.error('Failed to pause recording:', error);
      toast.error('Failed to pause recording');
    }
  }, []);

  /**
   * Resume recording
   */
  const resumeRecording = useCallback(async () => {
    try {
      await screenRecorder.resumeRecording();
      setRecordingState(screenRecorder.getRecordingState());
      toast.info('Recording resumed');
    } catch (error: any) {
      console.error('Failed to resume recording:', error);
      toast.error('Failed to resume recording');
    }
  }, []);

  /**
   * Add annotation marker
   */
  const addMarker = useCallback((type: AnnotationMarker['type'], data: any) => {
    screenRecorder.addAnnotationMarker(type, data);
  }, []);

  /**
   * Add text-to-speech narration
   */
  const addNarration = useCallback(async (text: string, voice?: string) => {
    try {
      await screenRecorder.addTextToSpeech(text, voice);
    } catch (error: any) {
      console.error('Failed to add narration:', error);
      toast.error('Failed to add narration');
    }
  }, []);

  /**
   * Download video
   */
  const downloadVideo = useCallback((filename?: string) => {
    try {
      screenRecorder.downloadVideo(filename);
      toast.success('Video downloaded');
    } catch (error: any) {
      console.error('Failed to download video:', error);
      toast.error('Failed to download video');
    }
  }, []);

  /**
   * Export video as blob
   */
  const exportVideo = useCallback(async (format: 'webm' | 'mp4' = 'webm') => {
    try {
      const blob = await screenRecorder.exportVideo(format);
      return blob;
    } catch (error: any) {
      console.error('Failed to export video:', error);
      toast.error('Failed to export video');
      throw error;
    }
  }, []);

  /**
   * Get annotation markers
   */
  const getMarkers = useCallback(() => {
    return screenRecorder.getAnnotationMarkers();
  }, []);

  /**
   * Format duration as MM:SS
   */
  const formatDuration = useCallback((ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }, []);

  return {
    // State
    recordingState,
    isSupported,
    recordedBlob,
    formattedDuration: formatDuration(recordingState.duration),

    // Actions
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    addMarker,
    addNarration,
    downloadVideo,
    exportVideo,
    getMarkers,
    formatDuration,
  };
}
