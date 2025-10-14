import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { SlideRenderer } from "@/components/presentations/SlideRenderer";
import { PresentationControls } from "@/components/presentations/PresentationControls";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChevronLeft, ChevronRight } from "lucide-react";

const CustomerPresentationView = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const { toast } = useToast();
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isValidated, setIsValidated] = useState(false);

  // Validate token and start session
  useEffect(() => {
    const validateAndStart = async () => {
      if (!id || !token) {
        toast({
          title: "Invalid link",
          description: "This presentation link is invalid.",
          variant: "destructive",
        });
        return;
      }

      try {
        const { data, error } = await supabase
          .rpc("validate_presentation_token", {
            p_presentation_id: id,
            p_token: token,
          });

        if (error) throw error;
        
        setSessionId(data);
        setIsValidated(true);
      } catch (error: any) {
        console.error("Error validating token:", error);
        toast({
          title: "Invalid or expired link",
          description: error.message,
          variant: "destructive",
        });
      }
    };

    validateAndStart();
  }, [id, token]);

  const { data: slides, isLoading } = useQuery({
    queryKey: ["presentation-slides-public", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("presentation_slides")
        .select("*")
        .eq("presentation_id", id)
        .order("slide_order", { ascending: true });
      
      if (error) throw error;
      return data;
    },
    enabled: !!id && isValidated,
  });

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

  const handleComplete = async () => {
    if (sessionId) {
      try {
        await supabase.rpc("complete_presentation_session", {
          p_session_id: sessionId,
        });

        toast({
          title: "Thank you!",
          description: "You've completed viewing this presentation.",
        });
      } catch (error) {
        console.error("Error completing session:", error);
      }
    }
  };

  if (!isValidated) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <Card className="p-8 max-w-md text-center">
          <p className="text-muted-foreground">Validating presentation link...</p>
        </Card>
      </div>
    );
  }

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
        <Card className="p-8 max-w-md text-center">
          <p className="text-muted-foreground">No slides found in this presentation.</p>
        </Card>
      </div>
    );
  }

  const currentSlide = slides[currentSlideIndex];
  const isLastSlide = currentSlideIndex === slides.length - 1;

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
      <div className="h-20 border-t border-border bg-muted/30 flex items-center justify-between px-8">
        <div className="text-sm text-muted-foreground">
          Customer View
        </div>

        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            onClick={handlePrevious}
            disabled={currentSlideIndex === 0}
          >
            <ChevronLeft className="h-4 w-4 mr-2" />
            Previous
          </Button>

          <span className="text-lg font-semibold min-w-[80px] text-center">
            {currentSlideIndex + 1} / {slides.length}
          </span>

          {!isLastSlide ? (
            <Button variant="outline" onClick={handleNext}>
              Next
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          ) : (
            <Button onClick={handleComplete}>
              Complete
            </Button>
          )}
        </div>

        <div className="w-[100px]" />
      </div>
    </div>
  );
};

export default CustomerPresentationView;
