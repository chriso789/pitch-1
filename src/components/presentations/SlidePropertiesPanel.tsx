import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { useState, useEffect } from "react";

interface SlidePropertiesPanelProps {
  slide: any;
  onSlideUpdate: () => void;
}

export const SlidePropertiesPanel = ({
  slide,
  onSlideUpdate,
}: SlidePropertiesPanelProps) => {
  const { toast } = useToast();
  const [notes, setNotes] = useState(slide.notes || "");
  const [transitionEffect, setTransitionEffect] = useState(
    slide.transition_effect || "fade"
  );

  useEffect(() => {
    setNotes(slide.notes || "");
    setTransitionEffect(slide.transition_effect || "fade");
  }, [slide.id]);

  const handleNotesUpdate = async (value: string) => {
    setNotes(value);
    try {
      const { error } = await supabase
        .from("presentation_slides")
        .update({ notes: value })
        .eq("id", slide.id);

      if (error) throw error;
    } catch (error: any) {
      console.error("Error updating notes:", error);
      toast({
        title: "Failed to update notes",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleTransitionUpdate = async (value: string) => {
    setTransitionEffect(value);
    try {
      const { error } = await supabase
        .from("presentation_slides")
        .update({ transition_effect: value })
        .eq("id", slide.id);

      if (error) throw error;

      toast({
        title: "Transition updated",
        description: "Slide transition effect has been changed.",
      });

      onSlideUpdate();
    } catch (error: any) {
      console.error("Error updating transition:", error);
      toast({
        title: "Failed to update transition",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="p-4 space-y-6">
      <div>
        <h3 className="font-semibold mb-4">Slide Properties</h3>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="transition">Transition Effect</Label>
          <Select value={transitionEffect} onValueChange={handleTransitionUpdate}>
            <SelectTrigger id="transition">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fade">Fade</SelectItem>
              <SelectItem value="slide">Slide</SelectItem>
              <SelectItem value="zoom">Zoom</SelectItem>
              <SelectItem value="none">None</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="notes">Presenter Notes</Label>
          <Textarea
            id="notes"
            placeholder="Add notes for yourself (not visible to audience)"
            value={notes}
            onChange={(e) => handleNotesUpdate(e.target.value)}
            rows={8}
          />
          <p className="text-xs text-muted-foreground">
            These notes are only visible to you during presentation mode
          </p>
        </div>
      </div>
    </div>
  );
};
