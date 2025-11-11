export interface RecordingOptions {
  captureMode: 'screen' | 'window' | 'tab';
  includeAudio?: boolean;
  audioSources?: ('microphone' | 'system')[];
  quality: 'low' | 'medium' | 'high' | 'ultra';
  frameRate?: number;
  videoBitsPerSecond?: number;
  audioBitsPerSecond?: number;
}

export interface RecordingState {
  isRecording: boolean;
  isPaused: boolean;
  duration: number;
  startTime: number | null;
  chunks: Blob[];
}

export interface AnnotationMarker {
  timestamp: number;
  type: 'highlight' | 'arrow' | 'text' | 'pause' | 'navigation' | 'screenshot';
  data: any;
}

export interface QualityPreset {
  width: number;
  height: number;
  frameRate: number;
  videoBitrate: number;
  audioBitrate: number;
}
