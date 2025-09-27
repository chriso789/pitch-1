import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Play, Settings, Mic, MessageSquare, Phone, Clock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface AnsweringServiceConfigProps {
  onConfigChange?: (config: any) => void;
}

interface GreetingConfig {
  id: string;
  name: string;
  message: string;
  voice: string;
  isActive: boolean;
  triggerConditions: {
    timeBasedRouting?: boolean;
    afterHours?: boolean;
    allCalls?: boolean;
  };
}

export const AnsweringServiceConfig: React.FC<AnsweringServiceConfigProps> = ({ onConfigChange }) => {
  const { toast } = useToast();
  const [greetings, setGreetings] = useState<GreetingConfig[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedGreeting, setSelectedGreeting] = useState<GreetingConfig | null>(null);
  const [isTestingVoice, setIsTestingVoice] = useState(false);
  
  // AI Configuration
  const [aiSettings, setAiSettings] = useState({
    enabled: true,
    escalationTriggers: ['human', 'agent', 'person', 'representative'],
    maxCallDuration: 300, // 5 minutes
    collectContactInfo: true,
    scheduleAppointments: true,
    transferToSales: true
  });

  useEffect(() => {
    loadAnsweringServiceConfig();
  }, []);

  const loadAnsweringServiceConfig = async () => {
    try {
      const response = await supabase.functions.invoke('call-answering-service', {
        body: { action: 'get-greetings', tenantId: 'current-tenant-id' }
      });

      if (response.data?.greetings) {
        const formattedGreetings = response.data.greetings.map((greeting: any) => ({
          id: greeting.id || crypto.randomUUID(),
          name: greeting.name || 'Default Greeting',
          message: greeting.custom_greeting || '',
          voice: greeting.voice_settings?.voice || 'nova',
          isActive: greeting.is_active || false,
          triggerConditions: greeting.trigger_conditions || { allCalls: true }
        }));
        setGreetings(formattedGreetings);
      } else {
        // Create default greeting if none exists
        const defaultGreeting: GreetingConfig = {
          id: crypto.randomUUID(),
          name: 'Default Business Greeting',
          message: "Thank you for calling! I'm an AI assistant here to help you. How can I assist you today? You can speak naturally, or press 1 for sales, 2 for support, 3 for appointments, or 0 to speak with a human agent.",
          voice: 'nova',
          isActive: true,
          triggerConditions: { allCalls: true }
        };
        setGreetings([defaultGreeting]);
      }
    } catch (error) {
      console.error('Error loading answering service config:', error);
    }
  };

  const saveAnsweringServiceConfig = async () => {
    setIsLoading(true);
    try {
      for (const greeting of greetings) {
        await supabase.functions.invoke('call-answering-service', {
          body: {
            action: 'configure-greeting',
            tenantId: 'current-tenant-id',
            greeting: greeting.message,
            voiceSettings: {
              voice: greeting.voice,
              name: greeting.name,
              triggerConditions: greeting.triggerConditions,
              isActive: greeting.isActive
            }
          }
        });
      }

      toast({
        title: "Success",
        description: "Answering service configuration saved successfully",
      });

      if (onConfigChange) {
        onConfigChange({ greetings, aiSettings });
      }
    } catch (error) {
      console.error('Error saving answering service config:', error);
      toast({
        title: "Error",
        description: "Failed to save answering service configuration",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const testVoice = async (greeting: GreetingConfig) => {
    setIsTestingVoice(true);
    try {
      const response = await supabase.functions.invoke('text-to-speech', {
        body: {
          text: greeting.message.substring(0, 100) + '...', // Test with first 100 chars
          voice: greeting.voice
        }
      });

      if (response.data?.audioContent) {
        // Play the audio
        const audio = new Audio(`data:audio/mp3;base64,${response.data.audioContent}`);
        await audio.play();
      }

      toast({
        title: "Voice Test",
        description: "Playing voice sample...",
      });
    } catch (error) {
      console.error('Error testing voice:', error);
      toast({
        title: "Error",
        description: "Failed to test voice",
        variant: "destructive",
      });
    } finally {
      setIsTestingVoice(false);
    }
  };

  const updateGreeting = (id: string, updates: Partial<GreetingConfig>) => {
    setGreetings(prev => 
      prev.map(greeting => 
        greeting.id === id ? { ...greeting, ...updates } : greeting
      )
    );
  };

  const addNewGreeting = () => {
    const newGreeting: GreetingConfig = {
      id: crypto.randomUUID(),
      name: 'New Greeting',
      message: 'Thank you for calling! How can I help you today?',
      voice: 'nova',
      isActive: false,
      triggerConditions: { allCalls: false }
    };

    setGreetings(prev => [...prev, newGreeting]);
    setSelectedGreeting(newGreeting);
  };

  const removeGreeting = (id: string) => {
    setGreetings(prev => prev.filter(greeting => greeting.id !== id));
    if (selectedGreeting?.id === id) {
      setSelectedGreeting(null);
    }
  };

  const availableVoices = [
    { value: 'alloy', label: 'Alloy (Neutral)' },
    { value: 'echo', label: 'Echo (Male)' },
    { value: 'fable', label: 'Fable (British Male)' },
    { value: 'nova', label: 'Nova (Female)' },
    { value: 'shimmer', label: 'Shimmer (Female)' },
    { value: 'onyx', label: 'Onyx (Deep Male)' }
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">AI Answering Service Configuration</h3>
          <p className="text-sm text-muted-foreground">
            Configure AI-powered call answering with custom greetings and intelligent routing
          </p>
        </div>
        <Button onClick={addNewGreeting} className="gap-2">
          <MessageSquare className="w-4 h-4" />
          Add Greeting
        </Button>
      </div>

      <Tabs defaultValue="greetings" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="greetings" className="gap-1">
            <MessageSquare className="w-4 h-4" />
            Greetings
          </TabsTrigger>
          <TabsTrigger value="ai-settings" className="gap-1">
            <Settings className="w-4 h-4" />
            AI Settings
          </TabsTrigger>
          <TabsTrigger value="escalation" className="gap-1">
            <Phone className="w-4 h-4" />
            Escalation
          </TabsTrigger>
        </TabsList>

        <TabsContent value="greetings" className="space-y-4">
          <div className="grid gap-4">
            {greetings.map((greeting) => (
              <Card key={greeting.id} className="border-2">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={greeting.isActive}
                      onCheckedChange={(checked) => updateGreeting(greeting.id, { isActive: checked })}
                    />
                    <div>
                      <CardTitle className="text-base">{greeting.name}</CardTitle>
                      <CardDescription>
                        Voice: {availableVoices.find(v => v.value === greeting.voice)?.label}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={greeting.isActive ? "default" : "secondary"}>
                      {greeting.isActive ? "Active" : "Inactive"}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => testVoice(greeting)}
                      disabled={isTestingVoice}
                    >
                      <Play className="w-4 h-4" />
                    </Button>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor={`name-${greeting.id}`}>Greeting Name</Label>
                    <Input
                      id={`name-${greeting.id}`}
                      value={greeting.name}
                      onChange={(e) => updateGreeting(greeting.id, { name: e.target.value })}
                    />
                  </div>

                  <div>
                    <Label htmlFor={`voice-${greeting.id}`}>Voice</Label>
                    <Select
                      value={greeting.voice}
                      onValueChange={(value) => updateGreeting(greeting.id, { voice: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {availableVoices.map((voice) => (
                          <SelectItem key={voice.value} value={voice.value}>
                            {voice.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor={`message-${greeting.id}`}>Greeting Message</Label>
                    <Textarea
                      id={`message-${greeting.id}`}
                      value={greeting.message}
                      onChange={(e) => updateGreeting(greeting.id, { message: e.target.value })}
                      rows={4}
                      placeholder="Enter your custom greeting message..."
                    />
                    <p className="text-sm text-muted-foreground mt-1">
                      Keep it concise and professional. The AI will use this as the initial greeting.
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="flex items-center space-x-2">
                      <Switch
                        checked={greeting.triggerConditions.allCalls}
                        onCheckedChange={(checked) => 
                          updateGreeting(greeting.id, {
                            triggerConditions: { ...greeting.triggerConditions, allCalls: checked }
                          })
                        }
                      />
                      <Label>All Calls</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Switch
                        checked={greeting.triggerConditions.afterHours}
                        onCheckedChange={(checked) => 
                          updateGreeting(greeting.id, {
                            triggerConditions: { ...greeting.triggerConditions, afterHours: checked }
                          })
                        }
                      />
                      <Label>After Hours</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Switch
                        checked={greeting.triggerConditions.timeBasedRouting}
                        onCheckedChange={(checked) => 
                          updateGreeting(greeting.id, {
                            triggerConditions: { ...greeting.triggerConditions, timeBasedRouting: checked }
                          })
                        }
                      />
                      <Label>Time-Based</Label>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => removeGreeting(greeting.id)}
                    >
                      Remove
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => testVoice(greeting)}
                      disabled={isTestingVoice}
                    >
                      <Play className="w-4 h-4 mr-1" />
                      Test Voice
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="ai-settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>AI Behavior Settings</CardTitle>
              <CardDescription>
                Configure how the AI handles calls and interactions
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Enable AI Answering</Label>
                  <p className="text-sm text-muted-foreground">
                    Use AI to answer and handle incoming calls
                  </p>
                </div>
                <Switch
                  checked={aiSettings.enabled}
                  onCheckedChange={(checked) => 
                    setAiSettings(prev => ({ ...prev, enabled: checked }))
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Collect Contact Information</Label>
                  <p className="text-sm text-muted-foreground">
                    AI will ask for name, phone, and email when appropriate
                  </p>
                </div>
                <Switch
                  checked={aiSettings.collectContactInfo}
                  onCheckedChange={(checked) => 
                    setAiSettings(prev => ({ ...prev, collectContactInfo: checked }))
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Schedule Appointments</Label>
                  <p className="text-sm text-muted-foreground">
                    Allow AI to schedule appointments and consultations
                  </p>
                </div>
                <Switch
                  checked={aiSettings.scheduleAppointments}
                  onCheckedChange={(checked) => 
                    setAiSettings(prev => ({ ...prev, scheduleAppointments: checked }))
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Transfer to Sales</Label>
                  <p className="text-sm text-muted-foreground">
                    AI can transfer qualified leads to sales team
                  </p>
                </div>
                <Switch
                  checked={aiSettings.transferToSales}
                  onCheckedChange={(checked) => 
                    setAiSettings(prev => ({ ...prev, transferToSales: checked }))
                  }
                />
              </div>

              <div>
                <Label htmlFor="max-duration">Maximum Call Duration (seconds)</Label>
                <Input
                  id="max-duration"
                  type="number"
                  value={aiSettings.maxCallDuration}
                  onChange={(e) => 
                    setAiSettings(prev => ({ ...prev, maxCallDuration: parseInt(e.target.value) }))
                  }
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="escalation" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Human Escalation Settings</CardTitle>
              <CardDescription>
                Configure when and how calls are escalated to human agents
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Escalation Trigger Words</Label>
                <Input
                  value={aiSettings.escalationTriggers.join(', ')}
                  onChange={(e) => 
                    setAiSettings(prev => ({
                      ...prev,
                      escalationTriggers: e.target.value.split(',').map(word => word.trim())
                    }))
                  }
                  placeholder="human, agent, person, representative"
                />
                <p className="text-sm text-muted-foreground mt-1">
                  Comma-separated words that trigger human escalation
                </p>
              </div>

              <div className="p-4 border rounded-lg bg-muted/50">
                <h4 className="font-medium mb-2">Automatic Escalation Scenarios</h4>
                <ul className="text-sm space-y-1 text-muted-foreground">
                  <li>• Customer explicitly requests a human agent</li>
                  <li>• AI cannot understand customer request after 3 attempts</li>
                  <li>• Call duration exceeds maximum limit</li>
                  <li>• Customer expresses frustration or dissatisfaction</li>
                  <li>• Complex technical issues that require human expertise</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={loadAnsweringServiceConfig}>
          Reset
        </Button>
        <Button onClick={saveAnsweringServiceConfig} disabled={isLoading}>
          {isLoading ? 'Saving...' : 'Save Configuration'}
        </Button>
      </div>
    </div>
  );
};