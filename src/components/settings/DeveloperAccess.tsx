import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, Code, Building, AlertTriangle, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Tenant {
  id: string;
  name: string;
  subdomain: string;
}

export const DeveloperAccess = () => {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<string>("");
  const [isDeveloperMode, setIsDeveloperMode] = useState(false);
  const [currentTenant, setCurrentTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    loadCurrentUser();
    loadTenants();
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
        setIsDeveloperMode(profile?.is_developer || false);
      }
    } catch (error) {
      console.error('Error loading current user:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadTenants = async () => {
    try {
      const { data, error } = await supabase
        .from('tenants')
        .select('*')
        .order('name');

      if (error) throw error;
      setTenants(data || []);
    } catch (error) {
      console.error('Error loading tenants:', error);
    }
  };

  const switchTenant = async (tenantId: string) => {
    try {
      // Call the switch context function
      const { error } = await supabase.rpc('switch_developer_context', {
        target_tenant_id: tenantId
      });

      if (error) throw error;

      const tenant = tenants.find(t => t.id === tenantId);
      setCurrentTenant(tenant || null);
      setSelectedTenant(tenantId);

      toast({
        title: "Context Switched",
        description: `Now viewing ${tenant?.name || 'selected tenant'} data.`,
      });

      // Refresh the page to update all data contexts
      window.location.reload();
    } catch (error) {
      console.error('Error switching tenant:', error);
      toast({
        title: "Access Denied",
        description: "You don't have permission to access this tenant.",
        variant: "destructive",
      });
    }
  };

  const toggleDeveloperMode = async (enabled: boolean) => {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ is_developer: enabled })
        .eq('id', currentUser?.id);

      if (error) throw error;

      setIsDeveloperMode(enabled);
      setCurrentUser({ ...currentUser, is_developer: enabled });

      toast({
        title: enabled ? "Developer Mode Enabled" : "Developer Mode Disabled",
        description: enabled 
          ? "You now have access to developer features." 
          : "Developer features have been disabled.",
      });
    } catch (error) {
      console.error('Error toggling developer mode:', error);
      toast({
        title: "Error",
        description: "Failed to update developer mode.",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center py-8 text-muted-foreground">
            Loading developer settings...
          </div>
        </CardContent>
      </Card>
    );
  }

  // Only show to master/developer users
  if (!currentUser?.is_developer && currentUser?.role !== 'master') {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center py-8 text-muted-foreground">
            <Shield className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
            <p>Developer access is not available for your account.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Developer Mode Toggle */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Code className="h-5 w-5 text-primary" />
            Developer Access Control
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <strong>Security Notice:</strong> Developer mode provides elevated access to system data. 
              Use responsibly and ensure compliance with privacy policies.
            </AlertDescription>
          </Alert>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-base">Developer Mode</Label>
              <div className="text-sm text-muted-foreground">
                Switch between Company Admin and Developer access levels
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Badge variant={isDeveloperMode ? "destructive" : "default"}>
                {isDeveloperMode ? "Developer" : "Company Admin"}
              </Badge>
              <Switch
                checked={isDeveloperMode}
                onCheckedChange={toggleDeveloperMode}
              />
            </div>
          </div>

          {!isDeveloperMode && (
            <div className="p-4 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-2 text-sm text-foreground">
                <Building className="h-4 w-4" />
                <strong>Company Admin Mode:</strong> Limited to {currentUser?.company_name || "your company"} data only
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tenant Switching - Only in Developer Mode */}
      {isDeveloperMode && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5 text-destructive" />
              Tenant Access
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <Alert>
              <Shield className="h-4 w-4" />
              <AlertDescription>
                <strong>Privileged Access:</strong> You can access any company's data. 
                This access is logged and should only be used for legitimate support purposes.
              </AlertDescription>
            </Alert>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-base">Select Company to Access</Label>
                <Select value={selectedTenant} onValueChange={setSelectedTenant}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a company to access..." />
                  </SelectTrigger>
                  <SelectContent>
                    {tenants.map((tenant) => (
                      <SelectItem key={tenant.id} value={tenant.id}>
                        <div className="flex items-center gap-2">
                          <Building className="h-4 w-4" />
                          {tenant.name}
                          {tenant.subdomain && (
                            <span className="text-xs text-muted-foreground">
                              ({tenant.subdomain})
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button 
                onClick={() => switchTenant(selectedTenant)}
                disabled={!selectedTenant}
                variant="destructive"
                className="w-full"
              >
                <Shield className="h-4 w-4 mr-2" />
                Switch to Selected Company
              </Button>

              {currentTenant && (
                <div className="mt-4 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
                  <div className="flex items-center gap-2 text-destructive font-medium">
                    <Eye className="h-4 w-4" />
                    Currently Viewing: {currentTenant.name}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    All data shown is from this company's tenant
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Developer Tools */}
      {isDeveloperMode && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Code className="h-5 w-5 text-primary" />
              Developer Tools
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button variant="outline" className="w-full">
              View System Logs
            </Button>
            <Button variant="outline" className="w-full">
              Database Query Tool
            </Button>
            <Button variant="outline" className="w-full">
              API Documentation
            </Button>
            <Button variant="outline" className="w-full">
              Performance Metrics
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
};