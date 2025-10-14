import { Card } from "@/components/ui/card";
import { SignatureCapture } from "./SignatureCapture";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface SlideRendererProps {
  slide: any;
  sessionId: string | null;
}

export const SlideRenderer = ({ slide, sessionId }: SlideRendererProps) => {
  const { toast } = useToast();

  const handleSignatureSave = async (signatureData: string) => {
    if (!sessionId) return;

    try {
      await supabase.rpc("complete_presentation_session", {
        p_session_id: sessionId,
        p_signature_data: { signature: signatureData, captured_at: new Date().toISOString() },
      });

      toast({
        title: "Signature saved",
        description: "Your signature has been captured successfully",
      });
    } catch (error: any) {
      toast({
        title: "Failed to save signature",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const renderSlideContent = () => {
    switch (slide.slide_type) {
      case "title":
        return (
          <div className="text-center space-y-6">
            <h1 className="text-6xl font-bold">{slide.content.title || "Title"}</h1>
            {slide.content.subtitle && (
              <p className="text-3xl text-muted-foreground">{slide.content.subtitle}</p>
            )}
          </div>
        );

      case "text":
        return (
          <div className="space-y-6">
            {slide.content.heading && (
              <h2 className="text-4xl font-bold">{slide.content.heading}</h2>
            )}
            {slide.content.body && (
              <p className="text-2xl leading-relaxed whitespace-pre-wrap">{slide.content.body}</p>
            )}
          </div>
        );

      case "image":
        return (
          <div className="space-y-6 text-center">
            {slide.content.imageUrl && (
              <img
                src={slide.content.imageUrl}
                alt={slide.content.caption || "Slide image"}
                className="max-h-[70vh] mx-auto rounded-lg"
              />
            )}
            {slide.content.caption && (
              <p className="text-2xl text-muted-foreground">{slide.content.caption}</p>
            )}
          </div>
        );

      case "video":
        return (
          <div className="space-y-6">
            {slide.content.videoUrl && (
              <iframe
                src={slide.content.videoUrl}
                className="w-full aspect-video rounded-lg"
                allowFullScreen
              />
            )}
            {slide.content.caption && (
              <p className="text-2xl text-center text-muted-foreground">{slide.content.caption}</p>
            )}
          </div>
        );

      case "estimate_summary":
        return (
          <div className="space-y-6">
            <h2 className="text-4xl font-bold text-center">Estimate Summary</h2>
            <Card className="p-8">
              <div className="space-y-4 text-2xl">
                <div className="flex justify-between">
                  <span>Project Scope:</span>
                  <span className="font-semibold">{slide.content.scope || "Full Roof Replacement"}</span>
                </div>
                <div className="flex justify-between">
                  <span>Materials:</span>
                  <span className="font-semibold">${slide.content.materials || "0.00"}</span>
                </div>
                <div className="flex justify-between">
                  <span>Labor:</span>
                  <span className="font-semibold">${slide.content.labor || "0.00"}</span>
                </div>
                <div className="border-t pt-4 flex justify-between text-3xl font-bold">
                  <span>Total Investment:</span>
                  <span className="text-primary">${slide.content.total || "0.00"}</span>
                </div>
              </div>
            </Card>
          </div>
        );

      case "testimonial":
        return (
          <div className="space-y-8 text-center max-w-4xl mx-auto">
            <div className="text-6xl text-primary mb-4">"</div>
            <p className="text-3xl italic leading-relaxed">{slide.content.quote || "Customer testimonial..."}</p>
            <div className="space-y-2">
              <p className="text-2xl font-semibold">{slide.content.author || "Customer Name"}</p>
              <p className="text-xl text-muted-foreground">{slide.content.role || "Homeowner"}</p>
            </div>
          </div>
        );

      case "signature":
        return (
          <div className="flex flex-col items-center justify-center h-full p-8">
            <h2 className="text-3xl font-bold mb-4">{slide.content?.title || "Signature Required"}</h2>
            <p className="text-muted-foreground mb-8">{slide.content?.description}</p>
            <div className="w-full max-w-2xl">
              <SignatureCapture onSave={handleSignatureSave} />
            </div>
          </div>
        );

      default:
        return (
          <div className="text-center">
            <p className="text-muted-foreground">Unknown slide type: {slide.slide_type}</p>
          </div>
        );
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto">
      {renderSlideContent()}
    </div>
  );
};
