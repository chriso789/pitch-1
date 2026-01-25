// =====================================================
// Phase 76: Animated Measurement Walkthrough
// Step-by-step animation showing calculation process
// =====================================================

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  Download,
  Volume2,
  VolumeX,
} from 'lucide-react';

interface WalkthroughStep {
  id: string;
  title: string;
  description: string;
  duration: number; // milliseconds
  highlightElements?: string[]; // Element IDs to highlight
  formula?: string;
  calculation?: string;
  result?: { value: number; unit: string };
  voiceover?: string;
}

interface MeasurementWalkthroughProps {
  measurementId: string;
  steps?: WalkthroughStep[];
  totalArea?: number;
  onStepChange?: (stepIndex: number) => void;
  onHighlightElements?: (elementIds: string[]) => void;
  onComplete?: () => void;
  className?: string;
}

// Default walkthrough steps for roof measurement
const DEFAULT_STEPS: WalkthroughStep[] = [
  {
    id: 'intro',
    title: 'Starting Measurement Analysis',
    description: 'Analyzing satellite imagery to detect roof structure...',
    duration: 2000,
    voiceover: 'Beginning automated roof measurement analysis.',
  },
  {
    id: 'perimeter',
    title: 'Detecting Roof Perimeter',
    description: 'Identifying the outer edges of the roof structure.',
    duration: 3000,
    highlightElements: ['eave', 'rake'],
    formula: 'Perimeter = Σ(edge lengths)',
    voiceover: 'First, we detect the roof perimeter by tracing the outer edges.',
  },
  {
    id: 'ridges',
    title: 'Locating Ridge Lines',
    description: 'Finding the highest points where roof planes meet.',
    duration: 2500,
    highlightElements: ['ridge'],
    formula: 'Ridge = horizontal peak intersection',
    voiceover: 'Next, we identify the ridge lines at the peak of the roof.',
  },
  {
    id: 'hips',
    title: 'Identifying Hip Lines',
    description: 'Detecting external angles where roof planes join.',
    duration: 2500,
    highlightElements: ['hip'],
    formula: 'Hip = exterior plane intersection',
    voiceover: 'Hip lines are located where roof planes meet at exterior angles.',
  },
  {
    id: 'valleys',
    title: 'Finding Valley Lines',
    description: 'Locating internal angles where roof planes meet.',
    duration: 2500,
    highlightElements: ['valley'],
    formula: 'Valley = interior plane intersection',
    voiceover: 'Valley lines are where roof planes meet at interior angles.',
  },
  {
    id: 'pitch',
    title: 'Calculating Roof Pitch',
    description: 'Determining the slope angle of each roof facet.',
    duration: 3000,
    formula: 'Pitch = rise / run (e.g., 6/12)',
    calculation: 'Shadow analysis + elevation data',
    voiceover: 'We calculate pitch using shadow analysis and elevation data.',
  },
  {
    id: 'facets',
    title: 'Computing Facet Areas',
    description: 'Measuring the area of each individual roof plane.',
    duration: 3000,
    formula: 'Facet Area = base × height × pitch factor',
    voiceover: 'Each roof facet area is calculated including the pitch factor.',
  },
  {
    id: 'total',
    title: 'Summing Total Area',
    description: 'Adding all facet areas for total roof surface.',
    duration: 2000,
    formula: 'Total Area = Σ(facet areas)',
    voiceover: 'Finally, we sum all facet areas for the total roof area.',
  },
  {
    id: 'complete',
    title: 'Measurement Complete',
    description: 'All measurements calculated and verified.',
    duration: 2000,
    voiceover: 'Measurement analysis complete. Results are ready for review.',
  },
];

