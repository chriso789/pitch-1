import { useEffect, useState } from "react";
import { Sparkles, Check, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface GenerationProgressProps {
  status: string;
  totalSlides: number;
  onComplete?: () => void;
}

export function GenerationProgress({ status, totalSlides, onComplete }: GenerationProgressProps) {
  const [progress, setProgress] = useState(0);
  
  useEffect(() => {
    if (status === 'completed') {
      setProgress(100);
      onComplete?.();
    } else if (status.startsWith('generating_slide_')) {
      const slideNum = parseInt(status.replace('generating_slide_', ''));
      setProgress(Math.round((slideNum / totalSlides) * 100));
    } else if (status === 'generating') {
      setProgress(5);
    }
  }, [status, totalSlides, onComplete]);

  const isComplete = status === 'completed';
  const currentSlide = status.startsWith('generating_slide_') 
    ? parseInt(status.replace('generating_slide_', ''))
    : 0;

  return (
    <div className="space-y-4 p-6 bg-muted/50 rounded-lg">
      <div className="flex items-center gap-3">
        <div className={cn(
          "p-2 rounded-full",
          isComplete ? "bg-green-500/10" : "bg-primary/10"
        )}>
          {isComplete ? (
            <Check className="h-5 w-5 text-green-500" />
          ) : (
            <Sparkles className="h-5 w-5 text-primary animate-pulse" />
          )}
        </div>
        <div className="flex-1">
          <h4 className="font-medium text-sm">
            {isComplete ? "Presentation Ready!" : "Generating Presentation..."}
          </h4>
          <p className="text-xs text-muted-foreground">
            {isComplete 
              ? `Created ${totalSlides} slides` 
              : currentSlide > 0 
                ? `Creating slide ${currentSlide} of ${totalSlides}...`
                : "Preparing your presentation..."
            }
          </p>
        </div>
        {!isComplete && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>
      
      <Progress value={progress} className="h-2" />
      
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Progress</span>
        <span>{progress}%</span>
      </div>
    </div>
  );
}
