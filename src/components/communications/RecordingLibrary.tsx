/**
 * Recording Library Component
 * Browse, play, and manage call recordings
 */

import { useState, useRef } from 'react';
import { format } from 'date-fns';
import { 
  Play, Pause, Download, Star, Search, 
  PhoneIncoming, PhoneOutgoing, Clock, User, FileText
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { CallRecording, useCommunications } from '@/hooks/useCommunications';

export const RecordingLibrary = () => {
  const [search, setSearch] = useState('');
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [selectedRecording, setSelectedRecording] = useState<CallRecording | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  
  const { recordings, recordingsLoading } = useCommunications();

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handlePlay = (recording: CallRecording) => {
    if (playingId === recording.id) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setPlayingId(null);
    } else {
      setPlayingId(recording.id);
      // Would trigger audio playback here
    }
  };

  const handleDownload = (recording: CallRecording) => {
    window.open(recording.recording_url, '_blank');
  };

  const getSentimentColor = (sentiment: string | null) => {
    switch (sentiment) {
      case 'positive':
        return 'bg-green-500/10 text-green-600 border-green-500/20';
      case 'negative':
        return 'bg-red-500/10 text-red-600 border-red-500/20';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  const filteredRecordings = recordings.filter(rec => {
    if (!search) return true;
    const contactName = rec.call_log?.contact 
      ? `${rec.call_log.contact.first_name} ${rec.call_log.contact.last_name}`.toLowerCase()
      : '';
    const phoneNumber = rec.call_log?.callee_number?.toLowerCase() || '';
    const searchLower = search.toLowerCase();
    return contactName.includes(searchLower) || phoneNumber.includes(searchLower);
  });

  return (
    <>
      <Card className="h-full flex flex-col">
        <CardHeader className="pb-3 shrink-0">
          <CardTitle className="text-lg flex items-center justify-between">
            Call Recordings
            <Badge variant="secondary">{recordings.length}</Badge>
          </CardTitle>
          <div className="relative mt-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search recordings..."
              className="pl-9"
            />
          </div>
        </CardHeader>

        <CardContent className="flex-1 p-0 overflow-hidden">
          <ScrollArea className="h-full">
            {recordingsLoading ? (
              <div className="p-4 text-center text-muted-foreground">
                Loading recordings...
              </div>
            ) : filteredRecordings.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No recordings found</p>
              </div>
            ) : (
              <div className="divide-y">
                {filteredRecordings.map((recording) => (
                  <div
                    key={recording.id}
                    className="p-4 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      {/* Play Button */}
                      <Button
                        variant="outline"
                        size="icon"
                        className="shrink-0 h-10 w-10"
                        onClick={() => handlePlay(recording)}
                      >
                        {playingId === recording.id ? (
                          <Pause className="h-4 w-4" />
                        ) : (
                          <Play className="h-4 w-4" />
                        )}
                      </Button>

                      {/* Info */}
                      <div 
                        className="flex-1 min-w-0 cursor-pointer"
                        onClick={() => setSelectedRecording(recording)}
                      >
                        <div className="flex items-center gap-2">
                          {recording.call_log?.direction === 'inbound' ? (
                            <PhoneIncoming className="h-4 w-4 text-green-500" />
                          ) : (
                            <PhoneOutgoing className="h-4 w-4 text-blue-500" />
                          )}
                          <span className="font-medium truncate">
                            {recording.call_log?.contact
                              ? `${recording.call_log.contact.first_name} ${recording.call_log.contact.last_name}`
                              : recording.call_log?.callee_number || 'Unknown'
                            }
                          </span>
                        </div>
                        
                        <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDuration(recording.duration_seconds)}
                          </span>
                          <span>
                            {format(new Date(recording.created_at), 'MMM d, h:mm a')}
                          </span>
                        </div>

                        {recording.ai_summary && (
                          <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                            {recording.ai_summary}
                          </p>
                        )}

                        <div className="flex items-center gap-2 mt-2">
                          {recording.sentiment && (
                            <Badge variant="outline" className={getSentimentColor(recording.sentiment)}>
                              {recording.sentiment}
                            </Badge>
                          )}
                          {recording.transcription && (
                            <Badge variant="outline">
                              <FileText className="h-3 w-3 mr-1" />
                              Transcribed
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleDownload(recording)}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                        >
                          <Star className={cn(
                            'h-4 w-4',
                            recording.is_starred && 'fill-yellow-400 text-yellow-400'
                          )} />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Recording Detail Dialog */}
      <Dialog open={!!selectedRecording} onOpenChange={() => setSelectedRecording(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              {selectedRecording?.call_log?.contact
                ? `${selectedRecording.call_log.contact.first_name} ${selectedRecording.call_log.contact.last_name}`
                : selectedRecording?.call_log?.callee_number
              }
            </DialogTitle>
          </DialogHeader>

          {selectedRecording && (
            <div className="space-y-4">
              {/* Audio Player */}
              <div className="p-4 bg-muted rounded-lg">
                <div className="flex items-center gap-4">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => handlePlay(selectedRecording)}
                  >
                    {playingId === selectedRecording.id ? (
                      <Pause className="h-5 w-5" />
                    ) : (
                      <Play className="h-5 w-5" />
                    )}
                  </Button>
                  <div className="flex-1">
                    <Slider
                      value={[currentTime]}
                      max={selectedRecording.duration_seconds || 100}
                      step={1}
                      className="w-full"
                    />
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {formatDuration(currentTime)} / {formatDuration(selectedRecording.duration_seconds)}
                  </span>
                </div>
              </div>

              {/* Metadata */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium">Date</p>
                  <p className="text-sm text-muted-foreground">
                    {format(new Date(selectedRecording.created_at), 'MMMM d, yyyy h:mm a')}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium">Duration</p>
                  <p className="text-sm text-muted-foreground">
                    {formatDuration(selectedRecording.duration_seconds)}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium">Direction</p>
                  <p className="text-sm text-muted-foreground capitalize">
                    {selectedRecording.call_log?.direction}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium">Sentiment</p>
                  <Badge variant="outline" className={getSentimentColor(selectedRecording.sentiment)}>
                    {selectedRecording.sentiment || 'Not analyzed'}
                  </Badge>
                </div>
              </div>

              {/* AI Summary */}
              {selectedRecording.ai_summary && (
                <div>
                  <p className="text-sm font-medium mb-2">AI Summary</p>
                  <p className="text-sm text-muted-foreground bg-muted p-3 rounded">
                    {selectedRecording.ai_summary}
                  </p>
                </div>
              )}

              {/* Transcription */}
              {selectedRecording.transcription && (
                <div>
                  <p className="text-sm font-medium mb-2">Transcription</p>
                  <ScrollArea className="h-48 bg-muted rounded p-3">
                    <p className="text-sm whitespace-pre-wrap">
                      {selectedRecording.transcription}
                    </p>
                  </ScrollArea>
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => handleDownload(selectedRecording)}>
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Hidden Audio Element */}
      <audio ref={audioRef} className="hidden" />
    </>
  );
};
