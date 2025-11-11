import type { RecordingOptions, RecordingState, AnnotationMarker, QualityPreset } from '@/types/screenRecorder';

class ScreenRecorderService {
  private mediaRecorder: MediaRecorder | null = null;
  private currentStream: MediaStream | null = null;
  private recordingState: RecordingState = {
    isRecording: false,
    isPaused: false,
    duration: 0,
    startTime: null,
    chunks: [],
  };
  private annotationMarkers: AnnotationMarker[] = [];
  private durationInterval: number | null = null;

  /**
   * Check if screen recording is supported by the browser
   */
  isRecordingSupported(): boolean {
    return !!(
      navigator.mediaDevices &&
      navigator.mediaDevices.getDisplayMedia &&
      typeof MediaRecorder !== 'undefined'
    );
  }

  /**
   * Get quality preset configuration
   */
  private getQualityPreset(quality: string): QualityPreset {
    const presets: Record<string, QualityPreset> = {
      low: {
        width: 854,
        height: 480,
        frameRate: 30,
        videoBitrate: 1_000_000, // 1 Mbps
        audioBitrate: 64_000,     // 64 kbps
      },
      medium: {
        width: 1280,
        height: 720,
        frameRate: 30,
        videoBitrate: 2_500_000, // 2.5 Mbps
        audioBitrate: 128_000,    // 128 kbps
      },
      high: {
        width: 1920,
        height: 1080,
        frameRate: 60,
        videoBitrate: 5_000_000, // 5 Mbps
        audioBitrate: 192_000,    // 192 kbps
      },
      ultra: {
        width: 2560,
        height: 1440,
        frameRate: 60,
        videoBitrate: 8_000_000, // 8 Mbps
        audioBitrate: 256_000,    // 256 kbps
      },
    };

    return presets[quality] || presets.medium;
  }

