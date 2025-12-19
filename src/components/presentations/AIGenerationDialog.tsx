import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, Wand2, PenTool, Building2, Home, Wrench } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface AIGenerationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerate: (templateId: string, mode: 'auto' | 'semi') => void;
  isGenerating?: boolean;
  pipelineEntryId?: string;
}

interface PresentationTemplate {
  id: string;
  name: string;
  description: string;
  vertical: string;
  slide_count: number;
  is_system: boolean;
}

const verticalIcons: Record<string, React.ReactNode> = {
  residential_roofing: <Home className="h-5 w-5" />,
  commercial_roofing: <Building2 className="h-5 w-5" />,
  home_services: <Wrench className="h-5 w-5" />,
};

const verticalLabels: Record<string, string> = {
  residential_roofing: "Residential Roofing",
  commercial_roofing: "Commercial Roofing",
  home_services: "Home Services",
};

export function AIGenerationDialog({
  open,
  onOpenChange,
  onGenerate,
  isGenerating = false,
  pipelineEntryId,
}: AIGenerationDialogProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [mode, setMode] = useState<'auto' | 'semi'>('auto');

  const { data: templates, isLoading } = useQuery({
    queryKey: ["presentation-templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("presentation_templates")
        .select("*")
        .eq("is_active", true)
        .order("name");
      
      if (error) throw error;
      return data as PresentationTemplate[];
    },
    enabled: open,
  });

  const handleGenerate = () => {
    if (selectedTemplate) {
      onGenerate(selectedTemplate, mode);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            AI Presentation Generator
          </DialogTitle>
          <DialogDescription>
            Select a template and generation mode to create your sales presentation
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4 flex-1 overflow-y-auto min-h-0">
          {/* Template Selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Choose Template</Label>
            {isLoading ? (
              <div className="text-sm text-muted-foreground">Loading templates...</div>
            ) : (
              <ScrollArea className="h-[200px] pr-4">
                <div className="space-y-2">
                  {templates?.map((template) => (
                    <div
                      key={template.id}
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                        selectedTemplate === template.id
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50 hover:bg-muted/50"
                      )}
                      onClick={() => setSelectedTemplate(template.id)}
                    >
                      <div className={cn(
                        "p-2 rounded-md",
                        selectedTemplate === template.id ? "bg-primary/10 text-primary" : "bg-muted"
                      )}>
                        {verticalIcons[template.vertical] || <Building2 className="h-5 w-5" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">{template.name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {template.description || verticalLabels[template.vertical]}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {template.slide_count} slides
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>

          {/* Generation Mode */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Generation Mode</Label>
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as 'auto' | 'semi')}>
              <div className="grid grid-cols-2 gap-3">
                <label
                  className={cn(
                    "flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                    mode === 'auto'
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  )}
                >
                  <RadioGroupItem value="auto" className="mt-1" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Wand2 className="h-4 w-4 text-primary" />
                      <span className="font-medium text-sm">Fully Auto</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      AI generates all content automatically. Ready to send in minutes.
                    </p>
                  </div>
                </label>
                
                <label
                  className={cn(
                    "flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                    mode === 'semi'
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  )}
                >
                  <RadioGroupItem value="semi" className="mt-1" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <PenTool className="h-4 w-4 text-primary" />
                      <span className="font-medium text-sm">Semi-Custom</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      AI fills data, you customize content before finalizing.
                    </p>
                  </div>
                </label>
              </div>
            </RadioGroup>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isGenerating}>
            Cancel
          </Button>
          <Button 
            onClick={handleGenerate} 
            disabled={!selectedTemplate || isGenerating}
            className="gap-2"
          >
            {isGenerating ? (
              <>
                <Sparkles className="h-4 w-4 animate-pulse" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Generate Presentation
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