export function MeasurementWalkthrough({
  measurementId,
  steps = DEFAULT_STEPS,
  totalArea,
  onStepChange,
  onHighlightElements,
  onComplete,
  className,
}: MeasurementWalkthroughProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [progress, setProgress] = useState(0);

  const currentStep = steps[currentStepIndex];
  const totalDuration = useMemo(() => 
    steps.reduce((acc, step) => acc + step.duration, 0),
    [steps]
  );

  // Calculate elapsed time up to current step
  const elapsedToCurrentStep = useMemo(() =>
    steps.slice(0, currentStepIndex).reduce((acc, step) => acc + step.duration, 0),
    [steps, currentStepIndex]
  );

  // Auto-advance when playing
  useEffect(() => {
    if (!isPlaying) return;

    const stepDuration = currentStep.duration / playbackSpeed;
    const startTime = Date.now();
    
    const updateProgress = () => {
      const elapsed = Date.now() - startTime;
      const stepProgress = Math.min(elapsed / stepDuration, 1);
      const totalProgress = (elapsedToCurrentStep + stepDuration * stepProgress) / totalDuration * 100;
      setProgress(totalProgress);
    };

    const progressInterval = setInterval(updateProgress, 50);

    const timeout = setTimeout(() => {
      if (currentStepIndex < steps.length - 1) {
        setCurrentStepIndex((prev) => prev + 1);
        onStepChange?.(currentStepIndex + 1);
      } else {
        setIsPlaying(false);
        onComplete?.();
      }
    }, stepDuration);

    // Highlight elements for this step
    if (currentStep.highlightElements) {
      onHighlightElements?.(currentStep.highlightElements);
    }

    return () => {
      clearTimeout(timeout);
      clearInterval(progressInterval);
    };
  }, [isPlaying, currentStepIndex, playbackSpeed, currentStep, steps, onStepChange, onComplete, onHighlightElements, elapsedToCurrentStep, totalDuration]);

  const handlePlay = useCallback(() => setIsPlaying(true), []);
  const handlePause = useCallback(() => setIsPlaying(false), []);
  
  const handlePrevious = useCallback(() => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex((prev) => prev - 1);
      setIsPlaying(false);
      onStepChange?.(currentStepIndex - 1);
    }
  }, [currentStepIndex, onStepChange]);

  const handleNext = useCallback(() => {
    if (currentStepIndex < steps.length - 1) {
      setCurrentStepIndex((prev) => prev + 1);
      onStepChange?.(currentStepIndex + 1);
    }
  }, [currentStepIndex, steps.length, onStepChange]);

  const handleReset = useCallback(() => {
    setCurrentStepIndex(0);
    setIsPlaying(false);
    setProgress(0);
    onStepChange?.(0);
    onHighlightElements?.([]);
  }, [onStepChange, onHighlightElements]);

  const handleExport = useCallback(async () => {
    // TODO: Implement video export
    console.log('Export walkthrough video');
  }, []);

  const handleMuteToggle = useCallback(() => setIsMuted(prev => !prev), []);

  return (
    <Card className={cn('w-full', className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            Measurement Walkthrough
            <Badge variant="outline">
              Step {currentStepIndex + 1} of {steps.length}
            </Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleMuteToggle}
            >
              {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleExport}
            >
              <Download className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Progress bar */}
        <div className="space-y-2">
          <Progress value={progress} className="h-2" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{Math.floor(elapsedToCurrentStep / 1000)}s</span>
            <span>{Math.floor(totalDuration / 1000)}s</span>
          </div>
        </div>

        {/* Current step display */}
        <div className="bg-muted/50 rounded-lg p-4 min-h-[120px]">
          <h3 className="font-semibold text-lg mb-2">{currentStep.title}</h3>
          <p className="text-muted-foreground mb-3">{currentStep.description}</p>
          
          {currentStep.formula && (
            <div className="bg-background rounded p-2 font-mono text-sm mb-2">
              <span className="text-muted-foreground">Formula: </span>
              <span className="text-primary">{currentStep.formula}</span>
            </div>
          )}
          
          {currentStep.calculation && (
            <div className="text-sm text-muted-foreground">
              Method: {currentStep.calculation}
            </div>
          )}
          
          {currentStep.result && (
            <div className="mt-2 flex items-center gap-2">
              <Badge variant="default" className="text-lg py-1 px-3">
                {currentStep.result.value.toFixed(1)} {currentStep.result.unit}
              </Badge>
            </div>
          )}
        </div>

        {/* Playback controls */}
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10"
            onClick={handleReset}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
          
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10"
            onClick={handlePrevious}
            disabled={currentStepIndex === 0}
          >
            <SkipBack className="h-4 w-4" />
          </Button>
          
          <Button
            variant="default"
            size="icon"
            className="h-12 w-12"
            onClick={isPlaying ? handlePause : handlePlay}
          >
            {isPlaying ? (
              <Pause className="h-5 w-5" />
            ) : (
              <Play className="h-5 w-5 ml-0.5" />
            )}
          </Button>
          
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10"
            onClick={handleNext}
            disabled={currentStepIndex === steps.length - 1}
          >
            <SkipForward className="h-4 w-4" />
          </Button>
        </div>

        {/* Speed control */}
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">Speed:</span>
          <div className="flex-1">
            <Slider
              value={[playbackSpeed]}
              min={0.5}
              max={2}
              step={0.25}
              onValueChange={([value]) => setPlaybackSpeed(value)}
            />
          </div>
          <span className="text-sm font-medium w-12">{playbackSpeed}x</span>
        </div>

        {/* Step indicators */}
        <div className="flex gap-1">
          {steps.map((step, index) => (
            <button
              key={step.id}
              className={cn(
                'flex-1 h-1.5 rounded-full transition-colors',
                index < currentStepIndex && 'bg-primary',
                index === currentStepIndex && 'bg-primary animate-pulse',
                index > currentStepIndex && 'bg-muted'
              )}
              onClick={() => {
                setCurrentStepIndex(index);
                setIsPlaying(false);
                onStepChange?.(index);
              }}
              title={step.title}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// Hook for creating custom walkthrough steps
export function useWalkthroughSteps(measurements: Record<string, number>) {
  return useMemo(() => {
    const steps: WalkthroughStep[] = [
      ...DEFAULT_STEPS.slice(0, -1),
      {
        id: 'results',
        title: 'Final Results',
        description: 'Complete measurement breakdown:',
        duration: 3000,
        result: { value: measurements.total_area || 0, unit: 'sq ft' },
      },
      DEFAULT_STEPS[DEFAULT_STEPS.length - 1],
    ];
    return steps;
  }, [measurements]);
}

export default MeasurementWalkthrough;
