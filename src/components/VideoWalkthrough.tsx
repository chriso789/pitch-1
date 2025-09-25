import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Play, 
  Pause, 
  Square, 
  SkipForward, 
  SkipBack,
  Volume2,
  VolumeX,
  Settings,
  Maximize,
  Minimize
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/components/ui/use-toast';

interface WalkthroughStep {
  id: string;
  title: string;
  description: string;
  narration: string;
  duration: number;
  action: string;
  visual: {
    highlight?: string;
    screenshot?: string;
    animation?: string;
  };
  captions: Array<{
    start: number;
    end: number;
    text: string;
  }>;
}

interface VideoWalkthroughProps {
  onSectionChange: (section: string) => void;
  isPlaying: boolean;
  onPlayingChange: (playing: boolean) => void;
}

export const VideoWalkthrough: React.FC<VideoWalkthroughProps> = ({
  onSectionChange,
  isPlaying,
  onPlayingChange
}) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [currentCaption, setCurrentCaption] = useState('');
  const [isBuffering, setIsBuffering] = useState(false);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { toast } = useToast();

  const walkthroughSteps: WalkthroughStep[] = [
    {
      id: 'intro',
      title: 'Welcome to PITCH CRM',
      description: 'Your comprehensive business management solution',
      narration: 'Welcome to PITCH CRM, your all-in-one business management platform designed to streamline your operations and boost productivity.',
      duration: 5000,
      action: 'overview',
      visual: {
        highlight: 'dashboard',
        animation: 'fade-in'
      },
      captions: [
        { start: 0, end: 2000, text: 'Welcome to PITCH CRM' },
        { start: 2000, end: 5000, text: 'Your comprehensive business management solution' }
      ]
    },
    {
      id: 'dashboard',
      title: 'Dashboard Overview',
      description: 'Monitor your key metrics and performance indicators',
      narration: 'The dashboard provides a comprehensive view of your business metrics, recent activities, and key performance indicators at a glance.',
      duration: 8000,
      action: 'navigate:dashboard',
      visual: {
        highlight: 'dashboard-metrics',
        screenshot: 'dashboard.png'
      },
      captions: [
        { start: 0, end: 3000, text: 'The dashboard shows your key metrics' },
        { start: 3000, end: 6000, text: 'Track performance indicators in real-time' },
        { start: 6000, end: 8000, text: 'View recent activities and updates' }
      ]
    },
    {
      id: 'pipeline',
      title: 'Lead Pipeline Management',
      description: 'Track and manage your sales opportunities',
      narration: 'The pipeline section allows you to visualize and manage your sales opportunities through different stages, from initial contact to closed deals.',
      duration: 10000,
      action: 'navigate:pipeline',
      visual: {
        highlight: 'pipeline-stages',
        animation: 'slide-right'
      },
      captions: [
        { start: 0, end: 3000, text: 'Navigate to the Pipeline section' },
        { start: 3000, end: 6000, text: 'Visualize sales opportunities by stage' },
        { start: 6000, end: 10000, text: 'Drag and drop leads between stages' }
      ]
    },
    {
      id: 'contacts',
      title: 'Contact Management',
      description: 'Organize and track all your business contacts',
      narration: 'The contact management system helps you organize customer information, track interactions, and maintain detailed profiles for better relationship management.',
      duration: 7000,
      action: 'navigate:client-list',
      visual: {
        highlight: 'contact-list',
        animation: 'zoom-in'
      },
      captions: [
        { start: 0, end: 2500, text: 'Access your contact database' },
        { start: 2500, end: 5000, text: 'View detailed customer profiles' },
        { start: 5000, end: 7000, text: 'Track interaction history' }
      ]
    },
    {
      id: 'estimates',
      title: 'Estimate Creation',
      description: 'Generate professional quotes and proposals',
      narration: 'Create professional estimates and proposals with our dynamic pricing engine, customizable templates, and automated calculations.',
      duration: 9000,
      action: 'navigate:estimates',
      visual: {
        highlight: 'estimate-builder',
        animation: 'slide-up'
      },
      captions: [
        { start: 0, end: 3000, text: 'Open the estimates section' },
        { start: 3000, end: 6000, text: 'Use templates for quick creation' },
        { start: 6000, end: 9000, text: 'Dynamic pricing and calculations' }
      ]
    },
    {
      id: 'projects',
      title: 'Project Tracking',
      description: 'Monitor project progress and resource allocation',
      narration: 'Track your projects from initiation to completion with timeline management, resource allocation, and progress monitoring tools.',
      duration: 8000,
      action: 'navigate:projects',
      visual: {
        highlight: 'project-timeline',
        animation: 'fade-in-up'
      },
      captions: [
        { start: 0, end: 3000, text: 'View active projects' },
        { start: 3000, end: 5500, text: 'Monitor progress and timelines' },
        { start: 5500, end: 8000, text: 'Manage resource allocation' }
      ]
    },
    {
      id: 'calendar',
      title: 'Schedule Management',
      description: 'Organize appointments and manage your time',
      narration: 'The integrated calendar system helps you schedule appointments, set reminders, and coordinate with your team for optimal time management.',
      duration: 6000,
      action: 'navigate:calendar',
      visual: {
        highlight: 'calendar-view',
        animation: 'scale-in'
      },
      captions: [
        { start: 0, end: 2000, text: 'Access your calendar' },
        { start: 2000, end: 4000, text: 'Schedule appointments easily' },
        { start: 4000, end: 6000, text: 'Set reminders and notifications' }
      ]
    },
    {
      id: 'conclusion',
      title: 'Get Started Today',
      description: 'Begin your journey with PITCH CRM',
      narration: 'You are now ready to leverage the full power of PITCH CRM. Start by exploring each section and customizing the system to match your business needs.',
      duration: 5000,
      action: 'overview',
      visual: {
        animation: 'celebration'
      },
      captions: [
        { start: 0, end: 2500, text: 'You are ready to get started!' },
        { start: 2500, end: 5000, text: 'Explore and customize for your business' }
      ]
    }
  ];

  // Handle step progression
  useEffect(() => {
    if (!isPlaying) return;

    intervalRef.current = setInterval(() => {
      setCurrentTime(prev => {
        const newTime = prev + 100;
        const step = walkthroughSteps[currentStep];
        
        if (newTime >= step.duration) {
          if (currentStep < walkthroughSteps.length - 1) {
            setCurrentStep(prev => prev + 1);
            return 0;
          } else {
            onPlayingChange(false);
            return step.duration;
          }
        }
        
        return newTime;
      });
    }, 100 / playbackSpeed);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isPlaying, currentStep, playbackSpeed, onPlayingChange]);

  // Handle captions
  useEffect(() => {
    const step = walkthroughSteps[currentStep];
    const activeCaption = step.captions.find(
      caption => currentTime >= caption.start && currentTime <= caption.end
    );
    setCurrentCaption(activeCaption?.text || '');
  }, [currentTime, currentStep]);

  // Handle navigation actions
  useEffect(() => {
    const step = walkthroughSteps[currentStep];
    if (step.action.startsWith('navigate:')) {
      const section = step.action.split(':')[1];
      onSectionChange(section);
    }
  }, [currentStep, onSectionChange]);

  // Play audio narration
  const playAudio = async (text: string) => {
    if (!audioEnabled) return;
    
    setIsBuffering(true);
    try {
      // Try ElevenLabs first, fallback to OpenAI
      const { data, error } = await supabase.functions.invoke('text-to-speech', {
        body: { 
          text, 
          voice: 'alloy',
          provider: 'elevenlabs' // Try ElevenLabs first
        }
      });

      if (error) {
        console.warn('ElevenLabs failed, trying OpenAI:', error);
        // Fallback to OpenAI
        const { data: fallbackData, error: fallbackError } = await supabase.functions.invoke('text-to-speech', {
          body: { text, voice: 'alloy' }
        });
        
        if (fallbackError) throw fallbackError;
        if (fallbackData?.audioContent) {
          playAudioData(fallbackData.audioContent);
        }
      } else if (data?.audioContent) {
        playAudioData(data.audioContent);
      }
    } catch (error) {
      console.error('Audio playback failed:', error);
      toast({
        title: "Audio not available",
        description: "Playing with captions only",
        variant: "default"
      });
    } finally {
      setIsBuffering(false);
    }
  };

  const playAudioData = (base64Audio: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    
    const audio = new Audio(`data:audio/mp3;base64,${base64Audio}`);
    audio.playbackRate = playbackSpeed;
    audioRef.current = audio;
    audio.play().catch(console.error);
  };

  // Control handlers
  const handlePlay = () => {
    onPlayingChange(true);
    const step = walkthroughSteps[currentStep];
    if (audioEnabled) {
      playAudio(step.narration);
    }
  };

  const handlePause = () => {
    onPlayingChange(false);
    if (audioRef.current) {
      audioRef.current.pause();
    }
  };

  const handleStop = () => {
    onPlayingChange(false);
    setCurrentStep(0);
    setCurrentTime(0);
    if (audioRef.current) {
      audioRef.current.pause();
    }
  };

  const handleNext = () => {
    if (currentStep < walkthroughSteps.length - 1) {
      setCurrentStep(prev => prev + 1);
      setCurrentTime(0);
      if (isPlaying && audioEnabled) {
        playAudio(walkthroughSteps[currentStep + 1].narration);
      }
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
      setCurrentTime(0);
      if (isPlaying && audioEnabled) {
        playAudio(walkthroughSteps[currentStep - 1].narration);
      }
    }
  };

  const currentStepData = walkthroughSteps[currentStep];
  const progress = (currentTime / currentStepData.duration) * 100;
  const totalProgress = ((currentStep * 100) + progress) / walkthroughSteps.length;

  return (
    <div className={cn(
      "relative bg-background border rounded-lg overflow-hidden transition-all duration-300",
      isFullscreen ? "fixed inset-4 z-50" : "w-full max-w-4xl mx-auto"
    )}>
      {/* Video Area */}
      <div className="relative aspect-video bg-gradient-to-br from-primary/10 to-secondary/10 flex items-center justify-center">
        {/* Visual Elements */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className={cn(
            "text-center transition-all duration-1000",
            currentStepData.visual.animation === 'fade-in' && 'animate-fade-in',
            currentStepData.visual.animation === 'slide-right' && 'animate-slide-in-from-left',
            currentStepData.visual.animation === 'zoom-in' && 'animate-zoom-in',
            currentStepData.visual.animation === 'slide-up' && 'animate-slide-in-from-bottom',
            currentStepData.visual.animation === 'celebration' && 'animate-bounce'
          )}>
            <h2 className="text-3xl font-bold mb-4">{currentStepData.title}</h2>
            <p className="text-lg text-muted-foreground max-w-2xl">
              {currentStepData.description}
            </p>
          </div>
        </div>

        {/* Buffering indicator */}
        {isBuffering && (
          <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        )}

        {/* Fullscreen toggle */}
        <Button
          variant="ghost"
          size="sm"
          className="absolute top-2 right-2 bg-black/20 hover:bg-black/40"
          onClick={() => setIsFullscreen(!isFullscreen)}
        >
          {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
        </Button>
      </div>

      {/* Progress Bar */}
      <div className="w-full h-1 bg-muted">
        <div 
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Controls */}
      <div className="p-4 space-y-4">
        {/* Main Controls */}
        <div className="flex items-center justify-center gap-2">
          <Button variant="ghost" size="sm" onClick={handlePrevious} disabled={currentStep === 0}>
            <SkipBack className="h-4 w-4" />
          </Button>
          
          {!isPlaying ? (
            <Button onClick={handlePlay} className="gap-2">
              <Play className="h-4 w-4" />
              Play Walkthrough
            </Button>
          ) : (
            <Button onClick={handlePause} variant="secondary" className="gap-2">
              <Pause className="h-4 w-4" />
              Pause
            </Button>
          )}
          
          <Button variant="ghost" size="sm" onClick={handleStop}>
            <Square className="h-4 w-4" />
          </Button>
          
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleNext} 
            disabled={currentStep === walkthroughSteps.length - 1}
          >
            <SkipForward className="h-4 w-4" />
          </Button>
        </div>

        {/* Progress Info */}
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Step {currentStep + 1} of {walkthroughSteps.length}</span>
          <span>{Math.round(totalProgress)}% Complete</span>
        </div>

        {/* Settings */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAudioEnabled(!audioEnabled)}
            >
              {audioEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </Button>
            
            <select
              value={playbackSpeed}
              onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
              className="text-sm bg-background border rounded px-2 py-1"
            >
              <option value={0.5}>0.5x</option>
              <option value={1}>1x</option>
              <option value={1.25}>1.25x</option>
              <option value={1.5}>1.5x</option>
              <option value={2}>2x</option>
            </select>
          </div>

          <Badge variant="outline">
            {audioEnabled ? 'Audio + Captions' : 'Captions Only'}
          </Badge>
        </div>
      </div>

      {/* Captions */}
      {currentCaption && (
        <div className="absolute bottom-16 left-4 right-4 bg-black/80 text-white p-3 rounded-lg text-center">
          <p className="text-sm md:text-base">{currentCaption}</p>
        </div>
      )}
    </div>
  );
};