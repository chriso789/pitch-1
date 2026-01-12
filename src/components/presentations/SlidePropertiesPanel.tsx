import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight } from "lucide-react";

interface VisibilityConditions {
  job_types?: string[];
  roof_types?: string[];
  is_insurance?: boolean;
  has_estimate?: boolean;
}

interface SlidePropertiesPanelProps {
  slide: any;
  onSlideUpdate: () => void;
  sections?: { id: string; name: string }[];
}

export const SlidePropertiesPanel = ({
  slide,
  onSlideUpdate,
  sections = [],
}: SlidePropertiesPanelProps) => {
  const { toast } = useToast();
  const [notes, setNotes] = useState(slide.notes || "");
  const [transitionEffect, setTransitionEffect] = useState(slide.transition_effect || "fade");
  const [sectionId, setSectionId] = useState(slide.section_id || "none");
  const [isEnabled, setIsEnabled] = useState(slide.is_enabled !== false);
  const [visibilityConditions, setVisibilityConditions] = useState<VisibilityConditions>(
    slide.visibility_conditions || {}
  );
  const [isVisibilityOpen, setIsVisibilityOpen] = useState(false);

  // Fetch sections if not provided
  const { data: fetchedSections } = useQuery({
    queryKey: ["presentation-sections", slide.presentation_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("presentation_sections")
        .select("id, name")
        .eq("presentation_id", slide.presentation_id)
        .order("section_order", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: sections.length === 0,
  });

  const availableSections = sections.length > 0 ? sections : (fetchedSections || []);

  useEffect(() => {
    setNotes(slide.notes || "");
    setTransitionEffect(slide.transition_effect || "fade");
    setSectionId(slide.section_id || "none");
    setIsEnabled(slide.is_enabled !== false);
    setVisibilityConditions(slide.visibility_conditions || {});
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

  const handleSectionUpdate = async (value: string) => {
    const newSectionId = value === "none" ? null : value;
    setSectionId(value);
    try {
      const { error } = await supabase
        .from("presentation_slides")
        .update({ section_id: newSectionId })
        .eq("id", slide.id);

      if (error) throw error;

      toast({
        title: "Section updated",
        description: "Slide has been assigned to the section.",
      });

      onSlideUpdate();
    } catch (error: any) {
      console.error("Error updating section:", error);
      toast({
        title: "Failed to update section",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleEnabledUpdate = async (value: boolean) => {
    setIsEnabled(value);
    try {
      const { error } = await supabase
        .from("presentation_slides")
        .update({ is_enabled: value })
        .eq("id", slide.id);

      if (error) throw error;

      toast({
        title: value ? "Slide enabled" : "Slide disabled",
        description: value 
          ? "Slide will be shown in presentations." 
          : "Slide will be hidden from presentations.",
      });

      onSlideUpdate();
    } catch (error: any) {
      console.error("Error updating enabled state:", error);
      toast({
        title: "Failed to update slide",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleVisibilityConditionChange = async (key: keyof VisibilityConditions, value: any) => {
    const newConditions = { ...visibilityConditions };
    
    if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) {
      delete newConditions[key];
    } else {
      newConditions[key] = value;
    }

    setVisibilityConditions(newConditions);

    try {
      const { error } = await supabase
        .from("presentation_slides")
        .update({ visibility_conditions: Object.keys(newConditions).length > 0 ? newConditions : null })
        .eq("id", slide.id);

      if (error) throw error;
      onSlideUpdate();
    } catch (error: any) {
      console.error("Error updating visibility conditions:", error);
      toast({
        title: "Failed to update visibility",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const toggleArrayCondition = (key: "job_types" | "roof_types", value: string) => {
    const current = visibilityConditions[key] || [];
    const updated = current.includes(value)
      ? current.filter(v => v !== value)
      : [...current, value];
    handleVisibilityConditionChange(key, updated.length > 0 ? updated : undefined);
  };

  return (
    <div className="p-4 space-y-6">
      <div>
        <h3 className="font-semibold mb-4">Slide Properties</h3>
      </div>

      <div className="space-y-4">
        {/* Enable/Disable Toggle */}
        <div className="flex items-center justify-between">
          <Label htmlFor="enabled" className="cursor-pointer">Enabled</Label>
          <Switch
            id="enabled"
            checked={isEnabled}
            onCheckedChange={handleEnabledUpdate}
          />
        </div>

        <Separator />

        {/* Section Assignment */}
        <div className="space-y-2">
          <Label htmlFor="section">Section</Label>
          <Select value={sectionId} onValueChange={handleSectionUpdate}>
            <SelectTrigger id="section">
              <SelectValue placeholder="Select section" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No Section</SelectItem>
              {availableSections.map((section) => (
                <SelectItem key={section.id} value={section.id}>
                  {section.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Group slides into sections for navigation
          </p>
        </div>

        {/* Transition Effect */}
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

        <Separator />

        {/* Visibility Conditions */}
        <Collapsible open={isVisibilityOpen} onOpenChange={setIsVisibilityOpen}>
          <CollapsibleTrigger className="flex items-center gap-2 w-full text-left">
            {isVisibilityOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <Label className="cursor-pointer">Visibility Conditions</Label>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 space-y-4 pl-6">
            {/* Job Types */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Show for Job Types</Label>
              <div className="space-y-2">
                {["roofing", "siding", "gutters", "windows", "solar"].map((type) => (
                  <div key={type} className="flex items-center gap-2">
                    <Checkbox
                      id={`job-${type}`}
                      checked={(visibilityConditions.job_types || []).includes(type)}
                      onCheckedChange={() => toggleArrayCondition("job_types", type)}
                    />
                    <Label htmlFor={`job-${type}`} className="text-sm capitalize cursor-pointer">
                      {type}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            {/* Roof Types */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Show for Roof Types</Label>
              <div className="space-y-2">
                {["asphalt", "metal", "tile", "flat", "slate"].map((type) => (
                  <div key={type} className="flex items-center gap-2">
                    <Checkbox
                      id={`roof-${type}`}
                      checked={(visibilityConditions.roof_types || []).includes(type)}
                      onCheckedChange={() => toggleArrayCondition("roof_types", type)}
                    />
                    <Label htmlFor={`roof-${type}`} className="text-sm capitalize cursor-pointer">
                      {type}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            {/* Insurance */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="is-insurance"
                checked={visibilityConditions.is_insurance === true}
                onCheckedChange={(checked) => 
                  handleVisibilityConditionChange("is_insurance", checked ? true : undefined)
                }
              />
              <Label htmlFor="is-insurance" className="text-sm cursor-pointer">
                Only show for insurance jobs
              </Label>
            </div>

            {/* Has Estimate */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="has-estimate"
                checked={visibilityConditions.has_estimate === true}
                onCheckedChange={(checked) => 
                  handleVisibilityConditionChange("has_estimate", checked ? true : undefined)
                }
              />
              <Label htmlFor="has-estimate" className="text-sm cursor-pointer">
                Only show when estimate exists
              </Label>
            </div>

            <p className="text-xs text-muted-foreground">
              Leave all unchecked to show slide for all conditions
            </p>
          </CollapsibleContent>
        </Collapsible>

        <Separator />

        {/* Presenter Notes */}
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