  /**
   * Detect supported MIME type for recording
   */
  private getSupportedMimeType(): string {
    const types = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=h264,opus',
      'video/webm',
      'video/mp4',
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        console.log(`✅ Using codec: ${type}`);
        return type;
      }
    }

    throw new Error('No supported video codec found');
  }

  /**
   * Start screen recording
   */
  async startRecording(options: RecordingOptions): Promise<void> {
    if (!this.isRecordingSupported()) {
      throw new Error('Screen recording is not supported in this browser');
    }

    if (this.recordingState.isRecording) {
      throw new Error('Recording is already in progress');
    }

    try {
      // Get quality preset
      const preset = this.getQualityPreset(options.quality);

      // Request screen capture
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: preset.width },
          height: { ideal: preset.height },
          frameRate: { ideal: preset.frameRate },
        },
        audio: options.includeAudio && options.audioSources?.includes('system'),
      } as any);

      // Request microphone if needed
      let audioStream: MediaStream | null = null;
      if (options.includeAudio && options.audioSources?.includes('microphone')) {
        audioStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            sampleRate: 48000,
          },
        });
      }

      // Combine video and audio tracks
      const tracks: MediaStreamTrack[] = [...displayStream.getVideoTracks()];

      if (displayStream.getAudioTracks().length > 0) {
        tracks.push(...displayStream.getAudioTracks());
      }

      if (audioStream) {
        tracks.push(...audioStream.getAudioTracks());
      }

      const combinedStream = new MediaStream(tracks);
      this.currentStream = combinedStream;

      // Create MediaRecorder with optimal settings
      const recorderOptions = {
        mimeType: this.getSupportedMimeType(),
        videoBitsPerSecond: preset.videoBitrate,
        audioBitsPerSecond: preset.audioBitrate,
      };

      this.mediaRecorder = new MediaRecorder(combinedStream, recorderOptions);

      // Reset state
      this.recordingState.chunks = [];
      this.annotationMarkers = [];

      // Handle data chunks
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.recordingState.chunks.push(event.data);
        }
      };

      // Handle stop
      this.mediaRecorder.onstop = () => {
        this.handleRecordingStop();
      };

      // Start recording (collect chunks every 1 second)
      this.mediaRecorder.start(1000);
      this.recordingState.isRecording = true;
      this.recordingState.isPaused = false;
      this.recordingState.startTime = Date.now();
      this.recordingState.duration = 0;

      // Start duration tracking
      this.startDurationTracking();

      console.log('🎥 Recording started');
    } catch (error: any) {
      if (error.name === 'NotAllowedError') {
        throw new Error('Screen recording permission denied');
      } else if (error.name === 'NotFoundError') {
        throw new Error('No screen available to capture');
      } else {
        throw error;
      }
    }
  }

  /**
   * Stop screen recording
   */
  async stopRecording(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error('No active recording'));
        return;
      }

      // Set up one-time handler for when recording stops
      const originalOnStop = this.mediaRecorder.onstop;
      this.mediaRecorder.onstop = () => {
        if (originalOnStop) originalOnStop.call(this.mediaRecorder, new Event('stop'));

        const blob = new Blob(this.recordingState.chunks, {
          type: this.recordingState.chunks[0]?.type || 'video/webm',
        });

        console.log(`🎬 Recording stopped. Size: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);

        // Clean up
        this.cleanup();

        resolve(blob);
      };

      // Stop the recorder
      this.mediaRecorder.stop();

      // Stop all tracks
      if (this.currentStream) {
        this.currentStream.getTracks().forEach((track) => track.stop());
      }

      this.recordingState.isRecording = false;
    });
  }

  /**
   * Pause recording
   */
  async pauseRecording(): Promise<void> {
    if (this.mediaRecorder && this.recordingState.isRecording && !this.recordingState.isPaused) {
      this.mediaRecorder.pause();
      this.recordingState.isPaused = true;
      this.stopDurationTracking();
      console.log('⏸️ Recording paused');
    }
  }

  /**
   * Resume recording
   */
  async resumeRecording(): Promise<void> {
    if (this.mediaRecorder && this.recordingState.isPaused) {
      this.mediaRecorder.resume();
      this.recordingState.isPaused = false;
      this.startDurationTracking();
      console.log('▶️ Recording resumed');
    }
  }

  /**
   * Add annotation marker at current timestamp
   */
  addAnnotationMarker(type: AnnotationMarker['type'], data: any): void {
    if (!this.recordingState.isRecording) {
      console.warn('Cannot add marker: not recording');
      return;
    }

    const timestamp = Date.now() - (this.recordingState.startTime || 0);

    this.annotationMarkers.push({
      timestamp,
      type,
      data,
    });

    console.log(`📍 Marker added at ${(timestamp / 1000).toFixed(2)}s:`, { type, data });
  }

  /**
   * Add text-to-speech narration (Web Speech API)
   */
  async addTextToSpeech(text: string, voice?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!('speechSynthesis' in window)) {
        reject(new Error('Text-to-speech not supported'));
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);

      // Get available voices
      const voices = window.speechSynthesis.getVoices();
      const selectedVoice = voices.find((v) => v.name === voice) || voices[0];

      if (selectedVoice) {
        utterance.voice = selectedVoice;
      }

      utterance.rate = 0.9; // Slightly slower for clarity
      utterance.pitch = 1.0;
      utterance.volume = 1.0;

      utterance.onend = () => resolve();
      utterance.onerror = (error) => reject(error);

      window.speechSynthesis.speak(utterance);

      console.log(`🗣️ Narration: "${text}"`);
    });
  }

  /**
   * Download recorded video
   */
  downloadVideo(filename: string = 'recording.webm'): void {
    if (this.recordingState.chunks.length === 0) {
      throw new Error('No recording to download');
    }

    const blob = new Blob(this.recordingState.chunks, {
      type: 'video/webm',
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();

    // Clean up
    setTimeout(() => URL.revokeObjectURL(url), 100);

    console.log(`💾 Downloaded: ${filename}`);
  }

  /**
   * Export video as blob
   */
  async exportVideo(format: 'webm' | 'mp4' = 'webm'): Promise<Blob> {
    if (this.recordingState.chunks.length === 0) {
      throw new Error('No recording to export');
    }

    const mimeType = format === 'mp4' ? 'video/mp4' : 'video/webm';
    const blob = new Blob(this.recordingState.chunks, { type: mimeType });

    console.log(`📦 Exported ${format.toUpperCase()}: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);

    return blob;
  }

  /**
   * Get current recording state
   */
  getRecordingState(): RecordingState {
    return { ...this.recordingState };
  }

  /**
   * Get recording duration in milliseconds
   */
  getRecordingDuration(): number {
    return this.recordingState.duration;
  }

  /**
   * Get all annotation markers
   */
  getAnnotationMarkers(): AnnotationMarker[] {
    return [...this.annotationMarkers];
  }

  /**
   * Start tracking duration
   */
  private startDurationTracking(): void {
    this.durationInterval = window.setInterval(() => {
      if (this.recordingState.startTime && !this.recordingState.isPaused) {
        this.recordingState.duration = Date.now() - this.recordingState.startTime;
      }
    }, 100);
  }

  /**
   * Stop tracking duration
   */
  private stopDurationTracking(): void {
    if (this.durationInterval) {
      clearInterval(this.durationInterval);
      this.durationInterval = null;
    }
  }

  /**
   * Handle recording stop
   */
  private handleRecordingStop(): void {
    this.stopDurationTracking();
    console.log('🎬 Recording finalized');
  }

  /**
   * Clean up resources
   */
  private cleanup(): void {
    this.stopDurationTracking();

    if (this.currentStream) {
      this.currentStream.getTracks().forEach((track) => track.stop());
      this.currentStream = null;
    }

    this.mediaRecorder = null;
  }
}

// Export singleton instance
export const screenRecorder = new ScreenRecorderService();
