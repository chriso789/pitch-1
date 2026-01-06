import { useEffect, useState } from "react";
import { AIFixModal } from "./AIFixModal";

interface ErrorDetail {
  message: string;
  type?: string;
  metadata?: Record<string, any>;
}

export function AIFixProvider({ children }: { children: React.ReactNode }) {
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [currentError, setCurrentError] = useState<ErrorDetail | null>(null);

  useEffect(() => {
    const handleAIFixRequest = (event: CustomEvent<ErrorDetail>) => {
      setCurrentError(event.detail);
      setAiModalOpen(true);
    };

    window.addEventListener('ai-fix-requested', handleAIFixRequest as EventListener);
    
    return () => {
      window.removeEventListener('ai-fix-requested', handleAIFixRequest as EventListener);
    };
  }, []);

  return (
    <>
      {children}
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
}
