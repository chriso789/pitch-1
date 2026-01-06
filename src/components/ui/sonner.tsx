import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";
import { useState } from "react";
import { Bot } from "lucide-react";
import { AIFixModal } from "@/components/error/AIFixModal";

type ToasterProps = React.ComponentProps<typeof Sonner>;

// Store for tracking error details for AI analysis
let pendingErrorForAI: {
  message: string;
  type?: string;
  metadata?: Record<string, any>;
} | null = null;

// Function to set error details when showing error toast
export function setErrorForAIAnalysis(errorDetails: {
  message: string;
  type?: string;
  metadata?: Record<string, any>;
}) {
  pendingErrorForAI = errorDetails;
}

// Function to get and clear pending error
export function getPendingErrorForAI() {
  const error = pendingErrorForAI;
  pendingErrorForAI = null;
  return error;
}

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [currentError, setCurrentError] = useState<{
    message: string;
    type?: string;
    metadata?: Record<string, any>;
  } | null>(null);

  const handleAIFix = (message: string) => {
    // Check if we have detailed error info
    const detailedError = getPendingErrorForAI();
    setCurrentError(detailedError || { message });
    setAiModalOpen(true);
  };

  return (
    <>
      <Sonner
        theme={theme as ToasterProps["theme"]}
        className="toaster group"
        toastOptions={{
          classNames: {
            toast:
              "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
            description: "group-[.toast]:text-muted-foreground",
            actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
            cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
            error: "group-[.toaster]:bg-destructive group-[.toaster]:text-destructive-foreground group-[.toaster]:border-destructive",
          },
        }}
        {...props}
      />
      
      {currentError && (
        <AIFixModal
          open={aiModalOpen}
          onOpenChange={setAiModalOpen}
          errorMessage={currentError.message}
          errorType={currentError.type}
          metadata={currentError.metadata}
        />
      )}
    </>
  );
};

// Enhanced error toast with AI Fix button
export function showErrorWithAIFix(
  message: string, 
  options?: {
    description?: string;
    type?: string;
    metadata?: Record<string, any>;
  }
) {
  // Store error details for AI analysis
  setErrorForAIAnalysis({
    message: options?.description || message,
    type: options?.type,
    metadata: options?.metadata
  });

  toast.error(message, {
    description: options?.description,
    action: {
      label: "AI Fix",
      onClick: () => {
        // Trigger the AI analysis
        const event = new CustomEvent('ai-fix-requested', { 
          detail: { 
            message: options?.description || message,
            type: options?.type,
            metadata: options?.metadata
          } 
        });
        window.dispatchEvent(event);
      }
    },
    duration: 10000, // Keep visible longer for error toasts
  });
}

export { Toaster, toast };
