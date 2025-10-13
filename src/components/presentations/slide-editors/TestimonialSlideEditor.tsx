import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Star, Quote } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";

interface TestimonialSlideEditorProps {
  slide: any;
  onUpdate: () => void;
}

export const TestimonialSlideEditor = ({
  slide,
  onUpdate,
}: TestimonialSlideEditorProps) => {
  const { toast } = useToast();
  const [customerName, setCustomerName] = useState(
    slide.content?.customer_name || ""
  );
  const [quote, setQuote] = useState(slide.content?.quote || "");
  const [rating, setRating] = useState(slide.content?.rating || 5);

  useEffect(() => {
    setCustomerName(slide.content?.customer_name || "");
    setQuote(slide.content?.quote || "");
    setRating(slide.content?.rating || 5);
  }, [slide.id]);

  const handleUpdate = async (field: string, value: any) => {
    try {
      const updatedContent = {
        ...slide.content,
        [field]: value,
      };

      const { error } = await supabase
        .from("presentation_slides")
        .update({ content: updatedContent })
        .eq("id", slide.id);

      if (error) throw error;
      onUpdate();
    } catch (error: any) {
      console.error("Error updating slide:", error);
      toast({
        title: "Failed to update",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-8 bg-gradient-to-br from-primary/5 to-primary/10">
        <div className="space-y-6">
          <div className="flex justify-center">
            <Quote className="h-12 w-12 text-primary/30" />
          </div>

          <blockquote className="text-xl text-center italic">
            "{quote || "Customer testimonial will appear here..."}"
          </blockquote>

          <div className="flex justify-center gap-1">
            {[1, 2, 3, 4, 5].map((star) => (
              <Star
                key={star}
                className={`h-6 w-6 ${
                  star <= rating
                    ? "fill-yellow-400 text-yellow-400"
                    : "text-muted-foreground"
                }`}
              />
            ))}
          </div>

          <p className="text-center font-semibold text-lg">
            {customerName || "Customer Name"}
          </p>
        </div>
      </Card>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="customer-name">Customer Name</Label>
          <Input
            id="customer-name"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            onBlur={(e) => handleUpdate("customer_name", e.target.value)}
            placeholder="John Smith"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="quote">Testimonial Quote</Label>
          <Textarea
            id="quote"
            value={quote}
            onChange={(e) => setQuote(e.target.value)}
            onBlur={(e) => handleUpdate("quote", e.target.value)}
            placeholder="Enter the customer's testimonial..."
            rows={6}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="rating">Rating (1-5 stars)</Label>
          <Input
            id="rating"
            type="number"
            min="1"
            max="5"
            value={rating}
            onChange={(e) => {
              const val = parseInt(e.target.value);
              if (val >= 1 && val <= 5) {
                setRating(val);
              }
            }}
            onBlur={(e) => {
              const val = parseInt(e.target.value);
              if (val >= 1 && val <= 5) {
                handleUpdate("rating", val);
              }
            }}
          />
        </div>
      </div>
    </div>
  );
};
