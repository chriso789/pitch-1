import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  Play, 
  Pause, 
  SkipForward, 
  SkipBack,
  Volume2,
  VolumeX,
  X,
  ArrowRight,
  Calendar,
  Zap
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { trackingService } from '@/lib/analytics/trackingService';

interface DemoStep {
  id: string;
  title: string;
  headline: string;
  subtext: string;
  duration: number;
  icon: string;
  captions: Array<{
    start: number;
    end: number;
    text: string;
  }>;
}

interface DemoVideoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DemoVideoModal: React.FC<DemoVideoModalProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [currentCaption, setCurrentCaption] = useState('');
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Marketing-focused demo steps (benefit-driven, not technical)
  const demoSteps: DemoStep[] = [
    {
      id: 'intro',
      title: 'Welcome',
      headline: 'The Only CRM Built for Roofers',
      subtext: 'Replace 10+ expensive tools with one platform',
      duration: 5000,
      icon: '🏠',
      captions: [
        { start: 0, end: 2500, text: 'Built for roofers, by roofers' },
        { start: 2500, end: 5000, text: 'Replace 10+ expensive tools' }
      ]
    },
    {
      id: 'dashboard',
      title: 'Dashboard',
      headline: 'Your Business at a Glance',
      subtext: 'Real-time revenue, jobs, and team performance',
      duration: 6000,
      icon: '📊',
      captions: [
        { start: 0, end: 3000, text: 'See your entire business in one view' },
        { start: 3000, end: 6000, text: 'Real-time metrics that matter' }
      ]
    },
    {
      id: 'pipeline',
      title: 'Pipeline',
      headline: 'Never Miss a Hot Lead',
      subtext: 'AI prioritizes your best opportunities',
      duration: 6000,
      icon: '🎯',
      captions: [
        { start: 0, end: 3000, text: 'Drag-and-drop pipeline management' },
        { start: 3000, end: 6000, text: 'AI surfaces your hottest leads' }
      ]
    },
    {
      id: 'canvass',
      title: 'Canvassing',
      headline: 'Canvass Smarter, Close More',
      subtext: 'Map-based territory tracking',
      duration: 6000,
      icon: '🗺️',
      captions: [
        { start: 0, end: 3000, text: 'Track every door, every time' },
        { start: 3000, end: 6000, text: 'Storm territory mapping built-in' }
      ]
    },
    {
      id: 'dialer',
      title: 'Power Dialer',
      headline: 'Call Directly from Your Browser',
      subtext: 'AI transcribes every conversation',
      duration: 6000,
      icon: '📞',
      captions: [
        { start: 0, end: 3000, text: 'One-click calling, no phone needed' },
        { start: 3000, end: 6000, text: 'AI captures every detail' }
      ]
    },
    {
      id: 'estimates',
      title: 'Estimates',
      headline: 'Professional Proposals in Minutes',
      subtext: 'Good-Better-Best pricing that closes',
      duration: 6000,
      icon: '📋',
      captions: [
        { start: 0, end: 3000, text: 'Create estimates in under 5 minutes' },
        { start: 3000, end: 6000, text: 'Price options that convert' }
      ]
    },
    {
      id: 'documents',
      title: 'Documents',
      headline: 'Contracts Signed in Seconds',
      subtext: 'DocuSign integration built-in',
      duration: 5000,
      icon: '📝',
      captions: [
        { start: 0, end: 2500, text: 'E-signatures that work' },
        { start: 2500, end: 5000, text: 'Close deals on the spot' }
      ]
    },
    {
      id: 'conclusion',
      title: 'Get Started',
      headline: 'Start Winning More Jobs Today',
      subtext: '14-day free trial, no credit card required',
      duration: 5000,
      icon: '🚀',
      captions: [
        { start: 0, end: 2500, text: 'Everything you need in one platform' },
        { start: 2500, end: 5000, text: 'Start your free trial today' }
      ]
    }
  ];

  const currentStepData = demoSteps[currentStep];
  const totalDuration = demoSteps.reduce((sum, step) => sum + step.duration, 0);
  const elapsedDuration = demoSteps.slice(0, currentStep).reduce((sum, step) => sum + step.duration, 0) + currentTime;
  const overallProgress = (elapsedDuration / totalDuration) * 100;

  // Track demo events
  useEffect(() => {
    if (isOpen && !hasStarted) {
      trackingService.trackEvent({ 
        eventType: 'DEMO_MODAL_OPENED', 
        metadata: { timestamp: new Date().toISOString() } 
      });
    }
  }, [isOpen, hasStarted]);

  // Handle step progression
  useEffect(() => {
    if (!isPlaying) return;

    intervalRef.current = setInterval(() => {
      setCurrentTime(prev => {
        const newTime = prev + 100;
        const step = demoSteps[currentStep];
        
        if (newTime >= step.duration) {
          if (currentStep < demoSteps.length - 1) {
            setCurrentStep(prev => prev + 1);
            trackingService.trackEvent({ 
              eventType: 'DEMO_STEP_VIEWED', 
              metadata: {
                stepId: demoSteps[currentStep + 1]?.id,
                stepNumber: currentStep + 1 
              }
            });
            return 0;
          } else {
            setIsPlaying(false);
            setIsComplete(true);
            trackingService.trackEvent({ 
              eventType: 'DEMO_COMPLETED', 
              metadata: {
                totalSteps: demoSteps.length,
                timestamp: new Date().toISOString()
              }
            });
            return step.duration;
          }
        }
        
        return newTime;
      });
    }, 100);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isPlaying, currentStep, demoSteps]);

  // Handle captions
  useEffect(() => {
    const step = demoSteps[currentStep];
    const activeCaption = step.captions.find(
      caption => currentTime >= caption.start && currentTime <= caption.end
    );
    setCurrentCaption(activeCaption?.text || '');
  }, [currentTime, currentStep, demoSteps]);

  const handlePlay = useCallback(() => {
    if (!hasStarted) {
      setHasStarted(true);
      trackingService.trackEvent({ 
        eventType: 'DEMO_STARTED', 
        metadata: { timestamp: new Date().toISOString() } 
      });
    }
    setIsPlaying(true);
  }, [hasStarted]);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const handleNext = useCallback(() => {
    if (currentStep < demoSteps.length - 1) {
      setCurrentStep(prev => prev + 1);
      setCurrentTime(0);
    }
  }, [currentStep, demoSteps.length]);

  const handlePrevious = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
      setCurrentTime(0);
    }
  }, [currentStep]);

  const handleClose = useCallback(() => {
    setIsPlaying(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    // Track if user dropped off early
    if (hasStarted && !isComplete) {
      trackingService.trackEvent({ 
        eventType: 'DEMO_DROPPED', 
        metadata: {
          stepId: currentStepData.id,
          stepNumber: currentStep,
          progress: Math.round(overallProgress)
        }
      });
    }
    onClose();
  }, [hasStarted, isComplete, currentStepData.id, currentStep, overallProgress, onClose]);

  const handleStartTrial = useCallback(() => {
    trackingService.trackEvent({ 
      eventType: 'DEMO_CTA_CLICKED', 
      metadata: { action: 'start_trial' } 
    });
    handleClose();
    navigate('/signup');
  }, [handleClose, navigate]);

  const handleBookCall = useCallback(() => {
    trackingService.trackEvent({ 
      eventType: 'DEMO_CTA_CLICKED', 
      metadata: { action: 'book_call' } 
    });
    handleClose();
    // Could navigate to a booking page or open a calendar widget
    navigate('/signup');
  }, [handleClose, navigate]);

  const resetDemo = useCallback(() => {
    setCurrentStep(0);
    setCurrentTime(0);
    setIsComplete(false);
    setHasStarted(false);
  }, []);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-4xl w-[95vw] h-[85vh] p-0 overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        {/* Header */}
        <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between p-4 bg-gradient-to-b from-black/50 to-transparent">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <span className="text-white font-semibold">PITCH CRM Demo</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/20"
              onClick={() => setAudioEnabled(!audioEnabled)}
            >
              {audioEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/20"
              onClick={handleClose}
            >
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex flex-col h-full pt-16 pb-24">
          {/* Demo Content Area */}
          <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
            {!isComplete ? (
              <>
                {/* Step Icon */}
                <div className="text-6xl mb-6 animate-bounce-slow">
                  {currentStepData.icon}
                </div>

                {/* Step Badge */}
                <Badge variant="secondary" className="mb-4 bg-white/10 text-white border-white/20">
                  {currentStepData.title}
                </Badge>

                {/* Main Headline */}
                <h2 className="text-4xl md:text-5xl font-bold text-white mb-4 leading-tight">
                  {currentStepData.headline}
                </h2>

                {/* Subtext */}
                <p className="text-xl text-slate-300 mb-8 max-w-2xl">
                  {currentStepData.subtext}
                </p>

                {/* Caption Display */}
                <div className="min-h-[60px] flex items-center justify-center">
                  <p className={cn(
                    "text-2xl font-medium text-blue-400 transition-opacity duration-300",
                    currentCaption ? "opacity-100" : "opacity-0"
                  )}>
                    {currentCaption}
                  </p>
                </div>

                {/* Play Button (when not started) */}
                {!hasStarted && (
                  <Button 
                    size="lg" 
                    onClick={handlePlay}
                    className="mt-8 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-lg px-8 py-6"
                  >
                    <Play className="w-6 h-6 mr-2" />
                    Start Demo
                  </Button>
                )}
              </>
            ) : (
              /* Completion Screen */
              <div className="flex flex-col items-center">
                <div className="text-7xl mb-6">🎉</div>
                <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
                  Ready to Win More Jobs?
                </h2>
                <p className="text-xl text-slate-300 mb-8 max-w-2xl">
                  Join 500+ construction companies already using PITCH CRM to close more deals
                </p>
                <div className="flex flex-col sm:flex-row gap-4">
                  <Button 
                    size="lg" 
                    onClick={handleStartTrial}
                    className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-lg px-8 py-6"
                  >
                    Start Free Trial <ArrowRight className="ml-2 w-5 h-5" />
                  </Button>
                  <Button 
                    size="lg" 
                    variant="outline" 
                    onClick={handleBookCall}
                    className="border-white/30 text-white hover:bg-white/10 text-lg px-8 py-6"
                  >
                    <Calendar className="w-5 h-5 mr-2" />
                    Book a Call
                  </Button>
                </div>
                <Button 
                  variant="ghost" 
                  onClick={resetDemo}
                  className="mt-6 text-slate-400 hover:text-white"
                >
                  Watch Again
                </Button>
              </div>
            )}
          </div>

          {/* Step Indicators */}
          {!isComplete && (
            <div className="flex justify-center gap-2 mb-4">
              {demoSteps.map((step, index) => (
                <button
                  key={step.id}
                  onClick={() => {
                    setCurrentStep(index);
                    setCurrentTime(0);
                    if (!hasStarted) setHasStarted(true);
                  }}
                  className={cn(
                    "w-2 h-2 rounded-full transition-all duration-300",
                    index === currentStep 
                      ? "w-8 bg-blue-500" 
                      : index < currentStep 
                        ? "bg-blue-500/50" 
                        : "bg-white/20"
                  )}
                  aria-label={`Go to step ${index + 1}: ${step.title}`}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer Controls */}
        {hasStarted && !isComplete && (
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
            {/* Progress Bar */}
            <Progress value={overallProgress} className="h-1 mb-4 bg-white/10" />
            
            {/* Controls */}
            <div className="flex items-center justify-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/20"
                onClick={handlePrevious}
                disabled={currentStep === 0}
              >
                <SkipBack className="w-5 h-5" />
              </Button>
              
              <Button
                variant="ghost"
                size="lg"
                className="text-white hover:bg-white/20 rounded-full w-14 h-14"
                onClick={isPlaying ? handlePause : handlePlay}
              >
                {isPlaying ? (
                  <Pause className="w-6 h-6" />
                ) : (
                  <Play className="w-6 h-6 ml-0.5" />
                )}
              </Button>
              
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/20"
                onClick={handleNext}
                disabled={currentStep === demoSteps.length - 1}
              >
                <SkipForward className="w-5 h-5" />
              </Button>
            </div>

            {/* Skip to CTA */}
            <div className="flex justify-center mt-4">
              <Button 
                variant="link" 
                className="text-slate-400 hover:text-white text-sm"
                onClick={() => {
                  setCurrentStep(demoSteps.length - 1);
                  setCurrentTime(demoSteps[demoSteps.length - 1].duration);
                  setIsPlaying(false);
                  setIsComplete(true);
                }}
              >
                Skip to Get Started →
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default DemoVideoModal;
