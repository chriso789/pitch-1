import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { 
  Mic, 
  X, 
  Send, 
  Loader2,
  Keyboard
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface DashboardAIAssistantProps {
  className?: string;
}

export const DashboardAIAssistant: React.FC<DashboardAIAssistantProps> = ({ className }) => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [showTextInput, setShowTextInput] = useState(false);
  const [inputValue, setInputValue] = useState('');
  
  const {
    isListening,
    transcript,
    interimTranscript,
    isSupported: isSpeechSupported,
    startListening,
    stopListening,
    resetTranscript,
    error: speechError,
  } = useSpeechRecognition({ continuous: false, interimResults: true });

  // Handle transcript completion
  useEffect(() => {
    if (transcript && !isListening) {
      handleSend(transcript);
      resetTranscript();
    }
  }, [transcript, isListening]);

  // Show speech errors
  useEffect(() => {
    if (speechError) {
      toast.error(speechError);
    }
  }, [speechError]);

  const handleSend = async (text?: string) => {
    const messageText = text || inputValue.trim();
    if (!messageText || isLoading) return;

    setInputValue('');
    setShowTextInput(false);
    setIsLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('crm-ai-agent', {
        body: {
          message: messageText,
          sessionId,
          context: {
            currentPage: window.location.pathname,
          },
        },
      });

      if (error) throw error;

      // Show response as toast
      if (data.response) {
        toast.success(data.response, {
          duration: 6000,
          action: data.actions?.find((a: any) => a.action === 'navigate') ? {
            label: 'Go',
            onClick: () => {
              const navAction = data.actions?.find((a: any) => a.action === 'navigate');
              if (navAction?.path) navigate(navAction.path);
            }
          } : undefined
        });
      }
      
      if (data.sessionId) {
        setSessionId(data.sessionId);
      }

      // Handle navigation actions
      const navAction = data.actions?.find((a: any) => a.action === 'navigate');
      if (navAction?.path) {
        setTimeout(() => navigate(navAction.path), 1500);
      }

      // Show executed actions
      if (data.executedActions?.length > 0) {
        data.executedActions.forEach((action: any) => {
          if (action.type === 'contact_created') {
            toast.success(`Contact "${action.name}" created!`);
          } else if (action.type === 'task_created') {
            toast.success(`Task "${action.title}" created!`);
          }
        });
      }

    } catch (err) {
      console.error('AI Assistant error:', err);
      toast.error('Failed to connect. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOrbClick = () => {
    if (isLoading) return;
    
    if (isListening) {
      stopListening();
    } else if (isSpeechSupported) {
      startListening();
    } else {
      setShowTextInput(true);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape') {
      setShowTextInput(false);
    }
  };

  return (
    <div className={cn("fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3", className)}>
      {/* Transcript/Status Popup */}
      {(isListening || interimTranscript || isLoading) && (
        <div className="animate-fade-in bg-card border border-border rounded-2xl px-4 py-3 shadow-lg max-w-xs">
          <div className="flex items-center gap-2">
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">Thinking...</span>
              </>
            ) : (
              <>
                <div className="w-2 h-2 bg-destructive rounded-full animate-pulse" />
                <span className="text-sm">
                  {interimTranscript || 'Listening...'}
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Text Input Panel */}
      {showTextInput && !isListening && (
        <div className="animate-fade-in bg-card border border-border rounded-2xl p-3 shadow-lg w-72">
          <div className="flex gap-2">
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="Type a command..."
              className="flex-1 text-sm"
              autoFocus
            />
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setShowTextInput(false)}
              className="h-9 w-9"
            >
              <X className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              onClick={() => handleSend()}
              disabled={!inputValue.trim() || isLoading}
              className="h-9 w-9"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Main Orb Container */}
      <div className="relative">
        {/* Pulsing Rings */}
        {isListening && (
          <>
            <div className="absolute inset-0 rounded-full bg-primary/30 animate-ping" />
            <div className="absolute -inset-2 rounded-full bg-primary/20 animate-pulse" />
          </>
        )}

        {/* Main Orb Button */}
        <button
          onClick={handleOrbClick}
          disabled={isLoading}
          className={cn(
            "relative w-16 h-16 rounded-full shadow-lg transition-all duration-300",
            "bg-gradient-to-br from-primary to-primary/80",
            "hover:shadow-xl hover:scale-105 active:scale-95",
            "flex items-center justify-center",
            "focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2",
            isListening && "ring-2 ring-destructive ring-offset-2",
            isLoading && "opacity-80 cursor-wait"
          )}
        >
          {isLoading ? (
            <Loader2 className="h-7 w-7 text-primary-foreground animate-spin" />
          ) : isListening ? (
            <Mic className="h-7 w-7 text-primary-foreground animate-pulse" />
          ) : (
            <span className="text-2xl font-bold text-primary-foreground tracking-tight">P</span>
          )}
        </button>

        {/* Keyboard Toggle */}
        {!isListening && !isLoading && isSpeechSupported && (
          <button
            onClick={() => setShowTextInput(!showTextInput)}
            className={cn(
              "absolute -left-2 -bottom-1 w-7 h-7 rounded-full",
              "bg-muted border border-border shadow-sm",
              "flex items-center justify-center",
              "hover:bg-accent transition-colors",
              "focus:outline-none focus:ring-1 focus:ring-primary/50"
            )}
          >
            <Keyboard className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        )}
      </div>
    </div>
  );
};

export default DashboardAIAssistant;
