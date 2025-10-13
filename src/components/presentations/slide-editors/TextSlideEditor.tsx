import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";

interface TextSlideEditorProps {
  slide: any;
  onUpdate: () => void;
}

export const TextSlideEditor = ({ slide, onUpdate }: TextSlideEditorProps) => {
  const { toast } = useToast();
  const [heading, setHeading] = useState(slide.content?.heading || "");
  const [body, setBody] = useState(slide.content?.body || "");

  useEffect(() => {
    setHeading(slide.content?.heading || "");
    setBody(slide.content?.body || "");
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
          <h2 className="text-3xl font-bold">{heading || "Heading"}</h2>
          <div className="prose max-w-none">
            <p className="text-lg whitespace-pre-wrap">{body || "Body text will appear here..."}</p>
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="heading">Heading</Label>
          <Input
            id="heading"
            value={heading}
            onChange={(e) => setHeading(e.target.value)}
            onBlur={(e) => handleUpdate("heading", e.target.value)}
            placeholder="Enter heading"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="body">Body Text</Label>
          <Textarea
            id="body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onBlur={(e) => handleUpdate("body", e.target.value)}
            placeholder="Enter body text"
            rows={10}
          />
        </div>
      </div>
    </div>
  );
};
