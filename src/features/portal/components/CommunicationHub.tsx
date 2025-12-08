import React, { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  MessageCircle, Bot, User, Send, Phone, 
  Loader2, Headphones 
} from 'lucide-react';
import { PortalMessage } from '../hooks/useCustomerPortal';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

interface CommunicationHubProps {
  messages: PortalMessage[];
  onSendMessage: (message: string) => Promise<void>;
  projectId?: string;
  token: string;
}

export function CommunicationHub({ messages, onSendMessage, projectId, token }: CommunicationHubProps) {
  const [inputMessage, setInputMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isAITyping, setIsAITyping] = useState(false);
  const [localMessages, setLocalMessages] = useState<PortalMessage[]>(messages);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLocalMessages(messages);
  }, [messages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [localMessages]);

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || isSending) return;

    const userMessage = inputMessage.trim();
    setInputMessage('');
    setIsSending(true);

    // Add user message immediately
    const tempUserMessage: PortalMessage = {
      id: `temp-${Date.now()}`,
      message: userMessage,
      sender_type: 'customer',
      created_at: new Date().toISOString()
    };
    setLocalMessages(prev => [...prev, tempUserMessage]);

    try {
      // Send to regular message handler
      await onSendMessage(userMessage);

      // Also send to AI for response
      setIsAITyping(true);
      
      const { data: aiResponse } = await supabase.functions.invoke('homeowner-ai-chat', {
        body: {
          message: userMessage,
          project_id: projectId,
          token
        }
      });

      if (aiResponse?.message) {
        const aiMessage: PortalMessage = {
          id: `ai-${Date.now()}`,
          message: aiResponse.message,
          sender_type: 'ai',
          created_at: new Date().toISOString()
        };
        setLocalMessages(prev => [...prev, aiMessage]);
      }
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setIsSending(false);
      setIsAITyping(false);
    }
  };

  const handleRequestLiveRep = async () => {
    setIsSending(true);
    try {
      await onSendMessage('I would like to speak with a live representative.');
      
      const systemMessage: PortalMessage = {
        id: `system-${Date.now()}`,
        message: 'Your request has been submitted. A representative will contact you shortly.',
        sender_type: 'ai',
        created_at: new Date().toISOString()
      };
      setLocalMessages(prev => [...prev, systemMessage]);
    } finally {
      setIsSending(false);
    }
  };

  const handleRequestCallback = async () => {
    setIsSending(true);
    try {
      await onSendMessage('I would like to request a callback.');
      
      const systemMessage: PortalMessage = {
        id: `system-${Date.now()}`,
        message: 'Callback request received! Someone will call you within 24 hours.',
        sender_type: 'ai',
        created_at: new Date().toISOString()
      };
      setLocalMessages(prev => [...prev, systemMessage]);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Card className="flex flex-col h-[500px]">
      <CardHeader className="border-b shrink-0">
        <CardTitle className="flex items-center gap-2 text-lg">
          <MessageCircle className="w-5 h-5 text-primary" />
          Communication Hub
        </CardTitle>
        <div className="flex gap-2 mt-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleRequestLiveRep}
            disabled={isSending}
          >
            <Headphones className="w-4 h-4 mr-2" />
            Live Rep
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleRequestCallback}
            disabled={isSending}
          >
            <Phone className="w-4 h-4 mr-2" />
            Request Callback
          </Button>
        </div>
      </CardHeader>
      
      <CardContent className="flex-1 flex flex-col p-0 overflow-hidden">
        {/* Messages */}
        <ScrollArea className="flex-1 p-4" ref={scrollRef}>
          <div className="space-y-4">
            {/* Welcome message */}
            {localMessages.length === 0 && (
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Bot className="w-4 h-4 text-primary" />
                </div>
                <div className="bg-muted rounded-lg rounded-tl-none p-3 max-w-[80%]">
                  <p className="text-sm">
                    Hi! I'm your AI assistant. I can help answer questions about your project, 
                    provide status updates, or connect you with a live representative.
                  </p>
                </div>
              </div>
            )}

            {localMessages.map((msg) => (
              <div 
                key={msg.id}
                className={cn(
                  "flex items-start gap-3",
                  msg.sender_type === 'customer' && "flex-row-reverse"
                )}
              >
                <div className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                  msg.sender_type === 'customer' ? "bg-primary text-primary-foreground" : "bg-primary/10"
                )}>
                  {msg.sender_type === 'customer' ? (
                    <User className="w-4 h-4" />
                  ) : (
                    <Bot className="w-4 h-4 text-primary" />
                  )}
                </div>
                <div className={cn(
                  "rounded-lg p-3 max-w-[80%]",
                  msg.sender_type === 'customer' 
                    ? "bg-primary text-primary-foreground rounded-tr-none"
                    : "bg-muted rounded-tl-none"
                )}>
                  <p className="text-sm whitespace-pre-wrap">{msg.message}</p>
                  <p className={cn(
                    "text-xs mt-1",
                    msg.sender_type === 'customer' 
                      ? "text-primary-foreground/70"
                      : "text-muted-foreground"
                  )}>
                    {new Date(msg.created_at).toLocaleTimeString([], { 
                      hour: '2-digit', 
                      minute: '2-digit' 
                    })}
                  </p>
                </div>
              </div>
            ))}

            {/* AI Typing Indicator */}
            {isAITyping && (
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Bot className="w-4 h-4 text-primary" />
                </div>
                <div className="bg-muted rounded-lg rounded-tl-none p-3">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Input */}
        <div className="p-4 border-t">
          <div className="flex gap-2">
            <Input
              placeholder="Type your message..."
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
              disabled={isSending}
            />
            <Button 
              onClick={handleSendMessage} 
              disabled={!inputMessage.trim() || isSending}
            >
              {isSending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
