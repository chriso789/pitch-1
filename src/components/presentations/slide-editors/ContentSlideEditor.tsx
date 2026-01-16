import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";

interface ContentSlideEditorProps {
  slide: any;
  onUpdate: () => void;
}

export const ContentSlideEditor = ({ slide, onUpdate }: ContentSlideEditorProps) => {
  const { toast } = useToast();
  const [title, setTitle] = useState(slide.content?.title || "");
  const [heading, setHeading] = useState(slide.content?.heading || "");
  const [body, setBody] = useState(slide.content?.body || "");
  const [imageUrl, setImageUrl] = useState(slide.content?.image_url || "");

  useEffect(() => {
    setTitle(slide.content?.title || "");
    setHeading(slide.content?.heading || "");
    setBody(slide.content?.body || "");
    setImageUrl(slide.content?.image_url || "");
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
          {(title || heading) && (
            <h2 className="text-3xl font-bold">{title || heading}</h2>
          )}
          {body && (
            <p className="text-xl leading-relaxed text-muted-foreground whitespace-pre-wrap">
              {body}
            </p>
          )}
          {imageUrl && (
            <img
              src={imageUrl}
              alt="Content image"
              className="w-full max-h-64 object-cover rounded-lg mt-4"
            />
          )}
          {!title && !heading && !body && !imageUrl && (
            <p className="text-muted-foreground text-center py-8">
              Add content to this slide using the fields below
            </p>
          )}
        </div>
      </Card>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={(e) => handleUpdate("title", e.target.value)}
            placeholder="Slide title"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="heading">Heading</Label>
          <Input
            id="heading"
            value={heading}
            onChange={(e) => setHeading(e.target.value)}
            onBlur={(e) => handleUpdate("heading", e.target.value)}
            placeholder="Section heading"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="body">Body Content</Label>
          <Textarea
            id="body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onBlur={(e) => handleUpdate("body", e.target.value)}
            placeholder="Enter the main content for this slide..."
            className="min-h-[120px]"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="image-url">Image URL (optional)</Label>
          <Input
            id="image-url"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            onBlur={(e) => handleUpdate("image_url", e.target.value)}
            placeholder="https://example.com/image.jpg"
          />
        </div>
      </div>
    </div>
  );
};
