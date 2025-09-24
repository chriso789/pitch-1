import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NotificationAutomations } from "@/components/NotificationAutomations";
import { Settings as SettingsIcon, FileText, Calculator, Users, Building, Shield, Code, Mic, Bell } from "lucide-react";
import { EstimateBuilder } from "./EstimateBuilder";
import { GeneralSettings } from "./settings/GeneralSettings";
import { UserManagement } from "./settings/UserManagement";
import { DeveloperAccess } from "./settings/DeveloperAccess";
import VoiceInterface from "./VoiceInterface";
import { supabase } from "@/integrations/supabase/client";

export const Settings = () => {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCurrentUser();
  }, []);

  const loadCurrentUser = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();
        setCurrentUser(profile);
      }
    } catch (error) {
      console.error('Error loading current user:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="text-center py-8 text-muted-foreground">
          Loading settings...
        </div>
      </div>
    );
  }

  const showDeveloperTab = currentUser?.is_developer || currentUser?.role === 'master';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold gradient-primary bg-clip-text text-transparent">
            Settings
          </h1>
          <p className="text-muted-foreground">
            Configure your system preferences and templates
          </p>
        </div>
        <div className="flex items-center gap-4">
          <VoiceInterface 
            onTranscription={(text) => {
              console.log('Voice transcription:', text);
              // You can add logic here to handle voice commands in settings
            }} 
            className="flex items-center gap-2"
          />
        </div>
      </div>

      <Tabs defaultValue="general" className="space-y-6">
        <TabsList className={`grid w-full ${showDeveloperTab ? 'grid-cols-7' : 'grid-cols-6'}`}>
          <TabsTrigger value="general" className="flex items-center gap-2">
            <SettingsIcon className="h-4 w-4" />
            General
          </TabsTrigger>
          <TabsTrigger value="estimates" className="flex items-center gap-2">
            <Calculator className="h-4 w-4" />
            Estimates
          </TabsTrigger>
          <TabsTrigger value="company" className="flex items-center gap-2">
            <Building className="h-4 w-4" />
            Company
          </TabsTrigger>
          <TabsTrigger value="users" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Users
          </TabsTrigger>
          <TabsTrigger value="security" className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Security
          </TabsTrigger>
          <TabsTrigger value="automations" className="flex items-center gap-2">
            <Bell className="h-4 w-4" />
            Automations
          </TabsTrigger>
          {showDeveloperTab && (
            <TabsTrigger value="developer" className="flex items-center gap-2">
              <Code className="h-4 w-4" />
              Developer
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="general" className="space-y-6">
          <GeneralSettings />
        </TabsContent>

        <TabsContent value="estimates" className="space-y-6">
          <EstimateBuilder />
        </TabsContent>

        <TabsContent value="company" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building className="h-5 w-5 text-primary" />
                Company Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-muted-foreground">
                Company settings coming soon...
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="users" className="space-y-6">
          <UserManagement />
        </TabsContent>

        <TabsContent value="security" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                Security Settings
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-muted-foreground">
                Security settings coming soon...
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="automations" className="space-y-6">
          <NotificationAutomations />
        </TabsContent>

        {showDeveloperTab && (
          <TabsContent value="developer" className="space-y-6">
            <DeveloperAccess />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
};