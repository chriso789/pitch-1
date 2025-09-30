import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Search, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { SkipTraceModal } from "./SkipTraceModal";

interface SkipTraceButtonProps {
  contactId: string;
  onComplete?: () => void;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
}

export const SkipTraceButton = ({ 
  contactId, 
  onComplete,
  variant = "outline",
  size = "default"
}: SkipTraceButtonProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const { toast } = useToast();

  const handleSkipTrace = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('skip-trace-lookup', {
        body: { contact_id: contactId }
      });

      if (error) throw error;

      if (data.success) {
        toast({
          title: "Skip Trace Complete",
          description: data.message,
        });
        setShowModal(true);
        onComplete?.();
      } else {
        throw new Error(data.error || 'Skip trace failed');
      }
    } catch (error) {
      console.error('Skip trace error:', error);
      toast({
        title: "Skip Trace Failed",
        description: error instanceof Error ? error.message : "Failed to perform skip trace",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={handleSkipTrace}
        disabled={isLoading}
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Search className="h-4 w-4" />
        )}
        <span className="ml-2">Skip Trace</span>
      </Button>

      {showModal && (
        <SkipTraceModal
          contactId={contactId}
          open={showModal}
          onOpenChange={setShowModal}
        />
      )}
    </>
  );
};
