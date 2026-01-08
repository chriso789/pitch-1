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

  // Get photo URL from storage path
  const getPhotoUrl = (storagePath: string) => {
    if (!storagePath) return '';
    if (storagePath.startsWith('http')) return storagePath;
    const { data } = supabase.storage.from('project-photos').getPublicUrl(storagePath);
    return data?.publicUrl || '';
  };

  const renderSlideContent = () => {
    const content = slide.content || {};
    const slideTitle = content.title || '';
    
    switch (slide.slide_type) {
      case "title":
        return (
          <div className="text-center space-y-6">
            {content.logo && (
              <img 
                src={content.logo} 
                alt="Company logo" 
                className="h-24 mx-auto mb-8 object-contain"
              />
            )}
            <h1 className="text-6xl font-bold">{slideTitle || content.heading || "Title"}</h1>
            {content.subtitle && (
              <p className="text-3xl text-muted-foreground">{content.subtitle}</p>
            )}
            {content.address && (
              <p className="text-xl text-muted-foreground mt-4">{content.address}</p>
            )}
          </div>
        );

      case "about":
      case "about_us":
        return (
          <div className="space-y-6">
            <h2 className="text-4xl font-bold text-center">{slideTitle || "About Us"}</h2>
            {content.logo && (
              <img 
                src={content.logo} 
                alt="Company logo" 
                className="h-20 mx-auto mb-6 object-contain"
              />
            )}
            {content.body && (
              <p className="text-2xl leading-relaxed whitespace-pre-wrap">{content.body}</p>
            )}
            {content.ai_content && (
              <p className="text-2xl leading-relaxed whitespace-pre-wrap">{content.ai_content}</p>
            )}
            <div className="grid grid-cols-2 gap-4 mt-8 text-lg">
              {content.license && (
                <div className="flex items-center gap-2">
                  <span className="font-semibold">License:</span> {content.license}
                </div>
              )}
              {content.phone && (
                <div className="flex items-center gap-2">
                  <span className="font-semibold">Phone:</span> {content.phone}
                </div>
              )}
              {content.website && (
                <div className="flex items-center gap-2">
                  <span className="font-semibold">Website:</span> {content.website}
                </div>
              )}
            </div>
          </div>
        );

      case "text":
        return (
          <div className="space-y-6">
            {(content.heading || slideTitle) && (
              <h2 className="text-4xl font-bold">{content.heading || slideTitle}</h2>
            )}
            {content.body && (
              <p className="text-2xl leading-relaxed whitespace-pre-wrap">{content.body}</p>
            )}
            {content.ai_content && (
              <p className="text-2xl leading-relaxed whitespace-pre-wrap">{content.ai_content}</p>
            )}
          </div>
        );

      case "photo_gallery":
      case "property_photos":
        const photos = content.photos || [];
        return (
          <div className="space-y-6">
            <h2 className="text-4xl font-bold text-center">{slideTitle || "Property Overview"}</h2>
            {photos.length > 0 ? (
              <div className="grid grid-cols-2 gap-4">
                {photos.slice(0, 4).map((photo: any, index: number) => (
                  <img
                    key={photo.id || index}
                    src={getPhotoUrl(photo.storage_path)}
                    alt={photo.ai_description || `Property photo ${index + 1}`}
                    className="rounded-lg object-cover aspect-video w-full"
                  />
                ))}
              </div>
            ) : (
              <div className="text-center text-muted-foreground py-12">
                <p className="text-xl">No property photos available</p>
              </div>
            )}
            {content.description && (
              <p className="text-xl text-center text-muted-foreground">{content.description}</p>
            )}
          </div>
        );

      case "scope":
      case "scope_of_work":
        return (
          <div className="space-y-6">
            <h2 className="text-4xl font-bold text-center">{slideTitle || "Scope of Work"}</h2>
            {content.body && (
              <p className="text-2xl leading-relaxed whitespace-pre-wrap">{content.body}</p>
            )}
            {content.ai_content && (
              <p className="text-2xl leading-relaxed whitespace-pre-wrap">{content.ai_content}</p>
            )}
            {content.items && Array.isArray(content.items) && (
              <ul className="space-y-3 text-xl">
                {content.items.map((item: string, i: number) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="text-primary">✓</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );

      case "materials":
        return (
          <div className="space-y-6">
            <h2 className="text-4xl font-bold text-center">{slideTitle || "Premium Materials"}</h2>
            {content.material_list && (
              <pre className="text-xl leading-relaxed whitespace-pre-wrap font-sans">{content.material_list}</pre>
            )}
            {content.ai_content && (
              <p className="text-2xl leading-relaxed whitespace-pre-wrap">{content.ai_content}</p>
            )}
            {content.body && (
              <p className="text-2xl leading-relaxed whitespace-pre-wrap">{content.body}</p>
            )}
          </div>
        );

      case "image":
        return (
          <div className="space-y-6 text-center">
            {content.imageUrl && (
              <img
                src={content.imageUrl}
                alt={content.caption || "Slide image"}
                className="max-h-[70vh] mx-auto rounded-lg"
              />
            )}
            {content.caption && (
              <p className="text-2xl text-muted-foreground">{content.caption}</p>
            )}
          </div>
        );

      case "video":
        return (
          <div className="space-y-6">
            {content.videoUrl && (
              <iframe
                src={content.videoUrl}
                className="w-full aspect-video rounded-lg"
                allowFullScreen
              />
            )}
            {content.caption && (
              <p className="text-2xl text-center text-muted-foreground">{content.caption}</p>
            )}
          </div>
        );

      case "estimate_summary":
      case "pricing":
        return (
          <div className="space-y-6">
            <h2 className="text-4xl font-bold text-center">{slideTitle || "Your Investment"}</h2>
            <Card className="p-8">
              <div className="space-y-4 text-2xl">
                {content.scope && (
                  <div className="flex justify-between">
                    <span>Project Scope:</span>
                    <span className="font-semibold">{content.scope}</span>
                  </div>
                )}
                {content.materials && (
                  <div className="flex justify-between">
                    <span>Materials:</span>
                    <span className="font-semibold">{content.materials}</span>
                  </div>
                )}
                {content.labor && (
                  <div className="flex justify-between">
                    <span>Labor:</span>
                    <span className="font-semibold">{content.labor}</span>
                  </div>
                )}
                <div className="border-t pt-4 flex justify-between text-3xl font-bold">
                  <span>Total Investment:</span>
                  <span className="text-primary">{content.total || content.selling_price || "$0.00"}</span>
                </div>
              </div>
            </Card>
            {content.payment_terms && (
              <p className="text-lg text-center text-muted-foreground">{content.payment_terms}</p>
            )}
          </div>
        );

      case "warranty":
        return (
          <div className="space-y-6">
            <h2 className="text-4xl font-bold text-center">{slideTitle || "Our Warranty"}</h2>
            {content.body && (
              <p className="text-2xl leading-relaxed whitespace-pre-wrap">{content.body}</p>
            )}
            {content.ai_content && (
              <p className="text-2xl leading-relaxed whitespace-pre-wrap">{content.ai_content}</p>
            )}
            {content.warranty_years && (
              <div className="text-center mt-8">
                <span className="text-6xl font-bold text-primary">{content.warranty_years}</span>
                <span className="text-2xl ml-2">Year Warranty</span>
              </div>
            )}
          </div>
        );

      case "timeline":
        return (
          <div className="space-y-6">
            <h2 className="text-4xl font-bold text-center">{slideTitle || "Project Timeline"}</h2>
            {content.body && (
              <p className="text-2xl leading-relaxed whitespace-pre-wrap">{content.body}</p>
            )}
            {content.ai_content && (
              <p className="text-2xl leading-relaxed whitespace-pre-wrap">{content.ai_content}</p>
            )}
          </div>
        );

      case "financing":
        return (
          <div className="space-y-6">
            <h2 className="text-4xl font-bold text-center">{slideTitle || "Financing Options"}</h2>
            {content.body && (
              <p className="text-2xl leading-relaxed whitespace-pre-wrap">{content.body}</p>
            )}
            {content.ai_content && (
              <p className="text-2xl leading-relaxed whitespace-pre-wrap">{content.ai_content}</p>
            )}
          </div>
        );

      case "next_steps":
      case "cta":
        return (
          <div className="space-y-8 text-center">
            <h2 className="text-4xl font-bold">{slideTitle || "Ready to Get Started?"}</h2>
            {content.body && (
              <p className="text-2xl leading-relaxed">{content.body}</p>
            )}
            {content.ai_content && (
              <p className="text-2xl leading-relaxed">{content.ai_content}</p>
            )}
            <div className="mt-8 space-y-4">
              {content.phone && (
                <p className="text-xl">📞 Call us: {content.phone}</p>
              )}
              {content.email && (
                <p className="text-xl">✉️ Email: {content.email}</p>
              )}
            </div>
          </div>
        );

      case "testimonial":
        return (
          <div className="space-y-8 text-center max-w-4xl mx-auto">
            <div className="text-6xl text-primary mb-4">"</div>
            <p className="text-3xl italic leading-relaxed">{content.quote || "Customer testimonial..."}</p>
            <div className="space-y-2">
              <p className="text-2xl font-semibold">{content.author || "Customer Name"}</p>
              <p className="text-xl text-muted-foreground">{content.role || "Homeowner"}</p>
            </div>
          </div>
        );

      case "signature":
        return (
          <div className="flex flex-col items-center justify-center h-full p-8">
            <h2 className="text-3xl font-bold mb-4">{slideTitle || "Signature Required"}</h2>
            <p className="text-muted-foreground mb-8">{content.description}</p>
            <div className="w-full max-w-2xl">
              <SignatureCapture onSave={handleSignatureSave} />
            </div>
          </div>
        );

      default:
        return (
          <div className="space-y-6">
            {slideTitle && <h2 className="text-4xl font-bold text-center">{slideTitle}</h2>}
            {content.body && (
              <p className="text-2xl leading-relaxed whitespace-pre-wrap">{content.body}</p>
            )}
            {content.ai_content && (
              <p className="text-2xl leading-relaxed whitespace-pre-wrap">{content.ai_content}</p>
            )}
            {!slideTitle && !content.body && !content.ai_content && (
              <p className="text-muted-foreground text-center">Slide type: {slide.slide_type}</p>
            )}
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
