import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { 
  Mic, 
  MicOff, 
  Send, 
  Bot, 
  User, 
  Loader2,
  Phone,
  FileText,
  BarChart3,
  UserPlus,
  CheckSquare,
  Sparkles
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actions?: any[];
  executedActions?: any[];
  timestamp: Date;
}

interface DashboardAIAssistantProps {
  className?: string;
}

export const DashboardAIAssistant: React.FC<DashboardAIAssistantProps> = ({ className }) => {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  
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

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Handle transcript completion
  useEffect(() => {
    if (transcript && !isListening) {
      setInputValue(transcript);
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

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: messageText,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
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

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.response || "I'm not sure how to help with that.",
        actions: data.actions,
        executedActions: data.executedActions,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
      
      if (data.sessionId) {
        setSessionId(data.sessionId);
      }

      // Handle navigation actions
      const navAction = data.actions?.find((a: any) => a.action === 'navigate');
      if (navAction?.path) {
        toast.info(`Navigating to ${navAction.path}...`);
        setTimeout(() => navigate(navAction.path), 1000);
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
      toast.error('Failed to get response from AI assistant');
      
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: "I'm having trouble connecting right now. Please try again.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleMicClick = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const quickCommands = [
    { icon: Phone, label: 'Call Lead', command: 'Show me leads to call today' },
    { icon: UserPlus, label: 'Add Contact', command: 'Add a new contact' },
    { icon: CheckSquare, label: 'My Tasks', command: 'Show my tasks' },
    { icon: BarChart3, label: 'Pipeline', command: 'Go to pipeline' },
  ];

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="pb-3 bg-gradient-to-r from-primary/10 to-primary/5">
        <CardTitle className="flex items-center gap-2 text-lg">
          <div className="p-2 rounded-lg bg-primary/20">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          <span>PITCH AI Assistant</span>
          <Badge variant="secondary" className="ml-auto">
            <Sparkles className="h-3 w-3 mr-1" />
            Beta
          </Badge>
        </CardTitle>
      </CardHeader>
      
      <CardContent className="p-0">
        {/* Messages Area */}
        <ScrollArea 
          ref={scrollRef}
          className="h-[280px] p-4"
        >
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
              <Bot className="h-12 w-12 mb-3 opacity-50" />
              <p className="text-sm font-medium">Hi! I'm your AI assistant.</p>
              <p className="text-xs mt-1">Ask me anything or use voice commands.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    "flex gap-3",
                    msg.role === 'user' ? 'justify-end' : 'justify-start'
                  )}
                >
                  {msg.role === 'assistant' && (
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                      <Bot className="h-4 w-4 text-primary" />
                    </div>
                  )}
                  <div
                    className={cn(
                      "max-w-[80%] rounded-lg px-3 py-2 text-sm",
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted'
                    )}
                  >
                    {msg.content}
                    {msg.executedActions && msg.executedActions.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-border/50">
                        {msg.executedActions.map((action, idx) => (
                          <Badge key={idx} variant="outline" className="text-xs mr-1">
                            ✓ {action.type.replace('_', ' ')}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  {msg.role === 'user' && (
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
                      <User className="h-4 w-4" />
                    </div>
                  )}
                </div>
              ))}
              {isLoading && (
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                    <Bot className="h-4 w-4 text-primary" />
                  </div>
                  <div className="bg-muted rounded-lg px-3 py-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                </div>
              )}
            </div>
          )}
        </ScrollArea>

        {/* Quick Commands */}
        <div className="px-4 py-2 border-t border-border/50 bg-muted/30">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {quickCommands.map((cmd) => (
              <Button
                key={cmd.label}
                variant="outline"
                size="sm"
                className="flex-shrink-0 text-xs h-7"
                onClick={() => handleSend(cmd.command)}
                disabled={isLoading}
              >
                <cmd.icon className="h-3 w-3 mr-1" />
                {cmd.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Input Area */}
        <div className="p-4 border-t">
          {/* Interim transcript display */}
          {(isListening || interimTranscript) && (
            <div className="mb-2 p-2 bg-primary/10 rounded-lg text-sm text-muted-foreground flex items-center gap-2">
              <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              <span>{interimTranscript || 'Listening...'}</span>
            </div>
          )}
          
          <div className="flex gap-2">
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type or speak a command..."
              disabled={isLoading || isListening}
              className="flex-1"
            />
            
            {isSpeechSupported && (
              <Button
                variant={isListening ? "destructive" : "outline"}
                size="icon"
                onClick={handleMicClick}
                disabled={isLoading}
                className={cn(isListening && "animate-pulse")}
              >
                {isListening ? (
                  <MicOff className="h-4 w-4" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
              </Button>
            )}
            
            <Button
              onClick={() => handleSend()}
              disabled={!inputValue.trim() || isLoading}
              size="icon"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default DashboardAIAssistant;
