import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { SlideRenderer } from "@/components/presentations/SlideRenderer";
import { SlideTransition } from "@/components/presentations/SlideTransition";
import { PresenterToolbar } from "@/components/presentations/mode/PresenterToolbar";
import { SectionNavigator } from "@/components/presentations/mode/SectionNavigator";
import { usePresentationContext } from "@/hooks/usePresentationContext";
import { filterVisibleSlides, VisibilityConditions } from "@/lib/presentation-visibility";

interface PresentationSection {
  id: string;
  name: string;
  slug: string;
  icon?: string;
  color?: string;
  section_order: number;
  is_visible: boolean;
  firstSlideIndex: number;
}

interface PresentationSlide {
  id: string;
  slide_type: string;
  content: any;
  slide_order: number;
  section_id?: string;
  is_enabled?: boolean;
  visibility_conditions?: VisibilityConditions | null;
  transition_effect?: string;
  notes?: string;
  navigation_links?: any;
}

const PresentationModePage = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const pipelineEntryId = searchParams.get("entry") || undefined;
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [slideStartTime, setSlideStartTime] = useState<number>(Date.now());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [sectionNavCollapsed, setSectionNavCollapsed] = useState(false);

  const { context: presentationContext, visibilityContext, isLoading: contextLoading } = usePresentationContext({
    pipelineEntryId,
  });

  const { data: slidesRaw, isLoading: slidesLoading } = useQuery({
    queryKey: ["presentation-slides", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("presentation_slides")
        .select("*")
        .eq("presentation_id", id)
        .order("slide_order", { ascending: true });
      
      if (error) throw error;
      return data as PresentationSlide[];
    },
    enabled: !!id,
  });

  const { data: sectionsRaw } = useQuery({
    queryKey: ["presentation-sections", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("presentation_sections")
        .select("*")
        .eq("presentation_id", id)
        .order("section_order", { ascending: true });
      
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const slides = useMemo(() => {
    if (!slidesRaw) return [];
    return filterVisibleSlides(slidesRaw, visibilityContext) as PresentationSlide[];
  }, [slidesRaw, visibilityContext]);

  const sections: PresentationSection[] = useMemo(() => {
    if (!sectionsRaw || !slides) return [];
    
    return sectionsRaw
      .filter(s => s.is_visible !== false)
      .map(section => {
        const firstSlideIndex = slides.findIndex(slide => slide.section_id === section.id);
        return {
          id: section.id,
          name: section.name,
          slug: section.slug,
          icon: section.icon,
          color: section.color,
          section_order: section.section_order,
          is_visible: section.is_visible !== false,
          firstSlideIndex: firstSlideIndex >= 0 ? firstSlideIndex : 0,
        };
      })
      .sort((a, b) => a.section_order - b.section_order);
  }, [sectionsRaw, slides]);

  const currentSectionSlug = useMemo(() => {
    if (!slides || slides.length === 0 || !sections.length) return "";
    const currentSlide = slides[currentSlideIndex];
    if (!currentSlide?.section_id) return "";
    const section = sections.find(s => s.id === currentSlide.section_id);
    return section?.slug || "";
  }, [slides, currentSlideIndex, sections]);

  useEffect(() => {
    const startSession = async () => {
      try {
        const { data, error } = await supabase
          .rpc("start_presentation_session", { p_presentation_id: id });
        if (error) throw error;
        setSessionId(data);
      } catch (error: any) {
        console.error("Error starting session:", error);
        toast({ title: "Failed to start presentation", description: error.message, variant: "destructive" });
      }
    };
    if (id) startSession();
  }, [id]);

  const trackSlideView = useCallback(async (slideId: string, timeSpent: number) => {
    if (!sessionId) return;
    try {
      await supabase.rpc("track_slide_view", {
        p_session_id: sessionId,
        p_slide_id: slideId,
        p_time_spent: Math.floor(timeSpent / 1000),
      });
    } catch (error) {
      console.error("Error tracking slide view:", error);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!slides || slides.length === 0) return;
    const now = Date.now();
    const timeSpent = now - slideStartTime;
    if (slideStartTime > 0 && currentSlideIndex > 0) {
      const previousSlide = slides[currentSlideIndex - 1];
      trackSlideView(previousSlide.id, timeSpent);
    }
    setSlideStartTime(now);
  }, [currentSlideIndex, slides, trackSlideView]);

  const handleNext = useCallback(() => {
    if (slides && currentSlideIndex < slides.length - 1) setCurrentSlideIndex(currentSlideIndex + 1);
  }, [slides, currentSlideIndex]);

  const handlePrevious = useCallback(() => {
    if (currentSlideIndex > 0) setCurrentSlideIndex(currentSlideIndex - 1);
  }, [currentSlideIndex]);

  const handleNavigateToSection = useCallback((sectionSlug: string, slideIndex?: number) => {
    if (slideIndex !== undefined) {
      setCurrentSlideIndex(slideIndex);
    } else {
      const section = sections.find(s => s.slug === sectionSlug);
      if (section) setCurrentSlideIndex(section.firstSlideIndex);
    }
  }, [sections]);

  const handleToggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  const handleToggleNotes = useCallback(() => setShowNotes(prev => !prev), []);

  const handleExit = async () => {
    if (sessionId && slides && slides.length > 0) {
      const currentSlide = slides[currentSlideIndex];
      await trackSlideView(currentSlide.id, Date.now() - slideStartTime);
      try {
        await supabase.rpc("complete_presentation_session", { p_session_id: sessionId });
      } catch (error) {
        console.error("Error completing session:", error);
      }
    }
    navigate("/presentations");
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= "1" && e.key <= "9") {
        const sectionIndex = parseInt(e.key) - 1;
        if (sections[sectionIndex]) {
          e.preventDefault();
          handleNavigateToSection(sections[sectionIndex].slug);
        }
        return;
      }
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
        case "f":
        case "F":
          e.preventDefault();
          handleToggleFullscreen();
          break;
        case "n":
        case "N":
          e.preventDefault();
          handleToggleNotes();
          break;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentSlideIndex, slides, sections, handleNext, handlePrevious, handleNavigateToSection, handleToggleFullscreen, handleToggleNotes]);

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  if (slidesLoading || contextLoading) {
    return <div className="h-screen flex items-center justify-center bg-background"><p className="text-muted-foreground">Loading presentation...</p></div>;
  }

  if (!slides || slides.length === 0) {
    return <div className="h-screen flex items-center justify-center bg-background"><p className="text-muted-foreground">No slides found</p></div>;
  }

  const currentSlide = slides[currentSlideIndex];

  return (
    <div className="h-screen flex flex-col bg-background">
      {sections.length > 0 && (
        <SectionNavigator
          sections={sections}
          currentSlideIndex={currentSlideIndex}
          currentSectionSlug={currentSectionSlug}
          onNavigateToSection={(slug, idx) => handleNavigateToSection(slug, idx)}
          onNavigateToSlide={setCurrentSlideIndex}
          isCollapsed={sectionNavCollapsed}
          onToggleCollapsed={() => setSectionNavCollapsed(prev => !prev)}
        />
      )}

      <div className="flex-1 flex items-center justify-center p-8">
        <SlideTransition slideId={currentSlide.id} transitionType={(currentSlide.transition_effect as "fade" | "slide" | "zoom") || "fade"}>
          <SlideRenderer
            slide={currentSlide}
            sessionId={sessionId}
            presentationContext={presentationContext}
            onNavigateToSection={handleNavigateToSection}
          />
        </SlideTransition>
      </div>

      {showNotes && currentSlide.notes && (
        <div className="fixed bottom-24 right-4 w-80 bg-card border border-border rounded-lg shadow-lg p-4 max-h-60 overflow-y-auto">
          <h4 className="font-semibold text-sm mb-2">Presenter Notes</h4>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{currentSlide.notes}</p>
        </div>
      )}

      <PresenterToolbar
        currentSlide={currentSlideIndex + 1}
        totalSlides={slides.length}
        onPrevious={handlePrevious}
        onNext={handleNext}
        onExit={handleExit}
        sections={sections}
        currentSectionSlug={currentSectionSlug}
        onNavigateToSection={(slug, idx) => handleNavigateToSection(slug, idx)}
        onNavigateToSlide={setCurrentSlideIndex}
        isFullscreen={isFullscreen}
        onToggleFullscreen={handleToggleFullscreen}
        showNotes={showNotes}
        onToggleNotes={handleToggleNotes}
      />
    </div>
  );
};

export default PresentationModePage;
