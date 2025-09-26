import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Building, Phone, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface CallerIdSettings {
  company_name: string;
  phone_number: string;
  display_name: string;
}

export const TenantCallerIdConfig: React.FC = () => {
  const [settings, setSettings] = useState<CallerIdSettings>({
    company_name: "O'Brien Contracting",
    phone_number: "+1-555-OBRIEN",
    display_name: "O'Brien Contracting"
  });
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadCallerIdSettings();
  }, []);

  const loadCallerIdSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('app_settings')
        .select('setting_value')
        .eq('setting_key', 'caller_id_config')
        .maybeSingle();

      if (error && error.code !== 'PGRST116') throw error;
      
      if (data?.setting_value) {
        setSettings(data.setting_value as unknown as CallerIdSettings);
      }
    } catch (error) {
      console.error('Error loading caller ID settings:', error);
    }
  };

  const saveCallerIdSettings = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // For now, store in localStorage until proper database setup
      try {
        localStorage.setItem('caller_id_config', JSON.stringify(settings));
        
        toast({
          title: "Settings Saved",
          description: "Caller ID configuration updated successfully",
        });
      } catch (error) {
        console.error('Error saving caller ID settings:', error);
        toast({
          title: "Error",
          description: "Failed to save caller ID settings",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Error saving caller ID settings:', error);
      toast({
        title: "Error",
        description: "Failed to save caller ID settings",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building className="h-5 w-5 text-primary" />
          Caller ID Configuration
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="company_name">Company Name</Label>
            <Input
              id="company_name"
              value={settings.company_name}
              onChange={(e) => setSettings(prev => ({ ...prev, company_name: e.target.value }))}
              placeholder="Your Company Name"
            />
          </div>
          <div>
            <Label htmlFor="display_name">Display Name</Label>
            <Input
              id="display_name"
              value={settings.display_name}
              onChange={(e) => setSettings(prev => ({ ...prev, display_name: e.target.value }))}
              placeholder="Display Name"
            />
          </div>
        </div>
        
        <div>
          <Label htmlFor="phone_number">Phone Number</Label>
          <div className="flex gap-2">
            <Phone className="h-4 w-4 mt-3 text-muted-foreground" />
            <Input
              id="phone_number"
              value={settings.phone_number}
              onChange={(e) => setSettings(prev => ({ ...prev, phone_number: e.target.value }))}
              placeholder="+1-555-123-4567"
            />
          </div>
        </div>

        <div className="bg-muted/30 p-4 rounded-lg">
          <h4 className="font-medium mb-2">Preview:</h4>
          <div className="text-sm text-muted-foreground">
            Outbound calls will display: <strong>{settings.display_name}</strong> ({settings.phone_number})
          </div>
        </div>

        <Button onClick={saveCallerIdSettings} disabled={loading} className="w-full">
          <Save className="h-4 w-4 mr-2" />
          {loading ? "Saving..." : "Save Caller ID Settings"}
        </Button>
      </CardContent>
    </Card>
  );
};

export default TenantCallerIdConfig;