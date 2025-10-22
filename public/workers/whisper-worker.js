// Import Transformers.js
importScripts('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');

const { pipeline } = self.transformers;

let transcriber = null;

// Initialize Whisper model
self.addEventListener('message', async (e) => {
  const { type, audio } = e.data;

  if (type === 'init') {
    try {
      console.log('Loading Whisper model...');
      
      // Load Whisper tiny.en model (smallest, fastest)
      transcriber = await pipeline(
        'automatic-speech-recognition',
        'Xenova/whisper-tiny.en'
      );

      self.postMessage({ type: 'ready' });
      console.log('Whisper model loaded');
    } catch (error) {
      console.error('Failed to load model:', error);
      self.postMessage({ type: 'error', error: error.message });
    }
  }

  if (type === 'transcribe' && transcriber && audio) {
    try {
      // Transcribe audio chunk
      const result = await transcriber(audio, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: true,
      });

      self.postMessage({
        type: 'result',
        text: result.text,
        chunks: result.chunks,
      });
    } catch (error) {
      console.error('Transcription error:', error);
      self.postMessage({ type: 'error', error: error.message });
    }
  }
});
