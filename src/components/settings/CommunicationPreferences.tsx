import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Save, Server } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export const CommunicationPreferences: React.FC = () => {
  const [preferences, setPreferences] = useState({
    asterisk_api_url: "",
    asterisk_api_token: "",
    recording_enabled: true,
    recording_announcement: true,
    voicemail_enabled: true,
    voicemail_email: "",
    sms_enabled: true,
    sms_from_number: "",
    email_enabled: true,
    email_from_address: "",
  });
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadPreferences();
  }, []);

  const loadPreferences = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();

      if (!profile?.tenant_id) return;

      const { data, error } = await supabase
        .from('communication_preferences')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') throw error;

      if (data) {
        setPreferences({
          asterisk_api_url: data.asterisk_api_url || "",
          asterisk_api_token: data.asterisk_api_token || "",
          recording_enabled: data.recording_enabled ?? true,
          recording_announcement: data.recording_announcement ?? true,
          voicemail_enabled: data.voicemail_enabled ?? true,
          voicemail_email: data.voicemail_email || "",
          sms_enabled: data.sms_enabled ?? true,
          sms_from_number: data.sms_from_number || "",
          email_enabled: data.email_enabled ?? true,
          email_from_address: data.email_from_address || "",
        });
      }
    } catch (error) {
      console.error('Error loading preferences:', error);
    }
  };

  const savePreferences = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();

      if (!profile?.tenant_id) return;

      const { error } = await supabase
        .from('communication_preferences')
        .upsert({
          tenant_id: profile.tenant_id,
          ...preferences,
        });

      if (error) throw error;

      toast({
        title: "Settings Saved",
        description: "Communication preferences updated successfully",
      });
    } catch (error) {
      console.error('Error saving preferences:', error);
      toast({
        title: "Error",
        description: "Failed to save communication preferences",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="h-5 w-5 text-primary" />
          Self-Hosted Communication Settings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <h3 className="font-semibold">Asterisk Configuration</h3>
          
          <div>
            <Label htmlFor="asterisk_api_url">Asterisk API URL</Label>
            <Input
              id="asterisk_api_url"
              value={preferences.asterisk_api_url}
              onChange={(e) => setPreferences(prev => ({ ...prev, asterisk_api_url: e.target.value }))}
              placeholder="http://comms.yourdomain.com:4000"
            />
            <p className="text-xs text-muted-foreground mt-1">
              URL of your self-hosted Asterisk communications API
            </p>
          </div>

          <div>
            <Label htmlFor="asterisk_api_token">API Token</Label>
            <Input
              id="asterisk_api_token"
              type="password"
              value={preferences.asterisk_api_token}
              onChange={(e) => setPreferences(prev => ({ ...prev, asterisk_api_token: e.target.value }))}
              placeholder="Your secure API token"
            />
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="font-semibold">Call Recording</h3>
          
          <div className="flex items-center justify-between">
            <Label htmlFor="recording_enabled">Enable Call Recording</Label>
            <Switch
              id="recording_enabled"
              checked={preferences.recording_enabled}
              onCheckedChange={(checked) => setPreferences(prev => ({ ...prev, recording_enabled: checked }))}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="recording_announcement">Play Recording Announcement</Label>
            <Switch
              id="recording_announcement"
              checked={preferences.recording_announcement}
              onCheckedChange={(checked) => setPreferences(prev => ({ ...prev, recording_announcement: checked }))}
            />
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="font-semibold">Voicemail</h3>
          
          <div className="flex items-center justify-between">
            <Label htmlFor="voicemail_enabled">Enable Voicemail</Label>
            <Switch
              id="voicemail_enabled"
              checked={preferences.voicemail_enabled}
              onCheckedChange={(checked) => setPreferences(prev => ({ ...prev, voicemail_enabled: checked }))}
            />
          </div>

          <div>
            <Label htmlFor="voicemail_email">Voicemail Notification Email</Label>
            <Input
              id="voicemail_email"
              type="email"
              value={preferences.voicemail_email}
              onChange={(e) => setPreferences(prev => ({ ...prev, voicemail_email: e.target.value }))}
              placeholder="admin@yourdomain.com"
            />
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="font-semibold">SMS Configuration</h3>
          
          <div className="flex items-center justify-between">
            <Label htmlFor="sms_enabled">Enable SMS</Label>
            <Switch
              id="sms_enabled"
              checked={preferences.sms_enabled}
              onCheckedChange={(checked) => setPreferences(prev => ({ ...prev, sms_enabled: checked }))}
            />
          </div>

          <div>
            <Label htmlFor="sms_from_number">SMS From Number</Label>
            <Input
              id="sms_from_number"
              value={preferences.sms_from_number}
              onChange={(e) => setPreferences(prev => ({ ...prev, sms_from_number: e.target.value }))}
              placeholder="+15551234567"
            />
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="font-semibold">Email Configuration</h3>
          
          <div className="flex items-center justify-between">
            <Label htmlFor="email_enabled">Enable Email</Label>
            <Switch
              id="email_enabled"
              checked={preferences.email_enabled}
              onCheckedChange={(checked) => setPreferences(prev => ({ ...prev, email_enabled: checked }))}
            />
          </div>

          <div>
            <Label htmlFor="email_from_address">Email From Address</Label>
            <Input
              id="email_from_address"
              type="email"
              value={preferences.email_from_address}
              onChange={(e) => setPreferences(prev => ({ ...prev, email_from_address: e.target.value }))}
              placeholder="noreply@yourdomain.com"
            />
          </div>
        </div>

        <Button onClick={savePreferences} disabled={loading} className="w-full">
          <Save className="h-4 w-4 mr-2" />
          {loading ? "Saving..." : "Save Communication Settings"}
        </Button>
      </CardContent>
    </Card>
  );
};
