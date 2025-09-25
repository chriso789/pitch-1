import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { default as VoiceInterface } from '@/features/communication/components/VoiceInterface';
import { Send, Mic, Brain, User, Bot, Lightbulb, TrendingUp, AlertTriangle, CheckCircle } from 'lucide-react';

interface Message {
  id: string;
  type: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: any;
  messageType?: 'text' | 'insight' | 'suggestion' | 'alert';
}

interface AIInsight {
  id: string;
  title: string;
  description: string;
  priority: string;
  insight_type: string;
  context_type: string;
  context_id: string;
  created_at: string;
}

interface AIAssistantProps {
  className?: string;
  onNavigate?: (route: string, data?: any) => void;
  currentContext?: {
    type: 'contact' | 'pipeline' | 'project' | 'estimate';
    id: string;
    data?: any;
  };
}

export const AIAssistant: React.FC<AIAssistantProps> = ({
  className = '',
  onNavigate,
  currentContext
}) => {
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [insights, setInsights] = useState<AIInsight[]>([]);
  const [selectedContext, setSelectedContext] = useState("all");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(scrollToBottom, [messages]);

  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    try {
      // Load AI insights
      const { data: insightsData } = await supabase
        .from('ai_insights')
        .select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(10);

      if (insightsData) {
        setInsights(insightsData);
        
        // Add welcome message with insights summary
        addMessage({
          type: 'assistant',
          content: `Hi! I'm your AI sales assistant. I've found ${insightsData.length} insights that might interest you. I can help you with leads, create tasks, navigate the app, analyze your pipeline, and much more. Just tell me what you need!`,
          messageType: 'text'
        });
      }
    } catch (error) {
      console.error('Error loading AI data:', error);
      addMessage({
        type: 'assistant',
        content: "Hi! I'm your AI sales assistant. I can help you with leads, create tasks, navigate the app, analyze your pipeline, and much more. Just tell me what you need!",
      });
    }
  };

  const addMessage = (message: Omit<Message, 'id' | 'timestamp'>) => {
    const newMessage: Message = {
      ...message,
      id: crypto.randomUUID(),
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, newMessage]);
  };

  const processCommand = async (command: string) => {
    setIsLoading(true);
    addMessage({ type: 'user', content: command });

    try {
      const { data, error } = await supabase.functions.invoke('ai-command-processor', {
        body: {
          command,
          context: currentContext,
          conversation_history: messages.slice(-5), // Last 5 messages for context
          selectedContext: selectedContext
        }
      });

      if (error) throw error;

      const response = data.response;
      const actions = data.actions || [];

      // Add AI response
      addMessage({
        type: 'assistant',
        content: response,
        metadata: { actions }
      });

      // Execute any navigation actions
      if (actions.length > 0) {
        for (const action of actions) {
          if (action.type === 'navigate' && onNavigate) {
            onNavigate(action.route, action.data);
          } else if (action.type === 'create_task') {
            await createTask(action.task);
          } else if (action.type === 'create_contact') {
            await createContact(action.contact);
          }
        }
      }

    } catch (error) {
      console.error('Error processing command:', error);
      addMessage({
        type: 'system',
        content: 'Sorry, I encountered an error processing your request. Please try again.'
      });
      toast({
        title: "Error",
        description: "Failed to process your command. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const createTask = async (taskData: any) => {
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user?.user) return;

      const { error } = await supabase.from('tasks').insert({
        tenant_id: user.user.user_metadata?.tenant_id,
        title: taskData.title,
        description: taskData.description,
        priority: taskData.priority || 'medium',
        due_date: taskData.due_date,
        assigned_to: user.user.id,
        ai_generated: true,
        ai_context: taskData,
        created_by: user.user.id
      });

      if (error) throw error;

      toast({
        title: "Task Created",
        description: `Created task: ${taskData.title}`,
      });
    } catch (error) {
      console.error('Error creating task:', error);
    }
  };

  const createContact = async (contactData: any) => {
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user?.user) return;

      const { error } = await supabase.from('contacts').insert({
        tenant_id: user.user.user_metadata?.tenant_id,
        first_name: contactData.first_name,
        last_name: contactData.last_name,
        email: contactData.email,
        phone: contactData.phone,
        address_street: contactData.address,
        company_name: contactData.company,
        type: contactData.type || 'homeowner',
        created_by: user.user.id
      });

      if (error) throw error;

      toast({
        title: "Contact Created",
        description: `Added ${contactData.first_name} ${contactData.last_name} to contacts`,
      });
    } catch (error) {
      console.error('Error creating contact:', error);
    }
  };

  const handleSendMessage = () => {
    if (!inputText.trim()) return;
    processCommand(inputText);
    setInputText('');
  };

  const handleVoiceTranscription = (text: string) => {
    processCommand(text);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <Card className={`flex flex-col h-full ${className}`}>
      <CardHeader className="flex-shrink-0">
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary" />
          AI Sales Assistant
          {currentContext && (
            <span className="text-sm text-muted-foreground ml-2">
              Context: {currentContext.type}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      
      <CardContent className="flex flex-col flex-1 min-h-0">
        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-3 ${
                  message.type === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                <div className={`flex gap-2 max-w-[80%] ${
                  message.type === 'user' ? 'flex-row-reverse' : 'flex-row'
                }`}>
                  <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                    message.type === 'user' 
                      ? 'bg-primary text-primary-foreground' 
                      : message.type === 'assistant'
                      ? 'bg-secondary text-secondary-foreground'
                      : 'bg-muted text-muted-foreground'
                  }`}>
                    {message.type === 'user' ? (
                      <User className="h-4 w-4" />
                    ) : (
                      <Bot className="h-4 w-4" />
                    )}
                  </div>
                  <div className={`rounded-lg px-4 py-2 ${
                    message.type === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted'
                  }`}>
                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                    {message.metadata?.actions && (
                      <div className="mt-2 text-xs opacity-75">
                        Actions executed: {message.metadata.actions.length}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="flex gap-2">
                  <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
                    <Bot className="h-4 w-4 animate-pulse" />
                  </div>
                  <div className="bg-muted rounded-lg px-4 py-2">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 bg-current rounded-full animate-bounce" />
                      <div className="w-2 h-2 bg-current rounded-full animate-bounce delay-100" />
                      <div className="w-2 h-2 bg-current rounded-full animate-bounce delay-200" />
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        <div className="flex gap-2 mt-4">
          <Input
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask me anything... 'Show my leads', 'Create task to call John', etc."
            disabled={isLoading}
            className="flex-1"
          />
          <Button
            onClick={handleSendMessage}
            disabled={!inputText.trim() || isLoading}
            size="icon"
          >
            <Send className="h-4 w-4" />
          </Button>
          <VoiceInterface
            onTranscription={handleVoiceTranscription}
            className="flex-shrink-0"
          />
        </div>
      </CardContent>
    </Card>
  );
};