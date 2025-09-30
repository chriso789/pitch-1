import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, MapPin, Database, Bell, Save } from "lucide-react";
import { toast } from "@/hooks/use-toast";

export const AuditSettings = () => {
  const [settings, setSettings] = useState({
    locationTracking: true,
    auditContacts: true,
    auditLeads: true,
    auditJobs: true,
    auditProjects: true,
    retentionPeriod: '90',
    securityAlerts: true,
    deleteAlerts: true,
    bulkChangeAlerts: true
  });

  const handleSave = () => {
    // In real implementation, save to database
    toast({
      title: "Settings Saved",
      description: "Audit configuration has been updated",
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Audit System Configuration
          </CardTitle>
          <CardDescription>
            Control what gets tracked and how audit data is retained
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Location Tracking */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <MapPin className="h-5 w-5 text-muted-foreground" />
              <div>
                <Label>Location Tracking</Label>
                <p className="text-sm text-muted-foreground">
                  Capture user location when making changes
                </p>
              </div>
            </div>
            <Switch 
              checked={settings.locationTracking}
              onCheckedChange={(checked) => 
                setSettings(prev => ({ ...prev, locationTracking: checked }))
              }
            />
          </div>

          {/* Tables to Audit */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Database className="h-5 w-5 text-muted-foreground" />
              <Label>Tables to Audit</Label>
            </div>
            <div className="grid grid-cols-2 gap-4 ml-8">
              <div className="flex items-center justify-between">
                <Label htmlFor="audit-contacts">Contacts</Label>
                <Switch 
                  id="audit-contacts"
                  checked={settings.auditContacts}
                  onCheckedChange={(checked) => 
                    setSettings(prev => ({ ...prev, auditContacts: checked }))
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="audit-leads">Pipeline Leads</Label>
                <Switch 
                  id="audit-leads"
                  checked={settings.auditLeads}
                  onCheckedChange={(checked) => 
                    setSettings(prev => ({ ...prev, auditLeads: checked }))
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="audit-jobs">Jobs</Label>
                <Switch 
                  id="audit-jobs"
                  checked={settings.auditJobs}
                  onCheckedChange={(checked) => 
                    setSettings(prev => ({ ...prev, auditJobs: checked }))
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="audit-projects">Projects</Label>
                <Switch 
                  id="audit-projects"
                  checked={settings.auditProjects}
                  onCheckedChange={(checked) => 
                    setSettings(prev => ({ ...prev, auditProjects: checked }))
                  }
                />
              </div>
            </div>
          </div>

          {/* Data Retention */}
          <div className="flex items-center justify-between">
            <div>
              <Label>Data Retention Period</Label>
              <p className="text-sm text-muted-foreground">
                How long to keep audit records
              </p>
            </div>
            <Select 
              value={settings.retentionPeriod}
              onValueChange={(value) => 
                setSettings(prev => ({ ...prev, retentionPeriod: value }))
              }
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30 days</SelectItem>
                <SelectItem value="60">60 days</SelectItem>
                <SelectItem value="90">90 days</SelectItem>
                <SelectItem value="180">180 days</SelectItem>
                <SelectItem value="365">1 year</SelectItem>
                <SelectItem value="forever">Forever</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Security Alerts */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Bell className="h-5 w-5 text-muted-foreground" />
              <Label>Security Alerts</Label>
            </div>
            <div className="space-y-3 ml-8">
              <div className="flex items-center justify-between">
                <Label htmlFor="alert-general">General security alerts</Label>
                <Switch 
                  id="alert-general"
                  checked={settings.securityAlerts}
                  onCheckedChange={(checked) => 
                    setSettings(prev => ({ ...prev, securityAlerts: checked }))
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="alert-delete">Alert on deletions</Label>
                <Switch 
                  id="alert-delete"
                  checked={settings.deleteAlerts}
                  onCheckedChange={(checked) => 
                    setSettings(prev => ({ ...prev, deleteAlerts: checked }))
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="alert-bulk">Alert on bulk changes</Label>
                <Switch 
                  id="alert-bulk"
                  checked={settings.bulkChangeAlerts}
                  onCheckedChange={(checked) => 
                    setSettings(prev => ({ ...prev, bulkChangeAlerts: checked }))
                  }
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-4">
            <Button onClick={handleSave}>
              <Save className="h-4 w-4 mr-2" />
              Save Settings
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};