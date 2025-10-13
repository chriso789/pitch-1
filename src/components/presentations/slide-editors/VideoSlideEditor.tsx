import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Video } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";

interface VideoSlideEditorProps {
  slide: any;
  onUpdate: () => void;
}

export const VideoSlideEditor = ({ slide, onUpdate }: VideoSlideEditorProps) => {
  const { toast } = useToast();
  const [videoUrl, setVideoUrl] = useState(slide.content?.video_url || "");
  const [caption, setCaption] = useState(slide.content?.caption || "");

  useEffect(() => {
    setVideoUrl(slide.content?.video_url || "");
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
          {videoUrl ? (
            <div className="aspect-video bg-black rounded-lg">
              <iframe
                src={videoUrl}
                className="w-full h-full rounded-lg"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : (
            <div className="aspect-video bg-muted rounded-lg flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <Video className="h-16 w-16 mx-auto mb-2 opacity-50" />
                <p>No video URL provided</p>
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
          <Label htmlFor="video-url">Video URL</Label>
          <Input
            id="video-url"
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            onBlur={(e) => handleUpdate("video_url", e.target.value)}
            placeholder="https://www.youtube.com/embed/..."
          />
          <p className="text-xs text-muted-foreground">
            Use YouTube embed URL format
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="caption">Caption</Label>
          <Input
            id="caption"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onBlur={(e) => handleUpdate("caption", e.target.value)}
            placeholder="Video caption"
          />
        </div>
      </div>
    </div>
  );
};
