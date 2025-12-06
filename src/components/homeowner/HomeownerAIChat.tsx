import { useState, useRef, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { 
  MessageSquare, 
  Send, 
  Bot, 
  User, 
  Loader2,
  Phone,
  X,
  Minimize2,
  Maximize2
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  content: string;
  role: 'user' | 'assistant' | 'system';
  timestamp: Date;
  isEscalated?: boolean;
}

interface HomeownerAIChatProps {
  projectId: string;
  contactId: string;
  tenantId: string;
  contactName?: string;
}

export function HomeownerAIChat({ 
  projectId, 
  contactId, 
  tenantId,
  contactName = "there"
}: HomeownerAIChatProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isEscalated, setIsEscalated] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen && messages.length === 0) {
      // Initial greeting
      setMessages([{
        id: '1',
        content: `Hi ${contactName}! 👋 I'm your project assistant. I can help answer questions about your project status, schedule, documents, and more. How can I help you today?`,
        role: 'assistant',
        timestamp: new Date()
      }]);
    }
  }, [isOpen, contactName]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      content: input.trim(),
      role: 'user',
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      // Check for escalation triggers
      const escalationTriggers = [
        'talk to a person',
        'speak to someone',
        'human',
        'real person',
        'representative',
        'manager',
        'complaint'
      ];
      
      const shouldEscalate = escalationTriggers.some(trigger => 
        input.toLowerCase().includes(trigger)
      );

      if (shouldEscalate) {
        await handleEscalation(userMessage.content);
        return;
      }

      // Call AI chat edge function
      const { data, error } = await supabase.functions.invoke('homeowner-ai-chat', {
        body: {
          message: input.trim(),
          projectId,
          contactId,
          tenantId,
          conversationHistory: messages.slice(-10).map(m => ({
            role: m.role,
            content: m.content
          }))
        }
      });

      if (error) throw error;

      const aiResponse: Message = {
        id: Date.now().toString(),
        content: data.response || "I'm sorry, I couldn't process that. Would you like to speak with someone from our team?",
        role: 'assistant',
        timestamp: new Date()
      };

      setMessages(prev => [...prev, aiResponse]);

      // Check if AI suggests escalation
      if (data.shouldEscalate) {
        await handleEscalation(input.trim());
      }

    } catch (error: any) {
      console.error('Chat error:', error);
      const errorMessage: Message = {
        id: Date.now().toString(),
        content: "I'm having trouble connecting right now. Would you like me to have someone from our team reach out to you?",
        role: 'assistant',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEscalation = async (originalMessage: string) => {
    setIsEscalated(true);
    
    try {
      // Create portal message for human follow-up
      await supabase.from('portal_messages').insert({
        tenant_id: tenantId,
        project_id: projectId,
        sender_type: 'homeowner',
        sender_id: contactId,
        recipient_type: 'admin',
        message: `[ESCALATED FROM AI CHAT] ${originalMessage}`,
        is_read: false
      });

      const escalationMessage: Message = {
        id: Date.now().toString(),
        content: "I understand you'd like to speak with someone from our team. I've notified them and someone will get back to you shortly. They typically respond within a few hours during business hours. Is there anything else I can help with in the meantime?",
        role: 'assistant',
        timestamp: new Date(),
        isEscalated: true
      };

      setMessages(prev => [...prev, escalationMessage]);

      toast({
        title: "Team Notified",
        description: "A team member will reach out to you soon",
      });

    } catch (error) {
      console.error('Escalation error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const requestCallback = async () => {
    try {
      await supabase.from('portal_messages').insert({
        tenant_id: tenantId,
        project_id: projectId,
        sender_type: 'homeowner',
        sender_id: contactId,
        recipient_type: 'admin',
        message: '[CALLBACK REQUESTED] Homeowner requested a phone call',
        is_read: false
      });

      toast({
        title: "Callback Requested",
        description: "We'll call you back as soon as possible",
      });

      const callbackMessage: Message = {
        id: Date.now().toString(),
        content: "I've requested a callback for you. Someone from our team will call you soon!",
        role: 'assistant',
        timestamp: new Date()
      };

      setMessages(prev => [...prev, callbackMessage]);
    } catch (error) {
      console.error('Callback request error:', error);
    }
  };

  if (!isOpen) {
    return (
      <Button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg z-50"
        size="icon"
      >
        <MessageSquare className="h-6 w-6" />
      </Button>
    );
  }

  return (
    <div 
      className={cn(
        "fixed bottom-6 right-6 bg-card border rounded-xl shadow-xl z-50 flex flex-col transition-all",
        isMinimized ? "w-80 h-14" : "w-96 h-[500px]"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b bg-primary/5 rounded-t-xl">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
            <Bot className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="font-medium text-sm">Project Assistant</p>
            {!isMinimized && (
              <p className="text-xs text-muted-foreground">
                {isEscalated ? "Team notified" : "Online"}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setIsMinimized(!isMinimized)}
          >
            {isMinimized ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setIsOpen(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {!isMinimized && (
        <>
          {/* Messages */}
          <ScrollArea className="flex-1 p-3" ref={scrollRef}>
            <div className="space-y-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "flex gap-2",
                    message.role === 'user' ? "justify-end" : "justify-start"
                  )}
                >
                  {message.role === 'assistant' && (
                    <Avatar className="h-8 w-8 flex-shrink-0">
                      <AvatarFallback className="bg-primary/10">
                        <Bot className="h-4 w-4 text-primary" />
                      </AvatarFallback>
                    </Avatar>
                  )}
                  <div
                    className={cn(
                      "max-w-[80%] rounded-lg px-3 py-2 text-sm",
                      message.role === 'user' 
                        ? "bg-primary text-primary-foreground" 
                        : "bg-muted",
                      message.isEscalated && "border-l-2 border-yellow-500"
                    )}
                  >
                    {message.content}
                  </div>
                  {message.role === 'user' && (
                    <Avatar className="h-8 w-8 flex-shrink-0">
                      <AvatarFallback className="bg-secondary">
                        <User className="h-4 w-4" />
                      </AvatarFallback>
                    </Avatar>
                  )}
                </div>
              ))}
              {isLoading && (
                <div className="flex gap-2">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-primary/10">
                      <Bot className="h-4 w-4 text-primary" />
                    </AvatarFallback>
                  </Avatar>
                  <div className="bg-muted rounded-lg px-3 py-2">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Quick Actions */}
          <div className="px-3 pb-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={requestCallback}
            >
              <Phone className="h-3 w-3 mr-1" />
              Request a Callback
            </Button>
          </div>

          {/* Input */}
          <div className="p-3 border-t">
            <form 
              onSubmit={(e) => { e.preventDefault(); sendMessage(); }}
              className="flex gap-2"
            >
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type your question..."
                className="flex-1"
                disabled={isLoading}
              />
              <Button type="submit" size="icon" disabled={isLoading || !input.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}