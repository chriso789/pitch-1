import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Settings, Moon, Sun, Bell, Calendar, Palette, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface GoogleCalendarConnection {
  calendar_name: string;
  calendar_id: string;
  connected_at: string;
  last_synced_at: string | null;
  is_active: boolean;
}

export const GeneralSettings = () => {
  const [settings, setSettings] = useState({
    darkMode: false,
    notifications: true,
    emailNotifications: true,
    pushNotifications: false,
    calendarSync: false,
    theme: "blue",
    language: "en",
    timezone: "UTC"
  });
  const [loading, setLoading] = useState(true);
  const [googleCalendarConnection, setGoogleCalendarConnection] = useState<GoogleCalendarConnection | null>(null);
  const [connectingGoogleCalendar, setConnectingGoogleCalendar] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadSettings();
    loadGoogleCalendarConnection();

    // Listen for OAuth callback
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      
      if (event.data.type === 'google-calendar-oauth-success') {
        handleOAuthCallback(event.data.code, event.data.state);
      } else if (event.data.type === 'google-calendar-oauth-error') {
        setConnectingGoogleCalendar(false);
        toast({
          title: "Connection Failed",
          description: event.data.error || "Failed to connect to Google Calendar",
          variant: "destructive",
        });
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const loadSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('app_settings')
        .select('setting_key, setting_value')
        .eq('setting_key', 'general_preferences');

      if (error) throw error;

      if (data && data.length > 0 && data[0].setting_value) {
        const savedSettings = data[0].setting_value as any;
        setSettings({ ...settings, ...savedSettings });
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadGoogleCalendarConnection = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('google-calendar-oauth', {
        body: { action: 'status' }
      });

      if (error) throw error;

      if (data?.connected && data?.connection) {
        setGoogleCalendarConnection(data.connection);
      }
    } catch (error) {
      console.error('Error loading Google Calendar connection:', error);
    }
  };

  const handleGoogleConnect = async () => {
    try {
      setConnectingGoogleCalendar(true);
      
      const { data, error } = await supabase.functions.invoke('google-calendar-oauth', {
        body: { action: 'initiate' }
      });

      if (error) throw error;

      if (data?.authUrl) {
        // Open OAuth popup
        const width = 600;
        const height = 700;
        const left = window.screen.width / 2 - width / 2;
        const top = window.screen.height / 2 - height / 2;
        
        window.open(
          data.authUrl,
          'Google Calendar Authorization',
          `width=${width},height=${height},top=${top},left=${left}`
        );
      }
    } catch (error: any) {
      console.error('Error initiating Google Calendar OAuth:', error);
      setConnectingGoogleCalendar(false);
      toast({
        title: "Connection Failed",
        description: error.message || "Failed to initiate Google Calendar connection",
        variant: "destructive",
      });
    }
  };

  const handleOAuthCallback = async (code: string, state: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('google-calendar-oauth', {
        body: { action: 'callback', code, state }
      });

      if (error) throw error;

      toast({
        title: "Connected Successfully",
        description: `Connected to ${data.calendarName}`,
      });

      await loadGoogleCalendarConnection();
    } catch (error: any) {
      console.error('Error completing OAuth:', error);
      toast({
        title: "Connection Failed",
        description: error.message || "Failed to complete Google Calendar connection",
        variant: "destructive",
      });
    } finally {
      setConnectingGoogleCalendar(false);
    }
  };

  const handleGoogleDisconnect = async () => {
    try {
      const { error } = await supabase.functions.invoke('google-calendar-oauth', {
        body: { action: 'disconnect' }
      });

      if (error) throw error;

      setGoogleCalendarConnection(null);
      updateSetting('calendarSync', false);

      toast({
        title: "Disconnected",
        description: "Google Calendar has been disconnected",
      });
    } catch (error: any) {
      console.error('Error disconnecting Google Calendar:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to disconnect Google Calendar",
        variant: "destructive",
      });
    }
  };

  const updateSetting = async (key: string, value: any) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user?.id)
        .single();

      const { error } = await supabase
        .from('app_settings')
        .upsert({
          setting_key: 'general_preferences',
          setting_value: newSettings,
          user_id: user?.id,
          tenant_id: profile?.tenant_id
        });

      if (error) throw error;

      toast({
        title: "Settings Updated",
        description: "Your preferences have been saved.",
      });

      // Apply dark mode immediately
      if (key === 'darkMode') {
        document.documentElement.classList.toggle('dark', value);
      }
    } catch (error) {
      console.error('Error updating settings:', error);
      toast({
        title: "Error",
        description: "Failed to save settings. Please try again.",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center py-8 text-muted-foreground">
            Loading settings...
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Appearance Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5 text-primary" />
            Appearance
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-base">Dark Mode</Label>
              <div className="text-sm text-muted-foreground">
                Toggle between light and dark themes
              </div>
            </div>
            <Switch
              checked={settings.darkMode}
              onCheckedChange={(checked) => updateSetting('darkMode', checked)}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-base">Theme Color</Label>
            <Select value={settings.theme} onValueChange={(value) => updateSetting('theme', value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="blue">Professional Blue</SelectItem>
                <SelectItem value="orange">Construction Orange</SelectItem>
                <SelectItem value="green">Success Green</SelectItem>
                <SelectItem value="gray">Neutral Gray</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Notification Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            Notifications
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-base">Enable Notifications</Label>
              <div className="text-sm text-muted-foreground">
                Receive system notifications
              </div>
            </div>
            <Switch
              checked={settings.notifications}
              onCheckedChange={(checked) => updateSetting('notifications', checked)}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-base">Email Notifications</Label>
              <div className="text-sm text-muted-foreground">
                Receive notifications via email
              </div>
            </div>
            <Switch
              checked={settings.emailNotifications}
              onCheckedChange={(checked) => updateSetting('emailNotifications', checked)}
              disabled={!settings.notifications}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-base">Push Notifications</Label>
              <div className="text-sm text-muted-foreground">
                Receive browser push notifications
              </div>
            </div>
            <Switch
              checked={settings.pushNotifications}
              onCheckedChange={(checked) => updateSetting('pushNotifications', checked)}
              disabled={!settings.notifications}
            />
          </div>
        </CardContent>
      </Card>

      {/* Calendar & Integration Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            Calendar & Integrations
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base">Calendar Sync</Label>
                <div className="text-sm text-muted-foreground">
                  Sync appointments with Google Calendar
                </div>
                {googleCalendarConnection && (
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant="default" className="bg-green-500">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Connected
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {googleCalendarConnection.calendar_name}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {!googleCalendarConnection ? (
                  <Button 
                    onClick={handleGoogleConnect} 
                    disabled={connectingGoogleCalendar}
                    variant="outline"
                  >
                    {connectingGoogleCalendar ? "Connecting..." : "Sign in with Google"}
                  </Button>
                ) : (
                  <>
                    <Switch
                      checked={settings.calendarSync}
                      onCheckedChange={(checked) => updateSetting('calendarSync', checked)}
                    />
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={handleGoogleDisconnect}
                    >
                      Disconnect
                    </Button>
                  </>
                )}
              </div>
            </div>
            {!googleCalendarConnection && (
              <div className="text-xs text-muted-foreground pl-1">
                Connect your Google account to enable calendar sync
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-base">Timezone</Label>
            <Select value={settings.timezone} onValueChange={(value) => updateSetting('timezone', value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="UTC">UTC</SelectItem>
                <SelectItem value="America/New_York">Eastern Time</SelectItem>
                <SelectItem value="America/Chicago">Central Time</SelectItem>
                <SelectItem value="America/Denver">Mountain Time</SelectItem>
                <SelectItem value="America/Los_Angeles">Pacific Time</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-base">Language</Label>
            <Select value={settings.language} onValueChange={(value) => updateSetting('language', value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="es">Spanish</SelectItem>
                <SelectItem value="fr">French</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* System Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-primary" />
            System Actions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button variant="outline" className="w-full">
            Export Data
          </Button>
          <Button variant="outline" className="w-full">
            Clear Cache
          </Button>
          <Button variant="destructive" className="w-full">
            Reset All Settings
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};