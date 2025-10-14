import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

interface PresentationControlsProps {
  currentSlide: number;
  totalSlides: number;
  onPrevious: () => void;
  onNext: () => void;
  onExit: () => void;
  canGoPrevious: boolean;
  canGoNext: boolean;
}

export const PresentationControls = ({
  currentSlide,
  totalSlides,
  onPrevious,
  onNext,
  onExit,
  canGoPrevious,
  canGoNext,
}: PresentationControlsProps) => {
  return (
    <div className="h-20 border-t border-border bg-muted/30 flex items-center justify-between px-8">
      {/* Exit button */}
      <Button variant="ghost" onClick={onExit}>
        <X className="h-4 w-4 mr-2" />
        Exit
      </Button>

      {/* Navigation */}
      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          onClick={onPrevious}
          disabled={!canGoPrevious}
        >
          <ChevronLeft className="h-4 w-4 mr-2" />
          Previous
        </Button>

        <span className="text-lg font-semibold min-w-[80px] text-center">
          {currentSlide} / {totalSlides}
        </span>

        <Button
          variant="outline"
          onClick={onNext}
          disabled={!canGoNext}
        >
          Next
          <ChevronRight className="h-4 w-4 ml-2" />
        </Button>
      </div>

      {/* Keyboard shortcuts hint */}
      <div className="text-sm text-muted-foreground">
        Use arrow keys or spacebar to navigate
      </div>
    </div>
  );
};
