import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Bot, 
  MessageSquare, 
  Phone, 
  Settings, 
  Plus, 
  Trash2, 
  Save,
  Mic,
  Clock,
  ArrowLeft
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';

interface FAQ {
  id: string;
  question: string;
  answer: string;
  isActive: boolean;
  order: number;
}

interface AIConfig {
  is_enabled: boolean;
  greeting_text: string;
  after_hours_greeting: string;
  ai_voice: string;
  ai_model: string;
  temperature: number;
  escalation_keywords: string[];
  business_hours: {
    start: string;
    end: string;
    days: string[];
  };
}

const VOICE_OPTIONS = [
  { value: 'en-US-Wavenet-D', label: 'Male (Professional)' },
  { value: 'en-US-Wavenet-C', label: 'Female (Professional)' },
  { value: 'en-US-Wavenet-A', label: 'Male (Casual)' },
  { value: 'en-US-Wavenet-E', label: 'Female (Casual)' },
];

export default function AIAgentSettingsPage() {
  const { profile } = useUserProfile();
  const tenantId = profile?.tenant_id;
  const { toast } = useToast();
  const navigate = useNavigate();

  const [config, setConfig] = useState<AIConfig>({
    is_enabled: false,
    greeting_text: "Hi, thanks for calling! I'm here to help you with your roofing needs.",
    after_hours_greeting: "Thanks for calling! Our office is currently closed.",
    ai_voice: 'en-US-Wavenet-D',
    ai_model: 'gpt-4',
    temperature: 0.3,
    escalation_keywords: ['manager', 'supervisor', 'human', 'person', 'representative'],
    business_hours: {
      start: '08:00',
      end: '18:00',
      days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    },
  });

  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [newFaq, setNewFaq] = useState({ question: '', answer: '' });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (tenantId) {
      loadConfig();
      loadFAQs();
    }
  }, [tenantId]);

  const loadConfig = async () => {
    const { data } = await supabase
      .from('ai_answering_config')
      .select('*')
      .eq('tenant_id', tenantId)
      .single();

    if (data) {
      setConfig({
        is_enabled: data.is_enabled || false,
        greeting_text: data.greeting_text || config.greeting_text,
        after_hours_greeting: data.after_hours_greeting || config.after_hours_greeting,
        ai_voice: data.ai_voice || config.ai_voice,
        ai_model: data.ai_model || config.ai_model,
        temperature: data.temperature || config.temperature,
        escalation_keywords: data.escalation_keywords || config.escalation_keywords,
        business_hours: (data.business_hours as any) || config.business_hours,
      });
    }
  };

  const loadFAQs = async () => {
    // Load FAQs from app_settings table (user-level settings)
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    
    const { data } = await supabase
      .from('app_settings')
      .select('setting_value')
      .eq('tenant_id', tenantId)
      .eq('user_id', userData.user.id)
      .eq('setting_key', 'ai_agent_faqs')
      .single();

    if (data?.setting_value) {
      setFaqs(data.setting_value as unknown as FAQ[]);
    }
  };

  const saveConfig = async () => {
    setIsSaving(true);
    try {
      // Save main config
      const { error: configError } = await supabase
        .from('ai_answering_config')
        .upsert({
          tenant_id: tenantId,
          is_enabled: config.is_enabled,
          greeting_text: config.greeting_text,
          after_hours_greeting: config.after_hours_greeting,
          ai_voice: config.ai_voice,
          ai_model: config.ai_model,
          temperature: config.temperature,
          escalation_keywords: config.escalation_keywords,
          business_hours: config.business_hours,
        }, {
          onConflict: 'tenant_id',
        });

      if (configError) throw configError;

      // Save FAQs
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error('Not authenticated');
      
      const { error: faqError } = await supabase
        .from('app_settings')
        .upsert({
          tenant_id: tenantId,
          user_id: userData.user.id,
          setting_key: 'ai_agent_faqs',
          setting_value: faqs as any,
        }, {
          onConflict: 'tenant_id,user_id,setting_key',
        });

      if (faqError) throw faqError;

      toast({
        title: 'Settings Saved',
        description: 'AI Agent configuration updated successfully',
      });
    } catch (err) {
      console.error('Error saving config:', err);
      toast({
        title: 'Error',
        description: 'Failed to save settings',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const addFAQ = () => {
    if (!newFaq.question.trim() || !newFaq.answer.trim()) return;

    setFaqs([
      ...faqs,
      {
        id: crypto.randomUUID(),
        question: newFaq.question,
        answer: newFaq.answer,
        isActive: true,
        order: faqs.length,
      },
    ]);
    setNewFaq({ question: '', answer: '' });
  };

  const removeFAQ = (id: string) => {
    setFaqs(faqs.filter(f => f.id !== id));
  };

  const toggleFAQ = (id: string) => {
    setFaqs(faqs.map(f => 
      f.id === id ? { ...f, isActive: !f.isActive } : f
    ));
  };

  return (
    <div className="container max-w-4xl py-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bot className="h-6 w-6" />
            AI Call Agent Settings
          </h1>
          <p className="text-muted-foreground">
            Configure your AI-powered phone answering service
          </p>
        </div>
        <Button onClick={saveConfig} disabled={isSaving}>
          <Save className="h-4 w-4 mr-2" />
          {isSaving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>

      {/* Enable Toggle */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Phone className="h-8 w-8 text-primary" />
              <div>
                <h3 className="font-semibold">AI Call Answering</h3>
                <p className="text-sm text-muted-foreground">
                  Automatically answer calls and qualify leads with AI
                </p>
              </div>
            </div>
            <Switch
              checked={config.is_enabled}
              onCheckedChange={(checked) => setConfig({ ...config, is_enabled: checked })}
            />
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="greeting">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="greeting">
            <MessageSquare className="h-4 w-4 mr-2" />
            Greeting
          </TabsTrigger>
          <TabsTrigger value="voice">
            <Mic className="h-4 w-4 mr-2" />
            Voice
          </TabsTrigger>
          <TabsTrigger value="hours">
            <Clock className="h-4 w-4 mr-2" />
            Hours
          </TabsTrigger>
          <TabsTrigger value="faq">
            <Bot className="h-4 w-4 mr-2" />
            FAQ
          </TabsTrigger>
        </TabsList>

        <TabsContent value="greeting" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Greeting Messages</CardTitle>
              <CardDescription>
                Customize what the AI says when answering calls
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Business Hours Greeting</Label>
                <Textarea
                  value={config.greeting_text}
                  onChange={(e) => setConfig({ ...config, greeting_text: e.target.value })}
                  placeholder="Hi, thanks for calling..."
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label>After Hours Greeting</Label>
                <Textarea
                  value={config.after_hours_greeting}
                  onChange={(e) => setConfig({ ...config, after_hours_greeting: e.target.value })}
                  placeholder="Thanks for calling! Our office is currently closed..."
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="voice" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Voice Settings</CardTitle>
              <CardDescription>
                Choose the AI voice personality
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Voice</Label>
                <div className="grid grid-cols-2 gap-2">
                  {VOICE_OPTIONS.map((voice) => (
                    <Button
                      key={voice.value}
                      variant={config.ai_voice === voice.value ? 'default' : 'outline'}
                      className="justify-start"
                      onClick={() => setConfig({ ...config, ai_voice: voice.value })}
                    >
                      <Mic className="h-4 w-4 mr-2" />
                      {voice.label}
                    </Button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="hours" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Business Hours</CardTitle>
              <CardDescription>
                Set when the AI should use business hours vs after hours greeting
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Start Time</Label>
                  <Input
                    type="time"
                    value={config.business_hours.start}
                    onChange={(e) => setConfig({
                      ...config,
                      business_hours: { ...config.business_hours, start: e.target.value }
                    })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>End Time</Label>
                  <Input
                    type="time"
                    value={config.business_hours.end}
                    onChange={(e) => setConfig({
                      ...config,
                      business_hours: { ...config.business_hours, end: e.target.value }
                    })}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="faq" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>FAQ Responses</CardTitle>
              <CardDescription>
                Add common questions and answers for the AI to use
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Add new FAQ */}
              <div className="border rounded-lg p-4 space-y-3">
                <div className="space-y-2">
                  <Label>Question</Label>
                  <Input
                    value={newFaq.question}
                    onChange={(e) => setNewFaq({ ...newFaq, question: e.target.value })}
                    placeholder="What are your prices?"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Answer</Label>
                  <Textarea
                    value={newFaq.answer}
                    onChange={(e) => setNewFaq({ ...newFaq, answer: e.target.value })}
                    placeholder="Our pricing varies based on..."
                    rows={2}
                  />
                </div>
                <Button onClick={addFAQ} disabled={!newFaq.question || !newFaq.answer}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add FAQ
                </Button>
              </div>

              {/* Existing FAQs */}
              <div className="space-y-2">
                {faqs.map((faq) => (
                  <div
                    key={faq.id}
                    className="border rounded-lg p-3 flex items-start justify-between gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{faq.question}</p>
                      <p className="text-sm text-muted-foreground mt-1">{faq.answer}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={faq.isActive}
                        onCheckedChange={() => toggleFAQ(faq.id)}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeFAQ(faq.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
                
                {faqs.length === 0 && (
                  <p className="text-center text-muted-foreground py-4">
                    No FAQs added yet. Add common questions above.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
