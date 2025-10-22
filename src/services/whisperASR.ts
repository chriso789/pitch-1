import { supabase } from '@/integrations/supabase/client';

export class WhisperASR {
  private worker: Worker | null = null;
  private audioContext: AudioContext | null = null;
  private callId: string | null = null;
  private isInitialized = false;
  private onTranscriptCallback: ((text: string, speaker: string) => void) | null = null;

  async initialize() {
    if (this.isInitialized) return;

    // Create Web Worker
    this.worker = new Worker('/workers/whisper-worker.js');

    // Set up worker message handler
    this.worker.onmessage = (e) => {
      const { type, text, error } = e.data;

      if (type === 'ready') {
        console.log('Whisper ASR ready');
        this.isInitialized = true;
      }

      if (type === 'result' && text) {
        this.handleTranscript(text);
      }

      if (type === 'error') {
        console.error('Whisper error:', error);
      }
    };

    // Initialize worker
    this.worker.postMessage({ type: 'init' });

    // Create audio context
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  }

  startCapture(stream: MediaStream, callId: string) {
    if (!this.audioContext || !this.worker) {
      throw new Error('WhisperASR not initialized');
    }

    this.callId = callId;

    // Create MediaStreamSource
    const source = this.audioContext.createMediaStreamSource(stream);
    
    // Create ScriptProcessorNode for audio capture
    const processor = this.audioContext.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      
      // Downsample to 16kHz (Whisper expects 16kHz)
      const downsampledData = this.downsample(inputData, this.audioContext!.sampleRate, 16000);
      
      // Send to worker for transcription
      this.worker!.postMessage({
        type: 'transcribe',
        audio: downsampledData,
      });
    };

    source.connect(processor);
    processor.connect(this.audioContext.destination);
  }

  private downsample(buffer: Float32Array, fromSampleRate: number, toSampleRate: number): Float32Array {
    if (fromSampleRate === toSampleRate) {
      return buffer;
    }

    const ratio = fromSampleRate / toSampleRate;
    const newLength = Math.round(buffer.length / ratio);
    const result = new Float32Array(newLength);

    for (let i = 0; i < newLength; i++) {
      const srcIndex = Math.round(i * ratio);
      result[i] = buffer[srcIndex];
    }

    return result;
  }

  private async handleTranscript(text: string) {
    if (!this.callId || !text.trim()) return;

    // Send to database
    await supabase.functions.invoke('transcripts-ingest', {
      body: {
        call_id: this.callId,
        transcript_text: text,
        speaker: 'customer',
        timestamp_ms: Date.now(),
        is_partial: false,
      },
    });

    // Trigger callback
    if (this.onTranscriptCallback) {
      this.onTranscriptCallback(text, 'customer');
    }
  }

  onTranscript(callback: (text: string, speaker: string) => void) {
    this.onTranscriptCallback = callback;
  }

  stopCapture() {
    // Clean up audio context
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.isInitialized = false;
  }
}

export const whisperASR = new WhisperASR();
