import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Play, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { PresentationSlideList } from "@/components/presentations/PresentationSlideList";
import { SlideEditor } from "@/components/presentations/SlideEditor";
import { SlidePropertiesPanel } from "@/components/presentations/SlidePropertiesPanel";
import { AddSlideButton } from "@/components/presentations/AddSlideButton";

const PresentationBuilderPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [selectedSlideId, setSelectedSlideId] = useState<string | null>(null);
  const [slides, setSlides] = useState<any[]>([]);
  const [presentation, setPresentation] = useState<any>(null);

  const { data: presentationData, isLoading } = useQuery({
    queryKey: ["presentation", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("presentations")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: slidesData, refetch: refetchSlides } = useQuery({
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

  useEffect(() => {
    if (presentationData) {
      setPresentation(presentationData);
    }
  }, [presentationData]);

  useEffect(() => {
    if (slidesData) {
      setSlides(slidesData);
      if (slidesData.length > 0 && !selectedSlideId) {
        setSelectedSlideId(slidesData[0].id);
      }
    }
  }, [slidesData]);

  const handleSavePresentation = async () => {
    try {
      const { error } = await supabase
        .from("presentations")
        .update({
          name: presentation.name,
          description: presentation.description,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (error) throw error;

      toast({
        title: "Presentation saved",
        description: "Your changes have been saved successfully.",
      });
    } catch (error: any) {
      console.error("Error saving presentation:", error);
      toast({
        title: "Failed to save",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleStartPresentation = () => {
    navigate(`/presentations/${id}/present`);
  };

  const selectedSlide = slides.find((s) => s.id === selectedSlideId);

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading presentation...</p>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Top Toolbar */}
      <div className="h-16 border-b border-border flex items-center justify-between px-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/presentations")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <input
              type="text"
              value={presentation?.name || ""}
              onChange={(e) =>
                setPresentation({ ...presentation, name: e.target.value })
              }
              className="text-lg font-semibold bg-transparent border-none outline-none focus:ring-0"
              placeholder="Presentation Name"
            />
            <p className="text-xs text-muted-foreground">
              {slides.length} slide{slides.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AddSlideButton
            presentationId={id!}
            slideCount={slides.length}
            onSlideAdded={refetchSlides}
          />
          <Button variant="outline" onClick={handleSavePresentation}>
            <Save className="h-4 w-4 mr-2" />
            Save
          </Button>
          <Button onClick={handleStartPresentation}>
            <Play className="h-4 w-4 mr-2" />
            Start Presentation
          </Button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Slide List */}
        <div className="w-64 border-r border-border bg-muted/30 overflow-y-auto">
          <PresentationSlideList
            slides={slides}
            selectedSlideId={selectedSlideId}
            onSlideSelect={setSelectedSlideId}
            onSlidesReorder={setSlides}
            onRefetch={refetchSlides}
          />
        </div>

        {/* Center - Slide Editor */}
        <div className="flex-1 overflow-y-auto p-6">
          {selectedSlide ? (
            <SlideEditor
              slide={selectedSlide}
              onSlideUpdate={refetchSlides}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              <p>Select a slide to edit or add a new slide to get started</p>
            </div>
          )}
        </div>

        {/* Right Sidebar - Properties Panel */}
        <div className="w-80 border-l border-border bg-muted/30 overflow-y-auto">
          {selectedSlide && (
            <SlidePropertiesPanel
              slide={selectedSlide}
              onSlideUpdate={refetchSlides}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default PresentationBuilderPage;
