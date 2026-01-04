import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, Sparkles } from "lucide-react";
import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { PresentationCard } from "@/components/presentations/PresentationCard";
import { useToast } from "@/components/ui/use-toast";
import { AIGenerationDialog } from "@/components/presentations/AIGenerationDialog";
import { useGeneratePresentation } from "@/hooks/useGeneratePresentation";

const PresentationsPage = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [showAIDialog, setShowAIDialog] = useState(false);
  const { generatePresentation, isGenerating } = useGeneratePresentation();

  const { data: presentations, isLoading, refetch } = useQuery({
    queryKey: ["presentations", activeTab],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: profile } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("id", user.id)
        .single();

      const query = supabase
        .from("presentations")
        .select("*")
        .eq("tenant_id", profile.tenant_id)
        .order("created_at", { ascending: false });

      if (activeTab === "templates") {
        query.eq("is_template", true);
      } else if (activeTab === "mine") {
        query.eq("is_template", false).eq("created_by", user.id);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const handleCreatePresentation = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: profile } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("id", user.id)
        .single();

      const { data, error } = await supabase
        .from("presentations")
        .insert({
          tenant_id: profile.tenant_id,
          name: "Untitled Presentation",
          description: "",
          template_type: "custom",
          is_template: false,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;

      toast({
        title: "Presentation created",
        description: "Your new presentation is ready to edit.",
      });

      navigate(`/presentations/${data.id}/edit`);
    } catch (error: any) {
      console.error("Error creating presentation:", error);
      toast({
        title: "Failed to create presentation",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const filteredPresentations = presentations?.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleAIGenerate = async (templateId: string, mode: 'auto' | 'semi', pipelineEntryId?: string) => {
    if (!pipelineEntryId) {
      // No project selected - just close dialog and suggest creating blank
      toast({
        title: "No project selected",
        description: "Creating a blank presentation instead. You can add project data later.",
      });
      setShowAIDialog(false);
      handleCreatePresentation();
      return;
    }
    
    // Generate presentation with AI
    const result = await generatePresentation({
      pipelineEntryId,
      templateId,
      mode,
    });
    
    if (result.success) {
      setShowAIDialog(false);
    }
  };

  return (
    <GlobalLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Presentations</h1>
            <p className="text-muted-foreground">
              Create and manage sales presentations
            </p>
          </div>
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              onClick={() => setShowAIDialog(true)} 
              className="gap-2"
            >
              <Sparkles className="h-4 w-4" />
              AI Generate
            </Button>
            <Button onClick={handleCreatePresentation} className="gap-2">
              <Plus className="h-4 w-4" />
              Create Blank
            </Button>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search presentations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="all">All Presentations</TabsTrigger>
            <TabsTrigger value="mine">My Presentations</TabsTrigger>
            <TabsTrigger value="templates">Templates</TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab} className="mt-6">
            {isLoading ? (
              <div className="text-center py-12 text-muted-foreground">
                Loading presentations...
              </div>
            ) : filteredPresentations?.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground mb-4">
                  No presentations found
                </p>
                <Button onClick={handleCreatePresentation} variant="outline">
                  <Plus className="h-4 w-4 mr-2" />
                  Create Your First Presentation
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredPresentations?.map((presentation) => (
                  <PresentationCard
                    key={presentation.id}
                    presentation={presentation}
                    onRefetch={refetch}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <AIGenerationDialog
        open={showAIDialog}
        onOpenChange={setShowAIDialog}
        onGenerate={handleAIGenerate}
        isGenerating={isGenerating}
      />
    </GlobalLayout>
  );
};

export default PresentationsPage;
