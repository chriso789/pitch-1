import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { Ruler, Home, TrendingUp, Layers } from "lucide-react";

interface MetricsSlideEditorProps {
  slide: any;
  onUpdate: () => void;
}

export const MetricsSlideEditor = ({ slide, onUpdate }: MetricsSlideEditorProps) => {
  const { toast } = useToast();
  const [title, setTitle] = useState(slide.content?.title || "Property Measurements");
  const [totalArea, setTotalArea] = useState(slide.content?.total_area || "");
  const [squares, setSquares] = useState(slide.content?.squares || "");
  const [pitch, setPitch] = useState(slide.content?.pitch || "");
  const [stories, setStories] = useState(slide.content?.stories || "");

  useEffect(() => {
    setTitle(slide.content?.title || "Property Measurements");
    setTotalArea(slide.content?.total_area || "");
    setSquares(slide.content?.squares || "");
    setPitch(slide.content?.pitch || "");
    setStories(slide.content?.stories || "");
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
        <h2 className="text-3xl font-bold text-center mb-8">{title}</h2>
        <div className="grid grid-cols-2 gap-6">
          <Card className="p-6 bg-primary/5 border-primary/20">
            <div className="flex items-center gap-3 mb-2">
              <Ruler className="h-6 w-6 text-primary" />
              <span className="text-muted-foreground">Total Area</span>
            </div>
            <p className="text-3xl font-bold">{totalArea || "—"} sq ft</p>
          </Card>
          <Card className="p-6 bg-primary/5 border-primary/20">
            <div className="flex items-center gap-3 mb-2">
              <Layers className="h-6 w-6 text-primary" />
              <span className="text-muted-foreground">Squares</span>
            </div>
            <p className="text-3xl font-bold">{squares || "—"}</p>
          </Card>
          <Card className="p-6 bg-primary/5 border-primary/20">
            <div className="flex items-center gap-3 mb-2">
              <TrendingUp className="h-6 w-6 text-primary" />
              <span className="text-muted-foreground">Pitch</span>
            </div>
            <p className="text-3xl font-bold">{pitch || "—"}</p>
          </Card>
          <Card className="p-6 bg-primary/5 border-primary/20">
            <div className="flex items-center gap-3 mb-2">
              <Home className="h-6 w-6 text-primary" />
              <span className="text-muted-foreground">Stories</span>
            </div>
            <p className="text-3xl font-bold">{stories || "—"}</p>
          </Card>
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
            placeholder="Property Measurements"
          />
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="total-area">Total Area (sq ft)</Label>
            <Input
              id="total-area"
              value={totalArea}
              onChange={(e) => setTotalArea(e.target.value)}
              onBlur={(e) => handleUpdate("total_area", e.target.value)}
              placeholder="2,500"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="squares">Squares</Label>
            <Input
              id="squares"
              value={squares}
              onChange={(e) => setSquares(e.target.value)}
              onBlur={(e) => handleUpdate("squares", e.target.value)}
              placeholder="25"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="pitch">Pitch</Label>
            <Input
              id="pitch"
              value={pitch}
              onChange={(e) => setPitch(e.target.value)}
              onBlur={(e) => handleUpdate("pitch", e.target.value)}
              placeholder="6/12"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="stories">Stories</Label>
            <Input
              id="stories"
              value={stories}
              onChange={(e) => setStories(e.target.value)}
              onBlur={(e) => handleUpdate("stories", e.target.value)}
              placeholder="2"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
