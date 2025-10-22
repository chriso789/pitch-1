import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Play, 
  Pause, 
  Square, 
  SkipForward, 
  SkipBack,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Download,
  Camera
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { screenshotCapture } from '@/services/screenshotCapture';

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
  const [isRecording, setIsRecording] = useState(false);
  const [screenshots, setScreenshots] = useState<Record<string, string>>({});

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const { toast } = useToast();

  const walkthroughSteps: WalkthroughStep[] = [
    {
      id: 'intro',
      title: 'Welcome to PITCH CRM',
      description: 'Your all-in-one roofing business platform',
      narration: 'Welcome to PITCH CRM - Your all-in-one roofing business platform designed to streamline operations from lead generation to project completion.',
      duration: 5000,
      action: 'overview',
      visual: {
        highlight: 'main',
        animation: 'fade-in'
      },
      captions: [
        { start: 0, end: 2500, text: 'Welcome to PITCH CRM' },
        { start: 2500, end: 5000, text: 'Your all-in-one roofing business platform' }
      ]
    },
    {
      id: 'dashboard',
      title: 'Dashboard & Metrics',
      description: 'Real-time KPIs, revenue tracking, and active jobs overview',
      narration: 'The dashboard provides real-time visibility into your business with key metrics including revenue tracking, active jobs, pipeline value, and team performance indicators.',
      duration: 8000,
      action: 'navigate:dashboard',
      visual: {
        highlight: 'dashboard-metrics',
        animation: 'fade-in'
      },
      captions: [
        { start: 0, end: 3000, text: 'Monitor revenue, jobs, and pipeline value' },
        { start: 3000, end: 6000, text: 'Track team performance in real-time' },
        { start: 6000, end: 8000, text: 'View recent activities and alerts' }
      ]
    },
    {
      id: 'pipeline',
      title: 'Lead Management & Pipeline',
      description: 'Drag-and-drop pipeline with AI lead scoring',
      narration: 'Manage your sales pipeline with drag-and-drop functionality. The AI-powered lead scoring helps prioritize opportunities, while automated stage progression keeps deals moving forward.',
      duration: 10000,
      action: 'navigate:pipeline',
      visual: {
        highlight: 'pipeline-stages',
        animation: 'slide-right'
      },
      captions: [
        { start: 0, end: 3000, text: 'Drag leads between pipeline stages' },
        { start: 3000, end: 6000, text: 'AI scoring prioritizes hot opportunities' },
        { start: 6000, end: 10000, text: 'Automated workflows move deals forward' }
      ]
    },
    {
      id: 'storm-canvass',
      title: 'Storm Canvass Pro',
      description: 'Map-based canvassing with GPS tracking and photo capture',
      narration: 'Storm Canvass Pro revolutionizes door-to-door operations with GPS tracking, map-based territory management, photo documentation, and real-time activity logging for your canvassing team.',
      duration: 12000,
      action: 'navigate:storm-canvass',
      visual: {
        highlight: 'storm-map',
        animation: 'zoom-in'
      },
      captions: [
        { start: 0, end: 3000, text: 'Map-based territory management' },
        { start: 3000, end: 7000, text: 'Track door-knocking activity with GPS' },
        { start: 7000, end: 12000, text: 'Capture damage photos on the spot' }
      ]
    },
    {
      id: 'dialer',
      title: 'Dialer & Telephony',
      description: 'Browser-based softphone with live transcription',
      narration: 'Make and receive calls directly from your browser with the integrated Telnyx softphone. Features include live call transcription, automatic call logging, and agent assist powered by A.I.',
      duration: 10000,
      action: 'navigate:dialer',
      visual: {
        highlight: 'softphone',
        animation: 'slide-up'
      },
      captions: [
        { start: 0, end: 3000, text: 'Browser-based WebRTC calling' },
        { start: 3000, end: 6000, text: 'Live call transcription and recording' },
        { start: 6000, end: 10000, text: 'AI-powered agent assistance' }
      ]
    },
    {
      id: 'estimates',
      title: 'Estimate Builder',
      description: 'Dynamic pricing engine with material catalog integration',
      narration: 'Create professional estimates with our dynamic pricing engine. Access comprehensive material catalogs, calculate labor costs automatically, generate PDF proposals, and email directly to customers.',
      duration: 12000,
      action: 'navigate:estimates',
      visual: {
        highlight: 'estimate-builder',
        animation: 'fade-in-up'
      },
      captions: [
        { start: 0, end: 3000, text: 'Dynamic pricing with material catalogs' },
        { start: 3000, end: 7000, text: 'Automatic labor and markup calculations' },
        { start: 7000, end: 12000, text: 'Generate PDFs and email to customers' }
      ]
    },
    {
      id: 'production',
      title: 'Job Production Workflow',
      description: 'Production stages, material ordering, and documentation',
      narration: 'Manage the entire production workflow from material ordering to final inspection. Track progress through production stages, manage documents, and maintain photo documentation throughout the project lifecycle.',
      duration: 10000,
      action: 'navigate:production',
      visual: {
        highlight: 'production-stages',
        animation: 'slide-right'
      },
      captions: [
        { start: 0, end: 3000, text: 'Track projects through production stages' },
        { start: 3000, end: 6000, text: 'Order materials and manage inventory' },
        { start: 6000, end: 10000, text: 'Document progress with photos' }
      ]
    },
    {
      id: 'smartdocs',
      title: 'Smart Documents & DocuSign',
      description: 'Template management and e-signature workflows',
      narration: 'Streamline contract execution with Smart Documents. Manage reusable templates, integrate DocuSign for electronic signatures, track document status, and maintain a complete audit trail.',
      duration: 8000,
      action: 'navigate:smartdocs',
      visual: {
        highlight: 'document-templates',
        animation: 'zoom-in'
      },
      captions: [
        { start: 0, end: 3000, text: 'Template library for quick contracts' },
        { start: 3000, end: 5000, text: 'DocuSign integration for e-signatures' },
        { start: 5000, end: 8000, text: 'Track signing status in real-time' }
      ]
    },
    {
      id: 'calendar',
      title: 'Calendar & Scheduling',
      description: 'Google Calendar integration with appointment booking',
      narration: 'Seamlessly integrate with Google Calendar for appointment management. Schedule site visits, coordinate with customers, set reminders, and keep your entire team synchronized.',
      duration: 6000,
      action: 'navigate:calendar',
      visual: {
        highlight: 'calendar-view',
        animation: 'scale-in'
      },
      captions: [
        { start: 0, end: 2000, text: 'Google Calendar integration' },
        { start: 2000, end: 4000, text: 'Schedule appointments and site visits' },
        { start: 4000, end: 6000, text: 'Team coordination and reminders' }
      ]
    },
    {
      id: 'campaigns',
      title: 'Automation & Campaigns',
      description: 'SMS/Email automation with trigger-based workflows',
      narration: 'Create powerful marketing campaigns with automated SMS and email sequences. Set up trigger-based workflows, nurture leads automatically, and maintain consistent communication with your customer base.',
      duration: 7000,
      action: 'navigate:campaigns',
      visual: {
        highlight: 'campaign-builder',
        animation: 'fade-in'
      },
      captions: [
        { start: 0, end: 2500, text: 'Build automated email and SMS campaigns' },
        { start: 2500, end: 5000, text: 'Trigger workflows based on actions' },
        { start: 5000, end: 7000, text: 'Nurture leads automatically' }
      ]
    },
    {
      id: 'analytics',
      title: 'Analytics & Reporting',
      description: 'Job analytics, revenue metrics, and export capabilities',
      narration: 'Gain deep insights into your business performance with comprehensive analytics. Track job profitability, monitor revenue trends, analyze team performance, and export detailed reports for strategic planning.',
      duration: 6000,
      action: 'navigate:job-analytics',
      visual: {
        highlight: 'analytics-dashboard',
        animation: 'slide-up'
      },
      captions: [
        { start: 0, end: 2000, text: 'Comprehensive business analytics' },
        { start: 2000, end: 4000, text: 'Revenue trends and profitability' },
        { start: 4000, end: 6000, text: 'Export reports for planning' }
      ]
    },
    {
      id: 'conclusion',
      title: 'Start Building Your Success',
      description: 'Begin your journey with PITCH CRM today',
      narration: 'You are now ready to leverage the full power of PITCH CRM. From lead generation to project completion, every tool you need is at your fingertips. Start building your success today.',
      duration: 5000,
      action: 'overview',
      visual: {
        animation: 'celebration'
      },
      captions: [
        { start: 0, end: 2500, text: 'Everything you need in one platform' },
        { start: 2500, end: 5000, text: 'Start building your success today' }
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
  }, [isPlaying, currentStep, playbackSpeed, onPlayingChange, walkthroughSteps]);

  // Handle captions
  useEffect(() => {
    const step = walkthroughSteps[currentStep];
    const activeCaption = step.captions.find(
      caption => currentTime >= caption.start && currentTime <= caption.end
    );
    setCurrentCaption(activeCaption?.text || '');
  }, [currentTime, currentStep, walkthroughSteps]);

  // Handle navigation actions
  useEffect(() => {
    const step = walkthroughSteps[currentStep];
    if (step.action.startsWith('navigate:')) {
      const section = step.action.split(':')[1];
      onSectionChange(section);
    }
  }, [currentStep, onSectionChange, walkthroughSteps]);

  // Play audio narration
  const playAudio = async (text: string) => {
    if (!audioEnabled) return;
    
    setIsBuffering(true);
    try {
      const { data, error } = await supabase.functions.invoke('text-to-speech', {
        body: { 
          text, 
          voice: 'alloy',
          provider: 'elevenlabs'
        }
      });

      if (error) {
        console.warn('ElevenLabs failed, trying OpenAI:', error);
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

  const captureCurrentScreen = async () => {
    try {
      const screenshot = await screenshotCapture.captureScreen();
      const stepId = currentStepData.id;
      setScreenshots(prev => ({ ...prev, [stepId]: screenshot }));
      toast({
        title: "Screenshot captured",
        description: "Screen capture saved for this step",
      });
    } catch (error) {
      console.error('Screenshot capture failed:', error);
      toast({
        title: "Capture failed",
        description: "Unable to capture screenshot",
        variant: "destructive",
      });
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { mediaSource: 'screen' } as any,
        audio: true
      });

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'video/webm;codecs=vp9'
      });

      mediaRecorderRef.current = mediaRecorder;
      recordedChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pitch-crm-walkthrough-${Date.now()}.webm`;
        a.click();
        URL.revokeObjectURL(url);

        stream.getTracks().forEach(track => track.stop());
        
        toast({
          title: "Recording saved",
          description: "Video walkthrough has been downloaded",
        });
      };

      mediaRecorder.start();
      setIsRecording(true);
      handlePlay();

      toast({
        title: "Recording started",
        description: "Walkthrough recording in progress",
      });
    } catch (error) {
      console.error('Recording failed:', error);
      toast({
        title: "Recording failed",
        description: "Unable to start screen recording",
        variant: "destructive",
      });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      handleStop();
    }
  };

  // Auto-capture screenshots as walkthrough progresses
  useEffect(() => {
    if (isPlaying && !screenshots[currentStepData.id]) {
      const captureTimeout = setTimeout(() => {
        captureCurrentScreen();
      }, 1000);
      return () => clearTimeout(captureTimeout);
    }
  }, [currentStep, isPlaying]);

  // Save progress to localStorage
  useEffect(() => {
    if (currentStep > 0 || currentTime > 0) {
      localStorage.setItem('walkthrough_progress', JSON.stringify({
        currentStep,
        currentTime,
        completedSteps: currentStep,
        lastViewed: new Date().toISOString()
      }));
    }
  }, [currentStep, currentTime]);

  // Load progress on mount
  useEffect(() => {
    const savedProgress = localStorage.getItem('walkthrough_progress');
    if (savedProgress) {
      try {
        const { currentStep: savedStep } = JSON.parse(savedProgress);
        if (savedStep > 0 && savedStep < walkthroughSteps.length) {
          // Optionally restore progress
          // setCurrentStep(savedStep);
        }
      } catch (e) {
        console.error('Failed to load walkthrough progress:', e);
      }
    }
  }, []);

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
        <div className="absolute inset-0 flex items-center justify-center p-8">
          <div className={cn(
            "text-center transition-all duration-1000",
            currentStepData.visual.animation === 'fade-in' && 'animate-fade-in',
            currentStepData.visual.animation === 'slide-right' && 'animate-slide-in-from-left',
            currentStepData.visual.animation === 'zoom-in' && 'animate-zoom-in',
            currentStepData.visual.animation === 'slide-up' && 'animate-slide-in-from-bottom',
            currentStepData.visual.animation === 'fade-in-up' && 'animate-fade-in',
            currentStepData.visual.animation === 'scale-in' && 'animate-scale-in',
            currentStepData.visual.animation === 'celebration' && 'animate-bounce'
          )}>
            <h2 className="text-4xl font-bold mb-4">{currentStepData.title}</h2>
            <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
              {currentStepData.description}
            </p>
          </div>
        </div>

        {/* Buffering indicator */}
        {isBuffering && (
          <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
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
      <div className="p-6 space-y-4">
        {/* Main Controls */}
        <div className="flex items-center justify-center gap-2">
          <Button variant="ghost" size="sm" onClick={handlePrevious} disabled={currentStep === 0}>
            <SkipBack className="h-4 w-4" />
          </Button>
          
          {!isPlaying ? (
            <Button onClick={handlePlay} size="lg" className="gap-2">
              <Play className="h-5 w-5" />
              {currentStep === 0 ? 'Start Walkthrough' : 'Resume'}
            </Button>
          ) : (
            <Button onClick={handlePause} variant="secondary" size="lg" className="gap-2">
              <Pause className="h-5 w-5" />
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

            <Button
              variant="ghost"
              size="sm"
              onClick={captureCurrentScreen}
              title="Capture screenshot"
            >
              <Camera className="h-4 w-4" />
            </Button>

            {!isRecording ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={startRecording}
                title="Record walkthrough"
              >
                <Download className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                variant="destructive"
                size="sm"
                onClick={stopRecording}
                title="Stop recording"
              >
                <Square className="h-4 w-4" />
              </Button>
            )}
          </div>

          <Badge variant="outline">
            {isRecording ? 'Recording...' : audioEnabled ? 'Audio + Captions' : 'Captions Only'}
          </Badge>
        </div>
      </div>

      {/* Captions */}
      {currentCaption && (
        <div className="absolute bottom-20 left-4 right-4 bg-black/80 text-white p-4 rounded-lg text-center">
          <p className="text-base md:text-lg font-medium">{currentCaption}</p>
        </div>
      )}
    </div>
  );
};