import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Image } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";

interface ImageSlideEditorProps {
  slide: any;
  onUpdate: () => void;
}

export const ImageSlideEditor = ({ slide, onUpdate }: ImageSlideEditorProps) => {
  const { toast } = useToast();
  const [imageUrl, setImageUrl] = useState(slide.content?.image_url || "");
  const [caption, setCaption] = useState(slide.content?.caption || "");

  useEffect(() => {
    setImageUrl(slide.content?.image_url || "");
    setCaption(slide.content?.caption || "");
  }, [slide.id]);

  const handleUpdate = async (field: string, value: string) => {
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
      <Card className="p-8">
        <div className="space-y-4">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={caption || "Slide image"}
              className="w-full h-96 object-cover rounded-lg"
            />
          ) : (
            <div className="w-full h-96 bg-muted rounded-lg flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <Image className="h-16 w-16 mx-auto mb-2 opacity-50" />
                <p>No image selected</p>
              </div>
            </div>
          )}
          {caption && (
            <p className="text-center text-lg text-muted-foreground">{caption}</p>
          )}
        </div>
      </Card>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="image-url">Image URL</Label>
          <Input
            id="image-url"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            onBlur={(e) => handleUpdate("image_url", e.target.value)}
            placeholder="https://example.com/image.jpg"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="caption">Caption</Label>
          <Input
            id="caption"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onBlur={(e) => handleUpdate("caption", e.target.value)}
            placeholder="Image caption"
          />
        </div>
      </div>
    </div>
  );
};
