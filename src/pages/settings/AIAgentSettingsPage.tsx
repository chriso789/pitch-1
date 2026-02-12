import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { PhoneSetupWizard } from '@/components/settings/PhoneSetupWizard';
import { 
  Bot, 
  MessageSquare, 
  Phone, 
  PhoneCall,
  Settings, 
  Plus, 
  Trash2, 
  Save,
  Mic,
  Clock,
  ArrowLeft,
  ClipboardList,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface FAQ {
  id: string;
  question: string;
  answer: string;
  isActive: boolean;
  order: number;
}

interface QualificationQuestion {
  key: string;
  label: string;
  description: string;
  type: string;
  required: boolean;
  enabled: boolean;
  isBuiltIn?: boolean;
}

interface TelnyxLocation {
  id: string;
  name: string;
  telnyx_phone_number: string;
  phone_porting_status?: string | null;
}

interface UnsetupLocation {
  id: string;
  name: string;
}

interface AIConfig {
  is_enabled: boolean;
  greeting_text: string;
  after_hours_greeting: string;
  ai_voice: string;
  ai_model: string;
  temperature: number;
  escalation_keywords: string[];
  location_id: string | null;
  business_hours: {
    start: string;
    end: string;
    days: string[];
  };
  qualification_questions: QualificationQuestion[];
}

const VOICE_OPTIONS = [
  { value: 'en-US-Wavenet-D', label: 'Male (Professional)' },
  { value: 'en-US-Wavenet-C', label: 'Female (Professional)' },
  { value: 'en-US-Wavenet-A', label: 'Male (Casual)' },
  { value: 'en-US-Wavenet-E', label: 'Female (Casual)' },
];

const DEFAULT_QUESTIONS: QualificationQuestion[] = [
  { key: 'name', label: 'Caller Name', description: 'Full name of the caller', type: 'string', required: true, enabled: true, isBuiltIn: true },
  { key: 'service_needed', label: 'Service Needed', description: 'What service they need', type: 'string', required: true, enabled: true, isBuiltIn: true },
  { key: 'callback_number', label: 'Callback Number', description: 'Best phone number to reach them', type: 'string', required: true, enabled: true, isBuiltIn: true },
  { key: 'address', label: 'Property Address', description: 'Property address where service is needed', type: 'string', required: false, enabled: true, isBuiltIn: true },
  { key: 'roof_age', label: 'Roof Age', description: 'Approximate age of the roof', type: 'string', required: false, enabled: false, isBuiltIn: true },
  { key: 'has_insurance_claim', label: 'Insurance Claim', description: 'Whether they have an insurance claim', type: 'boolean', required: false, enabled: false, isBuiltIn: true },
  { key: 'timeline', label: 'Timeline', description: 'When they want the work done', type: 'string', required: false, enabled: false, isBuiltIn: true },
  { key: 'budget_range', label: 'Budget Range', description: 'Approximate budget if mentioned', type: 'string', required: false, enabled: false, isBuiltIn: true },
];

type TestCallStatus = 'idle' | 'initiating' | 'ringing' | 'answered' | 'completed' | 'error';

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
    location_id: null,
    business_hours: {
      start: '08:00',
      end: '18:00',
      days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    },
    qualification_questions: DEFAULT_QUESTIONS,
  });

  const [telnyxLocations, setTelnyxLocations] = useState<TelnyxLocation[]>([]);
  const [unsetupLocations, setUnsetupLocations] = useState<UnsetupLocation[]>([]);
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [setupLocationId, setSetupLocationId] = useState<string | null>(null);
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [newFaq, setNewFaq] = useState({ question: '', answer: '' });
  const [isSaving, setIsSaving] = useState(false);

  // Test call state
  const [testPhoneNumber, setTestPhoneNumber] = useState('');
  const [testCallStatus, setTestCallStatus] = useState<TestCallStatus>('idle');
  const [testCallError, setTestCallError] = useState('');

  // New question form
  const [newQuestion, setNewQuestion] = useState({ key: '', label: '', description: '', type: 'string' });

  useEffect(() => {
    if (tenantId) {
      loadConfig();
      loadFAQs();
      loadTelnyxLocations();
    }
  }, [tenantId]);

  const loadTelnyxLocations = async () => {
    // Fetch locations WITH numbers
    const { data: withNumbers } = await supabase
      .from('locations')
      .select('id, name, telnyx_phone_number, phone_porting_status')
      .eq('tenant_id', tenantId)
      .not('telnyx_phone_number', 'is', null);
    if (withNumbers) setTelnyxLocations(withNumbers as TelnyxLocation[]);

    // Fetch locations WITHOUT numbers (for setup wizard)
    const { data: withoutNumbers } = await supabase
      .from('locations')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .is('telnyx_phone_number', null);
    if (withoutNumbers) setUnsetupLocations(withoutNumbers as UnsetupLocation[]);
  };

  const loadConfig = async () => {
    const { data } = await supabase
      .from('ai_answering_config')
      .select('*')
      .eq('tenant_id', tenantId)
      .single();

    if (data) {
      const rawQuestions = (data as any).qualification_questions;
      const questions = rawQuestions
        ? (rawQuestions as QualificationQuestion[]).map(q => ({
            ...q,
            isBuiltIn: DEFAULT_QUESTIONS.some(dq => dq.key === q.key),
          }))
        : DEFAULT_QUESTIONS;

      setConfig({
        is_enabled: data.is_enabled || false,
        greeting_text: data.greeting_text || config.greeting_text,
        after_hours_greeting: data.after_hours_greeting || config.after_hours_greeting,
        ai_voice: data.ai_voice || config.ai_voice,
        ai_model: data.ai_model || config.ai_model,
        temperature: data.temperature || config.temperature,
        escalation_keywords: data.escalation_keywords || config.escalation_keywords,
        location_id: (data as any).location_id || null,
        business_hours: (data.business_hours as any) || config.business_hours,
        qualification_questions: questions,
      });
    }
  };

  const loadFAQs = async () => {
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
          location_id: config.location_id,
          business_hours: config.business_hours,
          qualification_questions: config.qualification_questions as any,
        } as any, {
          onConflict: 'tenant_id',
        });

      if (configError) throw configError;

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

  // FAQ handlers
  const addFAQ = () => {
    if (!newFaq.question.trim() || !newFaq.answer.trim()) return;
    setFaqs([
      ...faqs,
      { id: crypto.randomUUID(), question: newFaq.question, answer: newFaq.answer, isActive: true, order: faqs.length },
    ]);
    setNewFaq({ question: '', answer: '' });
  };

  const removeFAQ = (id: string) => setFaqs(faqs.filter(f => f.id !== id));
  const toggleFAQ = (id: string) => setFaqs(faqs.map(f => f.id === id ? { ...f, isActive: !f.isActive } : f));

  // Qualification question handlers
  const toggleQuestion = (key: string) => {
    setConfig({
      ...config,
      qualification_questions: config.qualification_questions.map(q =>
        q.key === key ? { ...q, enabled: !q.enabled } : q
      ),
    });
  };

  const toggleQuestionRequired = (key: string) => {
    setConfig({
      ...config,
      qualification_questions: config.qualification_questions.map(q =>
        q.key === key ? { ...q, required: !q.required } : q
      ),
    });
  };

  const removeQuestion = (key: string) => {
    setConfig({
      ...config,
      qualification_questions: config.qualification_questions.filter(q => q.key !== key),
    });
  };

  const addQuestion = () => {
    if (!newQuestion.key.trim() || !newQuestion.label.trim()) return;
    const sanitizedKey = newQuestion.key.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (config.qualification_questions.some(q => q.key === sanitizedKey)) {
      toast({ title: 'Duplicate key', description: 'A question with that key already exists', variant: 'destructive' });
      return;
    }
    setConfig({
      ...config,
      qualification_questions: [
        ...config.qualification_questions,
        { key: sanitizedKey, label: newQuestion.label, description: newQuestion.description, type: newQuestion.type, required: false, enabled: true, isBuiltIn: false },
      ],
    });
    setNewQuestion({ key: '', label: '', description: '', type: 'string' });
  };

  // Test call handler
  const makeTestCall = async () => {
    if (!testPhoneNumber.trim()) {
      toast({ title: 'Enter a phone number', variant: 'destructive' });
      return;
    }
    setTestCallStatus('initiating');
    setTestCallError('');
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const response = await supabase.functions.invoke('test-ai-call', {
        body: { phone_number: testPhoneNumber, tenant_id: tenantId, location_id: config.location_id },
      });

      if (response.error) throw new Error(response.error.message || 'Failed to initiate test call');
      
      setTestCallStatus('ringing');
      // Auto-reset after 30s
      setTimeout(() => setTestCallStatus(prev => prev === 'ringing' ? 'completed' : prev), 30000);
      
      toast({ title: 'Test Call Initiated', description: `Calling ${testPhoneNumber}...` });
    } catch (err: any) {
      console.error('Test call error:', err);
      setTestCallStatus('error');
      setTestCallError(err.message || 'Unknown error');
      toast({ title: 'Test Call Failed', description: err.message, variant: 'destructive' });
    }
  };

  const testCallStatusIcon = () => {
    switch (testCallStatus) {
      case 'initiating': return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
      case 'ringing': return <PhoneCall className="h-4 w-4 text-primary animate-pulse" />;
      case 'completed': return <CheckCircle2 className="h-4 w-4 text-primary" />;
      case 'error': return <AlertCircle className="h-4 w-4 text-destructive" />;
      default: return null;
    }
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

      {/* Phone Number Selection */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Phone className="h-5 w-5" />
            Answering Number
          </CardTitle>
          <CardDescription>
            Select which phone number the AI agent should answer
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {telnyxLocations.length > 0 && (
            <div className="space-y-3">
              <Select
                value={config.location_id || ''}
                onValueChange={(value) => setConfig({ ...config, location_id: value || null })}
              >
                <SelectTrigger className="max-w-md">
                  <SelectValue placeholder="Select a phone number..." />
                </SelectTrigger>
                <SelectContent>
                  {telnyxLocations.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>
                      {loc.name} — {loc.telnyx_phone_number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Status badge for selected number */}
              {config.location_id && (() => {
                const selected = telnyxLocations.find(l => l.id === config.location_id);
                if (!selected) return null;
                const status = selected.phone_porting_status || 'active';
                return (
                  <div className="flex items-center gap-2 text-sm">
                    <Badge variant={status === 'active' ? 'default' : 'secondary'}>
                      {status === 'active' ? 'Active' : status}
                    </Badge>
                    <span className="text-muted-foreground">{selected.telnyx_phone_number}</span>
                  </div>
                );
              })()}
            </div>
          )}

          {telnyxLocations.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No locations with phone numbers found. Set up a number to get started.
            </p>
          )}

          {/* Setup / Manage actions */}
          <div className="flex items-center gap-3 flex-wrap">
            {unsetupLocations.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  // Auto-select if only one location without a number
                  if (unsetupLocations.length === 1) {
                    setSetupLocationId(unsetupLocations[0].id);
                  } else {
                    setSetupLocationId(null);
                  }
                  setIsSetupOpen(true);
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                Set Up New Number
              </Button>
            )}
            {unsetupLocations.length === 0 && telnyxLocations.length === 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/settings/locations')}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Create a Location First
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/settings/phone-provisioning')}
            >
              <Settings className="h-4 w-4 mr-2" />
              Manage All Numbers
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Phone Setup Wizard Dialog */}
      <Dialog open={isSetupOpen} onOpenChange={setIsSetupOpen}>
        <DialogContent className="sm:max-w-lg p-0 overflow-hidden [&>button]:hidden">
          {isSetupOpen && (
            <>
              {/* Location picker when multiple unsetup locations exist */}
              {!setupLocationId && unsetupLocations.length > 1 ? (
                <div className="p-6 space-y-4">
                  <h3 className="text-lg font-semibold">Choose a Location</h3>
                  <p className="text-sm text-muted-foreground">
                    Select which location should get a new phone number.
                  </p>
                  <div className="space-y-2">
                    {unsetupLocations.map((loc) => (
                      <Button
                        key={loc.id}
                        variant="outline"
                        className="w-full justify-start"
                        onClick={() => setSetupLocationId(loc.id)}
                      >
                        {loc.name}
                      </Button>
                    ))}
                  </div>
                  <Button variant="ghost" className="w-full" onClick={() => setIsSetupOpen(false)}>
                    Cancel
                  </Button>
                </div>
              ) : setupLocationId ? (
                <div className="p-0 [&>div]:border-0 [&>div]:shadow-none">
                  <PhoneSetupWizard
                    locationId={setupLocationId}
                    tenantId={tenantId!}
                    locationName={
                      unsetupLocations.find(l => l.id === setupLocationId)?.name || 'Location'
                    }
                    onComplete={() => {
                      setIsSetupOpen(false);
                      setSetupLocationId(null);
                      loadTelnyxLocations();
                      // Auto-select newly provisioned number
                      setTimeout(async () => {
                        const { data } = await supabase
                          .from('locations')
                          .select('id')
                          .eq('id', setupLocationId)
                          .not('telnyx_phone_number', 'is', null)
                          .single();
                        if (data) {
                          setConfig(prev => ({ ...prev, location_id: data.id }));
                        }
                      }, 500);
                    }}
                    onCancel={() => {
                      setIsSetupOpen(false);
                      setSetupLocationId(null);
                    }}
                  />
                </div>
              ) : null}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Test Call Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <PhoneCall className="h-5 w-5" />
            Test Call
          </CardTitle>
          <CardDescription>
            Make a test call to verify the AI agent works end-to-end. The AI will call the number you enter and run the full qualification flow.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Input
              placeholder="+1 (555) 123-4567"
              value={testPhoneNumber}
              onChange={(e) => setTestPhoneNumber(e.target.value)}
              className="max-w-xs"
            />
            <Button
              onClick={makeTestCall}
              disabled={testCallStatus === 'initiating' || testCallStatus === 'ringing'}
            >
              {testCallStatus === 'initiating' ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <PhoneCall className="h-4 w-4 mr-2" />
              )}
              Make Test Call
            </Button>
            {testCallStatusIcon()}
            {testCallStatus === 'ringing' && (
              <span className="text-sm text-muted-foreground">Ringing…</span>
            )}
            {testCallStatus === 'completed' && (
              <span className="text-sm text-primary">Call completed</span>
            )}
            {testCallStatus === 'error' && (
              <span className="text-sm text-destructive">{testCallError}</span>
            )}
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
          <TabsTrigger value="qualification">
            <ClipboardList className="h-4 w-4 mr-2" />
            Qualification
          </TabsTrigger>
          <TabsTrigger value="faq">
            <Bot className="h-4 w-4 mr-2" />
            FAQ
          </TabsTrigger>
        </TabsList>

        {/* Greeting Tab */}
        <TabsContent value="greeting" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Greeting Messages</CardTitle>
              <CardDescription>Customize what the AI says when answering calls</CardDescription>
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

        {/* Voice Tab */}
        <TabsContent value="voice" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Voice Settings</CardTitle>
              <CardDescription>Choose the AI voice personality</CardDescription>
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

        {/* Hours Tab */}
        <TabsContent value="hours" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Business Hours</CardTitle>
              <CardDescription>Set when the AI should use business hours vs after hours greeting</CardDescription>
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

        {/* Qualification Tab */}
        <TabsContent value="qualification" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Qualification Questions</CardTitle>
              <CardDescription>
                Configure which questions the AI asks callers. Enabled questions will be asked during calls. Required questions must be answered before the call ends.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Question list */}
              <div className="space-y-2">
                {config.qualification_questions.map((q) => (
                  <div
                    key={q.key}
                    className="border rounded-lg p-3 flex items-center gap-3"
                  >
                    <Switch
                      checked={q.enabled}
                      onCheckedChange={() => toggleQuestion(q.key)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{q.label}</span>
                        <Badge variant="outline" className="text-xs">{q.type}</Badge>
                        {q.required && <Badge className="text-xs">Required</Badge>}
                        {q.isBuiltIn && (
                          <Badge variant="secondary" className="text-xs">Built-in</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{q.description}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1.5">
                        <Checkbox
                          id={`req-${q.key}`}
                          checked={q.required}
                          onCheckedChange={() => toggleQuestionRequired(q.key)}
                        />
                        <Label htmlFor={`req-${q.key}`} className="text-xs cursor-pointer">Req</Label>
                      </div>
                      {!q.isBuiltIn && (
                        <Button variant="ghost" size="icon" onClick={() => removeQuestion(q.key)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Add custom question */}
              <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
                <h4 className="font-medium text-sm">Add Custom Question</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Key (unique ID)</Label>
                    <Input
                      value={newQuestion.key}
                      onChange={(e) => setNewQuestion({ ...newQuestion, key: e.target.value })}
                      placeholder="e.g. property_type"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Label</Label>
                    <Input
                      value={newQuestion.label}
                      onChange={(e) => setNewQuestion({ ...newQuestion, label: e.target.value })}
                      placeholder="e.g. Property Type"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1 col-span-2">
                    <Label className="text-xs">Description (AI prompt)</Label>
                    <Input
                      value={newQuestion.description}
                      onChange={(e) => setNewQuestion({ ...newQuestion, description: e.target.value })}
                      placeholder="e.g. Type of property (residential, commercial)"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Type</Label>
                    <Select value={newQuestion.type} onValueChange={(v) => setNewQuestion({ ...newQuestion, type: v })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="string">Text</SelectItem>
                        <SelectItem value="boolean">Yes/No</SelectItem>
                        <SelectItem value="number">Number</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button onClick={addQuestion} disabled={!newQuestion.key || !newQuestion.label}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Question
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* FAQ Tab */}
        <TabsContent value="faq" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>FAQ Responses</CardTitle>
              <CardDescription>Add common questions and answers for the AI to use</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
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

              <div className="space-y-2">
                {faqs.map((faq) => (
                  <div key={faq.id} className="border rounded-lg p-3 flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{faq.question}</p>
                      <p className="text-sm text-muted-foreground mt-1">{faq.answer}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch checked={faq.isActive} onCheckedChange={() => toggleFAQ(faq.id)} />
                      <Button variant="ghost" size="icon" onClick={() => removeFAQ(faq.id)}>
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
