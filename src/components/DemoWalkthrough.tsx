import React, { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Play, Pause, Square, RotateCcw, RotateCw, X, Video } from 'lucide-react';
import { cn } from '@/lib/utils';

const DemoWalkthrough = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const handlePlayPause = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleStop = () => {
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
      setIsPlaying(false);
      setCurrentTime(0);
    }
  };

  const handleRewind = () => {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 10);
    }
  };

  const handleFastForward = () => {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.min(duration, videoRef.current.currentTime + 10);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (videoRef.current) {
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const newTime = (clickX / rect.width) * duration;
      videoRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const demoFeatures = [
    { time: "0:00", feature: "Authentication & Login", status: "✅ Complete" },
    { time: "0:30", feature: "Role-based Dashboard", status: "✅ Complete" },
    { time: "1:00", feature: "Client List (Contacts + Jobs)", status: "✅ Complete" },
    { time: "1:30", feature: "Location Permission", status: "✅ Complete" },
    { time: "2:00", feature: "Pipeline Management", status: "🔄 Partial" },
    { time: "2:30", feature: "Estimate Builder", status: "🔄 Partial" },
    { time: "3:00", feature: "Project Mapping", status: "⏳ Pending" },
    { time: "3:30", feature: "Payment Processing", status: "🔄 Partial" },
    { time: "4:00", feature: "Calendar Integration", status: "🔄 Partial" },
    { time: "4:30", feature: "Smart Documentation", status: "🔄 Partial" },
    { time: "5:00", feature: "Reporting & Analytics", status: "⏳ Pending" },
    { time: "5:30", feature: "Mobile Optimization", status: "⏳ Pending" }
  ];

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button 
          variant="outline" 
          size="sm" 
          className="fixed top-4 right-4 z-50 bg-background/80 backdrop-blur-sm border-primary/20 hover:bg-primary/10"
        >
          <Video className="h-4 w-4 mr-2" />
          Demo Walkthrough
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-6xl h-[90vh] p-0">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle className="flex items-center justify-between">
            <span>CRM Demo Walkthrough</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </DialogTitle>
        </DialogHeader>
        
        <div className="flex h-full">
          {/* Video Player */}
          <div className="flex-1 p-6">
            <div className="bg-black rounded-lg overflow-hidden">
              <video
                ref={videoRef}
                className="w-full aspect-video"
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onEnded={() => setIsPlaying(false)}
              >
                {/* Placeholder - In real implementation, this would be the actual demo video */}
                <div className="w-full h-full bg-muted flex items-center justify-center">
                  <p className="text-muted-foreground">Demo video will be recorded here</p>
                </div>
              </video>
              
              {/* Video placeholder with demo content */}
              <div className="aspect-video bg-gradient-to-br from-primary/10 via-background to-accent/10 flex items-center justify-center">
                <div className="text-center space-y-4">
                  <Video className="h-16 w-16 mx-auto text-primary" />
                  <div>
                    <h3 className="text-xl font-semibold mb-2">Demo Video Recording</h3>
                    <p className="text-muted-foreground">
                      This will contain a full walkthrough of all CRM features
                    </p>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Progress Bar */}
            <div className="mt-4">
              <div 
                className="w-full h-2 bg-muted rounded-full cursor-pointer"
                onClick={handleSeek}
              >
                <div 
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
                />
              </div>
              <div className="flex justify-between text-sm text-muted-foreground mt-1">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>
            
            {/* Controls */}
            <div className="flex items-center justify-center space-x-4 mt-4">
              <Button variant="outline" size="sm" onClick={handleRewind}>
                <RotateCcw className="h-4 w-4" />
              </Button>
              <Button onClick={handlePlayPause}>
                {isPlaying ? (
                  <Pause className="h-4 w-4 mr-2" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                {isPlaying ? 'Pause' : 'Play'}
              </Button>
              <Button variant="outline" size="sm" onClick={handleStop}>
                <Square className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={handleFastForward}>
                <RotateCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
          
          {/* Feature Timeline */}
          <div className="w-80 border-l bg-muted/20 p-6">
            <h3 className="font-semibold mb-4">Feature Timeline</h3>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {demoFeatures.map((item, index) => (
                <div 
                  key={index}
                  className={cn(
                    "p-3 rounded-lg border cursor-pointer transition-colors",
                    "hover:bg-accent/50"
                  )}
                  onClick={() => {
                    // In real implementation, would seek to this time
                    console.log(`Seeking to ${item.time}`);
                  }}
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-sm font-medium text-primary">{item.time}</span>
                    <span className="text-xs">{item.status}</span>
                  </div>
                  <p className="text-sm">{item.feature}</p>
                </div>
              ))}
            </div>
            
            <div className="mt-6 p-4 bg-card rounded-lg border">
              <h4 className="font-medium mb-2">Demo Goals</h4>
              <ul className="text-sm space-y-1 text-muted-foreground">
                <li>• Identify missing features</li>
                <li>• Test user workflows</li>
                <li>• Plan completion strategy</li>
                <li>• Ensure CRM completeness</li>
              </ul>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default DemoWalkthrough;