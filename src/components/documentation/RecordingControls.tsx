import { useState } from 'react';
import { useScreenRecorder } from '@/hooks/useScreenRecorder';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { VideoIcon, Square, Pause, Play, Download, Mic, Monitor } from 'lucide-react';
import type { RecordingOptions } from '@/types/screenRecorder';

export function RecordingControls() {
  const {
    recordingState,
    isSupported,
    recordedBlob,
    formattedDuration,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    downloadVideo,
  } = useScreenRecorder();

  const [options, setOptions] = useState<RecordingOptions>({
    captureMode: 'screen',
    includeAudio: true,
    audioSources: ['microphone'],
    quality: 'high',
  });

  const handleStart = async () => {
    await startRecording(options);
  };

  const handleStop = async () => {
    await stopRecording();
  };

  const handlePause = async () => {
    if (recordingState.isPaused) {
      await resumeRecording();
    } else {
      await pauseRecording();
    }
  };

  const handleDownload = () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadVideo(`recording-${timestamp}.webm`);
  };

  if (!isSupported) {
    return (
      <Card className="p-6">
        <div className="text-center text-muted-foreground">
          <Monitor className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>Screen recording is not supported in this browser.</p>
          <p className="text-sm mt-2">Please use Chrome, Edge, or Firefox.</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Screen Recorder</h3>
          <p className="text-sm text-muted-foreground">
            Record walkthrough videos with narration
          </p>
        </div>
        {recordingState.isRecording && (
          <Badge variant={recordingState.isPaused ? 'secondary' : 'default'} className="text-lg px-4 py-2">
            {recordingState.isPaused ? '⏸️' : '🔴'} {formattedDuration}
          </Badge>
        )}
      </div>

      {!recordingState.isRecording && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="quality">Quality</Label>
              <Select
                value={options.quality}
                onValueChange={(value: any) => setOptions({ ...options, quality: value })}
              >
                <SelectTrigger id="quality">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low (480p)</SelectItem>
                  <SelectItem value="medium">Medium (720p)</SelectItem>
                  <SelectItem value="high">High (1080p)</SelectItem>
                  <SelectItem value="ultra">Ultra (1440p)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="captureMode">Capture Mode</Label>
              <Select
                value={options.captureMode}
                onValueChange={(value: any) => setOptions({ ...options, captureMode: value })}
              >
                <SelectTrigger id="captureMode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="screen">Entire Screen</SelectItem>
                  <SelectItem value="window">Window</SelectItem>
                  <SelectItem value="tab">Browser Tab</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mic className="h-4 w-4 text-muted-foreground" />
              <Label htmlFor="audio">Include Microphone Audio</Label>
            </div>
            <Switch
              id="audio"
              checked={options.includeAudio && options.audioSources?.includes('microphone')}
              onCheckedChange={(checked) =>
                setOptions({
                  ...options,
                  includeAudio: checked,
                  audioSources: checked ? ['microphone'] : [],
                })
              }
            />
          </div>
        </div>
      )}

      <div className="flex gap-2">
        {!recordingState.isRecording ? (
          <Button onClick={handleStart} className="flex-1" size="lg">
            <VideoIcon className="mr-2 h-5 w-5" />
            Start Recording
          </Button>
        ) : (
          <>
            <Button onClick={handlePause} variant="secondary" size="lg" className="flex-1">
              {recordingState.isPaused ? (
                <>
                  <Play className="mr-2 h-5 w-5" />
                  Resume
                </>
              ) : (
                <>
                  <Pause className="mr-2 h-5 w-5" />
                  Pause
                </>
              )}
            </Button>
            <Button onClick={handleStop} variant="destructive" size="lg" className="flex-1">
              <Square className="mr-2 h-5 w-5" />
              Stop
            </Button>
          </>
        )}
      </div>

      {recordedBlob && (
        <div className="space-y-2 pt-4 border-t">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Recording Complete</p>
              <p className="text-sm text-muted-foreground">
                Size: {(recordedBlob.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
            <Button onClick={handleDownload}>
              <Download className="mr-2 h-4 w-4" />
              Download
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
