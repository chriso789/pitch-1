import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, Wand2, PenTool, Building2, Home, Wrench, Search, ChevronLeft, ChevronRight, MapPin, User } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface AIGenerationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerate: (templateId: string, mode: 'auto' | 'semi', pipelineEntryId?: string) => void;
  isGenerating?: boolean;
}

interface PresentationTemplate {
  id: string;
  name: string;
  description: string;
  vertical: string;
  slide_count: number;
  is_system: boolean;
}

interface PipelineEntry {
  id: string;
  status: string | null;
  created_at: string;
  contacts: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    address_street: string | null;
    address_city: string | null;
    address_state: string | null;
  } | null;
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

type Step = 'project' | 'template' | 'mode';

export function AIGenerationDialog({
  open,
  onOpenChange,
  onGenerate,
  isGenerating = false,
}: AIGenerationDialogProps) {
  const [step, setStep] = useState<Step>('project');
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [mode, setMode] = useState<'auto' | 'semi'>('auto');
  const [projectSearch, setProjectSearch] = useState("");

  // Fetch pipeline entries (projects/leads)
  const { data: projects, isLoading: projectsLoading } = useQuery({
    queryKey: ["pipeline-entries-for-presentation"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: profile } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("id", user.id)
        .single();

      const { data, error } = await supabase
        .from("pipeline_entries")
        .select("id, status, created_at, contacts(id, first_name, last_name, address_street, address_city, address_state)")
        .eq("tenant_id", profile?.tenant_id)
        .order("created_at", { ascending: false })
        .limit(50);
      
      if (error) throw error;
      return data as PipelineEntry[];
    },
    enabled: open,
  });

  // Fetch presentation templates
  const { data: templates, isLoading: templatesLoading } = useQuery({
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
    enabled: open && step !== 'project',
  });

  const filteredProjects = projects?.filter(project => {
    const contact = project.contacts;
    if (!contact) return false;
    const searchLower = projectSearch.toLowerCase();
    const fullName = `${contact.first_name || ''} ${contact.last_name || ''}`.toLowerCase();
    const address = `${contact.address_street || ''} ${contact.address_city || ''} ${contact.address_state || ''}`.toLowerCase();
    return fullName.includes(searchLower) || address.includes(searchLower);
  });

  const handleGenerate = () => {
    if (selectedTemplate) {
      onGenerate(selectedTemplate, mode, selectedProject || undefined);
    }
  };

  const handleNext = () => {
    if (step === 'project') setStep('template');
    else if (step === 'template') setStep('mode');
  };

  const handleBack = () => {
    if (step === 'template') setStep('project');
    else if (step === 'mode') setStep('template');
  };

  const canProceed = () => {
    if (step === 'project') return true; // Project selection is optional
    if (step === 'template') return !!selectedTemplate;
    if (step === 'mode') return true;
    return false;
  };

  const resetDialog = () => {
    setStep('project');
    setSelectedProject("");
    setSelectedTemplate("");
    setMode('auto');
    setProjectSearch("");
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) resetDialog();
    onOpenChange(newOpen);
  };

  const selectedProjectData = projects?.find(p => p.id === selectedProject);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            AI Presentation Generator
          </DialogTitle>
          <DialogDescription>
            {step === 'project' && "Select a project/lead to generate a personalized presentation"}
            {step === 'template' && "Choose a template for your presentation"}
            {step === 'mode' && "Select how you want to generate content"}
          </DialogDescription>
        </DialogHeader>

        {/* Step Indicator */}
        <div className="flex items-center justify-center gap-2 py-2">
          {['project', 'template', 'mode'].map((s, i) => (
            <div key={s} className="flex items-center">
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors",
                step === s ? "bg-primary text-primary-foreground" :
                ['project', 'template', 'mode'].indexOf(step) > i ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
              )}>
                {i + 1}
              </div>
              {i < 2 && <div className={cn("w-12 h-0.5 mx-1", ['project', 'template', 'mode'].indexOf(step) > i ? "bg-primary/50" : "bg-muted")} />}
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 py-4">
          {/* Step 1: Project Selection */}
          {step === 'project' && (
            <div className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or address..."
                  value={projectSearch}
                  onChange={(e) => setProjectSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
              
              {projectsLoading ? (
                <div className="text-sm text-muted-foreground text-center py-8">Loading projects...</div>
              ) : (
                <ScrollArea className="h-[280px] pr-4">
                  <div className="space-y-2">
                    {/* Skip option */}
                    <div
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                        !selectedProject
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50 hover:bg-muted/50"
                      )}
                      onClick={() => setSelectedProject("")}
                    >
                      <div className="flex-1">
                        <div className="font-medium text-sm">Create without project data</div>
                        <div className="text-xs text-muted-foreground">
                          Generate a blank presentation template
                        </div>
                      </div>
                    </div>
                    
                    {filteredProjects?.map((project) => (
                      <div
                        key={project.id}
                        className={cn(
                          "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                          selectedProject === project.id
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/50 hover:bg-muted/50"
                        )}
                        onClick={() => setSelectedProject(project.id)}
                      >
                        <div className="p-2 rounded-md bg-muted">
                          <User className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm">
                            {project.contacts?.first_name} {project.contacts?.last_name}
                          </div>
                          {project.contacts?.address_street && (
                            <div className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                              <MapPin className="h-3 w-3 flex-shrink-0" />
                              {project.contacts.address_street}, {project.contacts.address_city}
                            </div>
                          )}
                        </div>
                        <div className="text-xs px-2 py-1 rounded bg-muted capitalize">
                          {project.status?.replace(/_/g, ' ') || 'New'}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          )}

          {/* Step 2: Template Selection */}
          {step === 'template' && (
            <div className="space-y-3">
              <Label className="text-sm font-medium">Choose Template</Label>
              {templatesLoading ? (
                <div className="text-sm text-muted-foreground">Loading templates...</div>
              ) : !templates?.length ? (
                <div className="text-sm text-muted-foreground text-center py-8">
                  No templates available. Please create a template first.
                </div>
              ) : (
                <ScrollArea className="h-[280px] pr-4">
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
          )}

          {/* Step 3: Generation Mode */}
          {step === 'mode' && (
            <div className="space-y-4">
              {selectedProjectData && (
                <div className="p-3 rounded-lg bg-muted/50 border text-sm">
                  <div className="font-medium">
                    Generating for: {selectedProjectData.contacts?.first_name} {selectedProjectData.contacts?.last_name}
                  </div>
                  {selectedProjectData.contacts?.address_street && (
                    <div className="text-muted-foreground text-xs mt-1">
                      {selectedProjectData.contacts.address_street}, {selectedProjectData.contacts.address_city}, {selectedProjectData.contacts.address_state}
                    </div>
                  )}
                </div>
              )}
              
              <div className="space-y-3">
                <Label className="text-sm font-medium">Generation Mode</Label>
                <RadioGroup value={mode} onValueChange={(v) => setMode(v as 'auto' | 'semi')}>
                  <div className="grid grid-cols-1 gap-3">
                    <label
                      className={cn(
                        "flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors",
                        mode === 'auto'
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50"
                      )}
                    >
                      <RadioGroupItem value="auto" className="mt-1" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Wand2 className="h-4 w-4 text-primary" />
                          <span className="font-medium">Fully Automatic</span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          AI generates all content automatically using project data. Ready to send in minutes.
                        </p>
                      </div>
                    </label>
                    
                    <label
                      className={cn(
                        "flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors",
                        mode === 'semi'
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50"
                      )}
                    >
                      <RadioGroupItem value="semi" className="mt-1" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <PenTool className="h-4 w-4 text-primary" />
                          <span className="font-medium">Semi-Custom</span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          AI fills in data fields, you customize the content before finalizing.
                        </p>
                      </div>
                    </label>
                  </div>
                </RadioGroup>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-between gap-3 pt-4 border-t">
          <div>
            {step !== 'project' && (
              <Button variant="outline" onClick={handleBack} disabled={isGenerating}>
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
            )}
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isGenerating}>
              Cancel
            </Button>
            {step !== 'mode' ? (
              <Button onClick={handleNext} disabled={!canProceed()}>
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
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
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
