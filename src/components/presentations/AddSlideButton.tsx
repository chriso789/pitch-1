import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";

interface AddSlideButtonProps {
  presentationId: string;
  slideCount: number;
  onSlideAdded: () => void;
}

export const AddSlideButton = ({
  presentationId,
  slideCount,
  onSlideAdded,
}: AddSlideButtonProps) => {
  const { toast } = useToast();

  const slideTypes = [
    { value: "title", label: "Title Slide", description: "Company intro & title" },
    { value: "text", label: "Text Slide", description: "Formatted text content" },
    { value: "image", label: "Image Slide", description: "Image with caption" },
    { value: "video", label: "Video Slide", description: "Video content" },
    { value: "section_menu", label: "Section Menu", description: "Navigation hub with links" },
    { value: "pricing_comparison", label: "Good/Better/Best", description: "Pricing comparison options" },
    { value: "estimate_summary", label: "Estimate Summary", description: "Project pricing breakdown" },
    { value: "testimonial", label: "Testimonial", description: "Customer review" },
    { value: "signature", label: "Signature", description: "Capture customer signature" },
  ];

  const handleAddSlide = async (slideType: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: profile } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("id", user.id)
        .single();

      const defaultContent: Record<string, any> = {
        title: { title: "New Title", subtitle: "", background: { type: "color", value: "#ffffff" } },
        text: { heading: "New Slide", body: "", text_align: "left" },
        image: { image_url: "", caption: "", layout: "centered" },
        video: { video_url: "", video_type: "youtube", autoplay: false, caption: "" },
        section_menu: { title: "Choose a Topic", description: "", navigation_links: [] },
        pricing_comparison: { title: "Your Investment Options", options: [
          { tier: "good", name: "Standard", price: "$15,000", features: ["25-year shingles", "5-year warranty"], recommended: false },
          { tier: "better", name: "Enhanced", price: "$20,000", features: ["30-year shingles", "10-year warranty"], recommended: true, badge: "Most Popular" },
          { tier: "best", name: "Premium", price: "$25,000", features: ["50-year shingles", "Lifetime warranty"], recommended: false },
        ]},
        estimate_summary: { estimate_id: null, show_materials: true, show_labor: true, show_profit: true },
        testimonial: { customer_name: "", customer_photo_url: "", quote: "", rating: 5 },
        signature: { document_title: "Agreement", legal_text: "", require_date: true, require_printed_name: true },
      };

      const { error } = await supabase
        .from("presentation_slides")
        .insert({
          tenant_id: profile.tenant_id,
          presentation_id: presentationId,
          slide_order: slideCount,
          slide_type: slideType,
          content: defaultContent[slideType] || {},
          transition_effect: "fade",
        });

      if (error) throw error;

      toast({
        title: "Slide added",
        description: `New ${slideType} slide has been added.`,
      });

      onSlideAdded();
    } catch (error: any) {
      console.error("Error adding slide:", error);
      toast({
        title: "Failed to add slide",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <Plus className="h-4 w-4 mr-2" />
          Add Slide
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {slideTypes.map((type) => (
          <DropdownMenuItem
            key={type.value}
            onClick={() => handleAddSlide(type.value)}
          >
            <div>
              <div className="font-medium">{type.label}</div>
              <div className="text-xs text-muted-foreground">
                {type.description}
              </div>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
