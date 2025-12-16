import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";

interface GeneratePresentationOptions {
  pipelineEntryId: string;
  templateId: string;
  mode: 'auto' | 'semi';
  presentationName?: string;
}

interface GenerationResult {
  success: boolean;
  presentation_id?: string;
  slides_count?: number;
  missing_data?: string[];
  error?: string;
}

export function useGeneratePresentation() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<string>('');
  const navigate = useNavigate();
  const { toast } = useToast();

  const generatePresentation = async (options: GeneratePresentationOptions): Promise<GenerationResult> => {
    setIsGenerating(true);
    setGenerationStatus('generating');
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Not authenticated');
      }

      const response = await supabase.functions.invoke('generate-presentation', {
        body: {
          pipeline_entry_id: options.pipelineEntryId,
          template_id: options.templateId,
          mode: options.mode,
          presentation_name: options.presentationName,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || 'Generation failed');
      }

      const result = response.data as GenerationResult;
      
      if (result.success && result.presentation_id) {
        setGenerationStatus('completed');
        
        toast({
          title: "Presentation generated!",
          description: `Created ${result.slides_count} slides${result.missing_data?.length ? ` (${result.missing_data.length} fields need attention)` : ''}`,
        });

        // Navigate to edit the presentation
        setTimeout(() => {
          navigate(`/presentations/${result.presentation_id}/edit`);
        }, 1000);
        
        return result;
      } else {
        throw new Error(result.error || 'Generation failed');
      }
    } catch (error: any) {
      console.error('Generation error:', error);
      setGenerationStatus('error');
      
      toast({
        title: "Generation failed",
        description: error.message || "Failed to generate presentation",
        variant: "destructive",
      });
      
      return { success: false, error: error.message };
    } finally {
      setIsGenerating(false);
    }
  };

  // Subscribe to real-time status updates
  const subscribeToStatus = (presentationId: string, onStatusChange: (status: string) => void) => {
    const channel = supabase
      .channel(`presentation-${presentationId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'presentations',
          filter: `id=eq.${presentationId}`,
        },
        (payload) => {
          const newStatus = payload.new.generation_status;
          if (newStatus) {
            setGenerationStatus(newStatus);
            onStatusChange(newStatus);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  return {
    generatePresentation,
    subscribeToStatus,
    isGenerating,
    generationStatus,
  };
}
