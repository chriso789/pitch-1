import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  X,
  Maximize,
  Minimize,
  Layers,
  Play,
  Pause,
  RotateCcw,
  StickyNote,
  Settings,
} from "lucide-react";
import type { PresentationSection } from "./SectionNavigator";

interface PresenterToolbarProps {
  currentSlide: number;
  totalSlides: number;
  sections: PresentationSection[];
  currentSectionSlug?: string;
  onPrevious: () => void;
  onNext: () => void;
  onExit: () => void;
  onNavigateToSection: (sectionSlug: string, slideIndex: number) => void;
  onNavigateToSlide: (slideIndex: number) => void;
  onToggleFullscreen?: () => void;
  isFullscreen?: boolean;
  showNotes?: boolean;
  onToggleNotes?: () => void;
}

export function PresenterToolbar({
  currentSlide,
  totalSlides,
  sections,
  currentSectionSlug,
  onPrevious,
  onNext,
  onExit,
  onNavigateToSection,
  onNavigateToSlide,
  onToggleFullscreen,
  isFullscreen = false,
  showNotes = false,
  onToggleNotes,
}: PresenterToolbarProps) {
  const [isMinimized, setIsMinimized] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(true);

  // Timer
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isTimerRunning) {
      interval = setInterval(() => {
        setElapsedTime((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isTimerRunning]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const currentSection = sections.find((s) => s.slug === currentSectionSlug);

  if (isMinimized) {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <Button
          variant="secondary"
          size="sm"
          className="rounded-full shadow-lg"
          onClick={() => setIsMinimized(false)}
        >
          <Settings className="h-4 w-4 mr-2" />
          Controls
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-sm border-t border-border shadow-lg">
      <div className="flex items-center justify-between px-4 py-2 max-w-7xl mx-auto">
        {/* Left: Navigation */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={onPrevious}
            disabled={currentSlide === 0}
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>

          <div className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-lg min-w-[100px] justify-center">
            <span className="font-mono text-sm font-medium">
              {currentSlide + 1} / {totalSlides}
            </span>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={onNext}
            disabled={currentSlide === totalSlides - 1}
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>

        {/* Center: Section Jump + Timer */}
        <div className="flex items-center gap-4">
          {/* Section Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Layers className="h-4 w-4" />
                <span className="max-w-[150px] truncate">
                  {currentSection?.name || "All Slides"}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="w-56">
              <DropdownMenuLabel>Jump to Section</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {sections
                .filter((s) => s.is_visible)
                .sort((a, b) => a.section_order - b.section_order)
                .map((section, index) => (
                  <DropdownMenuItem
                    key={section.id}
                    onClick={() => onNavigateToSection(section.slug, section.firstSlideIndex)}
                    className={cn(
                      currentSectionSlug === section.slug && "bg-accent"
                    )}
                  >
                    <span className="w-5 text-muted-foreground">{index + 1}.</span>
                    <span className="truncate">{section.name}</span>
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Timer */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setIsTimerRunning(!isTimerRunning)}
            >
              {isTimerRunning ? (
                <Pause className="h-3.5 w-3.5" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
            </Button>
            <span className="font-mono text-sm min-w-[50px]">
              {formatTime(elapsedTime)}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setElapsedTime(0)}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          {onToggleNotes && (
            <Button
              variant={showNotes ? "secondary" : "ghost"}
              size="icon"
              onClick={onToggleNotes}
              title="Toggle Notes"
            >
              <StickyNote className="h-4 w-4" />
            </Button>
          )}

          {onToggleFullscreen && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleFullscreen}
              title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
            >
              {isFullscreen ? (
                <Minimize className="h-4 w-4" />
              ) : (
                <Maximize className="h-4 w-4" />
              )}
            </Button>
          )}

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsMinimized(true)}
            title="Minimize Controls"
          >
            <Minimize className="h-4 w-4" />
          </Button>

          <Button
            variant="destructive"
            size="sm"
            onClick={onExit}
            className="gap-1"
          >
            <X className="h-4 w-4" />
            Exit
          </Button>
        </div>
      </div>
    </div>
  );
}
