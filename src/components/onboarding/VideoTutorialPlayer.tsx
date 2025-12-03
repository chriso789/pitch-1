/**
 * Video Tutorial Player Component
 * Embeds YouTube or Loom videos with watch tracking
 */

import { useState, useEffect } from 'react';
import { Play, CheckCircle2, Clock, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

interface VideoTutorialPlayerProps {
  videoType: 'youtube' | 'loom';
  videoId: string;
  title: string;
  description?: string;
  durationSeconds?: number;
  onWatchComplete?: () => void;
  onProgress?: (percent: number) => void;
}

export function VideoTutorialPlayer({
  videoType,
  videoId,
  title,
  description,
  durationSeconds,
  onWatchComplete,
  onProgress,
}: VideoTutorialPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [watchProgress, setWatchProgress] = useState(0);
  const [hasWatched, setHasWatched] = useState(false);

  // Generate embed URL based on video type
  const getEmbedUrl = () => {
    if (videoType === 'youtube') {
      return `https://www.youtube.com/embed/${videoId}?enablejsapi=1&rel=0`;
    } else if (videoType === 'loom') {
      return `https://www.loom.com/embed/${videoId}`;
    }
    return '';
  };

  // Format duration to MM:SS
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Simulate watch progress (in a real app, use YouTube/Loom API)
  useEffect(() => {
    if (!isPlaying || !durationSeconds) return;

    const interval = setInterval(() => {
      setWatchProgress(prev => {
        const newProgress = Math.min(prev + (100 / durationSeconds), 100);
        onProgress?.(newProgress);
        
        if (newProgress >= 80 && !hasWatched) {
          setHasWatched(true);
          onWatchComplete?.();
        }
        
        return newProgress;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isPlaying, durationSeconds, hasWatched, onWatchComplete, onProgress]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              {hasWatched && <CheckCircle2 className="h-5 w-5 text-green-500" />}
              {title}
            </CardTitle>
            {description && (
              <CardDescription className="mt-1">{description}</CardDescription>
            )}
          </div>
          {durationSeconds && (
            <Badge variant="secondary" className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDuration(durationSeconds)}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {/* Video Embed */}
        <div className="relative aspect-video bg-muted">
          {isPlaying ? (
            <iframe
              src={getEmbedUrl()}
              title={title}
              className="absolute inset-0 w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-primary/10 to-primary/5">
              {/* Thumbnail Placeholder */}
              <div className="text-center">
                <Button
                  size="lg"
                  className="rounded-full h-16 w-16 mb-4"
                  onClick={() => setIsPlaying(true)}
                >
                  <Play className="h-8 w-8 ml-1" />
                </Button>
                <p className="text-sm text-muted-foreground">Click to play video</p>
              </div>
            </div>
          )}
        </div>

        {/* Progress Bar */}
        {isPlaying && durationSeconds && (
          <div className="p-3 border-t">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-muted-foreground">Watch progress</span>
              <span className={hasWatched ? 'text-green-500 font-medium' : 'text-muted-foreground'}>
                {hasWatched ? '✓ Completed' : `${Math.round(watchProgress)}%`}
              </span>
            </div>
            <Progress value={watchProgress} className="h-1.5" />
          </div>
        )}

        {/* External Link */}
        <div className="p-3 border-t bg-muted/30">
          <a
            href={videoType === 'youtube' 
              ? `https://www.youtube.com/watch?v=${videoId}` 
              : `https://www.loom.com/share/${videoId}`
            }
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary hover:underline flex items-center gap-1"
          >
            Open in {videoType === 'youtube' ? 'YouTube' : 'Loom'}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

// Compact inline video for embedding in steps
interface InlineVideoProps {
  videoType: 'youtube' | 'loom';
  videoId: string;
  title: string;
}

export function InlineVideo({ videoType, videoId, title }: InlineVideoProps) {
  const [showVideo, setShowVideo] = useState(false);

  const getEmbedUrl = () => {
    if (videoType === 'youtube') {
      return `https://www.youtube.com/embed/${videoId}?rel=0&autoplay=1`;
    } else if (videoType === 'loom') {
      return `https://www.loom.com/embed/${videoId}?autoplay=1`;
    }
    return '';
  };

  if (!showVideo) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setShowVideo(true)}
        className="gap-2"
      >
        <Play className="h-4 w-4" />
        Watch: {title}
      </Button>
    );
  }

  return (
    <div className="relative aspect-video rounded-lg overflow-hidden border bg-muted mt-3">
      <iframe
        src={getEmbedUrl()}
        title={title}
        className="absolute inset-0 w-full h-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}
