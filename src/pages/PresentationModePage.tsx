import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { SlideRenderer } from "@/components/presentations/SlideRenderer";
import { PresentationControls } from "@/components/presentations/PresentationControls";

const PresentationModePage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [slideStartTime, setSlideStartTime] = useState<number>(Date.now());

  const { data: slides, isLoading } = useQuery({
    queryKey: ["presentation-slides", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("presentation_slides")
        .select("*")
        .eq("presentation_id", id)
        .order("slide_order", { ascending: true });
      
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Start session on mount
  useEffect(() => {
    const startSession = async () => {
      try {
        const { data, error } = await supabase
          .rpc("start_presentation_session", {
            p_presentation_id: id,
          });

        if (error) throw error;
        setSessionId(data);
      } catch (error: any) {
        console.error("Error starting session:", error);
        toast({
          title: "Failed to start presentation",
          description: error.message,
          variant: "destructive",
        });
      }
    };

    if (id) {
      startSession();
    }
  }, [id]);

  // Track slide views
  const trackSlideView = useCallback(async (slideId: string, timeSpent: number) => {
    if (!sessionId) return;

    try {
      await supabase.rpc("track_slide_view", {
        p_session_id: sessionId,
        p_slide_id: slideId,
        p_time_spent: Math.floor(timeSpent / 1000), // Convert to seconds
      });
    } catch (error) {
      console.error("Error tracking slide view:", error);
    }
  }, [sessionId]);

  // Track when slide changes
  useEffect(() => {
    if (!slides || slides.length === 0) return;

    const currentSlide = slides[currentSlideIndex];
    const now = Date.now();
    const timeSpent = now - slideStartTime;

    if (slideStartTime > 0 && currentSlideIndex > 0) {
      const previousSlide = slides[currentSlideIndex - 1];
      trackSlideView(previousSlide.id, timeSpent);
    }

    setSlideStartTime(now);
  }, [currentSlideIndex, slides, trackSlideView]);

  const handleNext = () => {
    if (slides && currentSlideIndex < slides.length - 1) {
      setCurrentSlideIndex(currentSlideIndex + 1);
    }
  };

  const handlePrevious = () => {
    if (currentSlideIndex > 0) {
      setCurrentSlideIndex(currentSlideIndex - 1);
    }
  };

  const handleExit = async () => {
    if (sessionId && slides && slides.length > 0) {
      const currentSlide = slides[currentSlideIndex];
      const timeSpent = Date.now() - slideStartTime;
      await trackSlideView(currentSlide.id, timeSpent);

      try {
        await supabase.rpc("complete_presentation_session", {
          p_session_id: sessionId,
        });
      } catch (error) {
        console.error("Error completing session:", error);
      }
    }

    navigate("/presentations");
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowRight":
        case " ":
          e.preventDefault();
          handleNext();
          break;
        case "ArrowLeft":
          e.preventDefault();
          handlePrevious();
          break;
        case "Escape":
          e.preventDefault();
          handleExit();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentSlideIndex, slides]);

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading presentation...</p>
      </div>
    );
  }

  if (!slides || slides.length === 0) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">No slides found</p>
      </div>
    );
  }

  const currentSlide = slides[currentSlideIndex];

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Main slide area */}
      <div className="flex-1 flex items-center justify-center p-8">
        <SlideRenderer
          slide={currentSlide}
          sessionId={sessionId}
        />
      </div>

      {/* Controls */}
      <PresentationControls
        currentSlide={currentSlideIndex + 1}
        totalSlides={slides.length}
        onPrevious={handlePrevious}
        onNext={handleNext}
        onExit={handleExit}
        canGoPrevious={currentSlideIndex > 0}
        canGoNext={currentSlideIndex < slides.length - 1}
      />
    </div>
  );
};

export default PresentationModePage;
