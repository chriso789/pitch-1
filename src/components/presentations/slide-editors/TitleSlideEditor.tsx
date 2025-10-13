import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";

interface TitleSlideEditorProps {
  slide: any;
  onUpdate: () => void;
}

export const TitleSlideEditor = ({ slide, onUpdate }: TitleSlideEditorProps) => {
  const { toast } = useToast();
  const [title, setTitle] = useState(slide.content?.title || "");
  const [subtitle, setSubtitle] = useState(slide.content?.subtitle || "");

  useEffect(() => {
    setTitle(slide.content?.title || "");
    setSubtitle(slide.content?.subtitle || "");
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
      <Card className="p-8 bg-gradient-to-br from-primary/5 to-primary/10">
        <div className="text-center space-y-4">
          <h1 className="text-5xl font-bold text-foreground">{title || "Title"}</h1>
          <p className="text-2xl text-muted-foreground">{subtitle || "Subtitle"}</p>
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
            placeholder="Enter title"
            className="text-lg"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="subtitle">Subtitle</Label>
          <Input
            id="subtitle"
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            onBlur={(e) => handleUpdate("subtitle", e.target.value)}
            placeholder="Enter subtitle"
          />
        </div>
      </div>
    </div>
  );
};
