import React, { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Mic, Volume2, Loader2, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { Json } from "@/integrations/supabase/types";

interface VoiceSettings {
  enabled: boolean;
  voice: string;
  provider: string;
  autoTranscribe: boolean;
  speechSpeed: string;
}

const defaultSettings: VoiceSettings = {
  enabled: true,
  voice: 'nova',
  provider: 'openai',
  autoTranscribe: true,
  speechSpeed: 'normal'
};

const voiceOptions = [
  { value: 'alloy', label: 'Alloy', description: 'Neutral, balanced' },
  { value: 'nova', label: 'Nova', description: 'Female, warm' },
  { value: 'onyx', label: 'Onyx', description: 'Male, deep' },
  { value: 'shimmer', label: 'Shimmer', description: 'Female, expressive' },
  { value: 'echo', label: 'Echo', description: 'Male, clear' },
  { value: 'fable', label: 'Fable', description: 'British, storytelling' }
];

const providerOptions = [
  { value: 'openai', label: 'OpenAI TTS', description: 'Default provider' },
  { value: 'elevenlabs', label: 'ElevenLabs', description: 'Premium voices (requires API key)' }
];

const speedOptions = [
  { value: 'slow', label: 'Slow' },
  { value: 'normal', label: 'Normal' },
  { value: 'fast', label: 'Fast' }
];

export const VoiceAssistantSettings = () => {
  const [settings, setSettings] = useState<VoiceSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const { user } = useCurrentUser();

  useEffect(() => {
    if (user?.id) {
      loadSettings();
    }
  }, [user?.id]);

  const loadSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('app_settings')
        .select('setting_value')
        .eq('user_id', user?.id)
        .eq('setting_key', 'voice_assistant_preferences')
        .maybeSingle();

      if (error) throw error;

      if (data?.setting_value) {
        setSettings({ ...defaultSettings, ...(data.setting_value as unknown as VoiceSettings) });
      }
    } catch (error) {
      console.error('Error loading voice settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    if (!user?.id || !user?.tenant_id) return;
    
    setSaving(true);
    try {
      // Check if setting exists
      const { data: existing } = await supabase
        .from('app_settings')
        .select('id')
        .eq('user_id', user.id)
        .eq('setting_key', 'voice_assistant_preferences')
        .maybeSingle();

      let error;
      const settingsJson = settings as unknown as Json;
      
      if (existing) {
        // Update existing
        const result = await supabase
          .from('app_settings')
          .update({
            setting_value: settingsJson,
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id);
        error = result.error;
      } else {
        // Insert new
        const result = await (supabase
          .from('app_settings')
          .insert({
            user_id: user.id,
            tenant_id: user.tenant_id,
            setting_key: 'voice_assistant_preferences',
            setting_value: settingsJson
          }) as any);
        error = result.error;
      }

      if (error) throw error;

      toast({
        title: "Settings Saved",
        description: "Voice assistant preferences have been updated."
      });
    } catch (error) {
      console.error('Error saving voice settings:', error);
      toast({
        title: "Error",
        description: "Failed to save voice settings.",
        variant: "destructive"
      });
    } finally {
      setSaving(false);
    }
  };

  const updateSetting = <K extends keyof VoiceSettings>(key: K, value: VoiceSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mic className="h-5 w-5" />
            Voice Assistant
          </CardTitle>
          <CardDescription>
            Configure voice input and AI assistant settings for the floating assistant button.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Enable/Disable Toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="voice-enabled">Enable Voice Assistant</Label>
              <p className="text-sm text-muted-foreground">
                Show the floating "P" assistant button on the dashboard
              </p>
            </div>
            <Switch
              id="voice-enabled"
              checked={settings.enabled}
              onCheckedChange={(checked) => updateSetting('enabled', checked)}
            />
          </div>

          {/* Auto-transcribe Toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="auto-transcribe">Auto-transcribe</Label>
              <p className="text-sm text-muted-foreground">
                Automatically start transcription after voice input
              </p>
            </div>
            <Switch
              id="auto-transcribe"
              checked={settings.autoTranscribe}
              onCheckedChange={(checked) => updateSetting('autoTranscribe', checked)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Volume2 className="h-5 w-5" />
            Voice Response Settings
          </CardTitle>
          <CardDescription>
            Choose how the assistant responds to your voice commands.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Voice Selection */}
          <div className="space-y-2">
            <Label htmlFor="voice-select">Voice</Label>
            <Select
              value={settings.voice}
              onValueChange={(value) => updateSetting('voice', value)}
            >
              <SelectTrigger id="voice-select">
                <SelectValue placeholder="Select a voice" />
              </SelectTrigger>
              <SelectContent>
                {voiceOptions.map((voice) => (
                  <SelectItem key={voice.value} value={voice.value}>
                    <div className="flex flex-col">
                      <span>{voice.label}</span>
                      <span className="text-xs text-muted-foreground">{voice.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Provider Selection */}
          <div className="space-y-2">
            <Label htmlFor="provider-select">TTS Provider</Label>
            <Select
              value={settings.provider}
              onValueChange={(value) => updateSetting('provider', value)}
            >
              <SelectTrigger id="provider-select">
                <SelectValue placeholder="Select a provider" />
              </SelectTrigger>
              <SelectContent>
                {providerOptions.map((provider) => (
                  <SelectItem key={provider.value} value={provider.value}>
                    <div className="flex flex-col">
                      <span>{provider.label}</span>
                      <span className="text-xs text-muted-foreground">{provider.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Speech Speed */}
          <div className="space-y-2">
            <Label htmlFor="speed-select">Speech Speed</Label>
            <Select
              value={settings.speechSpeed}
              onValueChange={(value) => updateSetting('speechSpeed', value)}
            >
              <SelectTrigger id="speed-select">
                <SelectValue placeholder="Select speed" />
              </SelectTrigger>
              <SelectContent>
                {speedOptions.map((speed) => (
                  <SelectItem key={speed.value} value={speed.value}>
                    {speed.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button onClick={saveSettings} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              Save Settings
            </>
          )}
        </Button>
      </div>
    </div>
  );
};

export default VoiceAssistantSettings;
