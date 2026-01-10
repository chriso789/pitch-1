/**
 * Portal Global Settings Component
 * Company-wide default settings for the homeowner portal
 */

import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Shield, Bell, Clock, Eye } from "lucide-react";

export const PortalGlobalSettings: React.FC = () => {
  return (
    <div className="space-y-6">
      {/* Default Permissions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Shield className="h-5 w-5" />
            Default Permissions
          </CardTitle>
          <CardDescription>
            Set default permissions for new portal users. Individual user
            permissions can be customized later.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="default_status" className="text-sm">
                View Project Status
              </Label>
              <Switch id="default_status" defaultChecked />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="default_timeline" className="text-sm">
                View Timeline
              </Label>
              <Switch id="default_timeline" defaultChecked />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="default_photos" className="text-sm">
                View Photos
              </Label>
              <Switch id="default_photos" defaultChecked />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="default_documents" className="text-sm">
                View Documents
              </Label>
              <Switch id="default_documents" defaultChecked />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="default_download" className="text-sm">
                Download Documents
              </Label>
              <Switch id="default_download" defaultChecked />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="default_estimates" className="text-sm">
                View Estimates
              </Label>
              <Switch id="default_estimates" />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="default_payments" className="text-sm">
                View Payments
              </Label>
              <Switch id="default_payments" defaultChecked />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="default_messages" className="text-sm">
                Send Messages
              </Label>
              <Switch id="default_messages" defaultChecked />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="default_change_orders" className="text-sm">
                Approve Change Orders
              </Label>
              <Switch id="default_change_orders" defaultChecked />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="default_ai" className="text-sm">
                AI Chat Access
              </Label>
              <Switch id="default_ai" defaultChecked />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Session Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Clock className="h-5 w-5" />
            Session Settings
          </CardTitle>
          <CardDescription>
            Control how long portal sessions remain active.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Session Timeout</Label>
              <p className="text-xs text-muted-foreground">
                How long before sessions expire
              </p>
            </div>
            <Select defaultValue="7">
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 day</SelectItem>
                <SelectItem value="7">7 days</SelectItem>
                <SelectItem value="14">14 days</SelectItem>
                <SelectItem value="30">30 days</SelectItem>
                <SelectItem value="90">90 days</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">
                Re-authenticate on Inactivity
              </Label>
              <p className="text-xs text-muted-foreground">
                Require re-login after 24 hours of inactivity
              </p>
            </div>
            <Switch />
          </div>
        </CardContent>
      </Card>

      {/* Notification Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Bell className="h-5 w-5" />
            Notifications
          </CardTitle>
          <CardDescription>
            Get notified about homeowner portal activity.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Login Notifications</Label>
              <p className="text-xs text-muted-foreground">
                Notify assigned rep when homeowner logs in
              </p>
            </div>
            <Switch defaultChecked />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Message Notifications</Label>
              <p className="text-xs text-muted-foreground">
                Notify team when homeowner sends a message
              </p>
            </div>
            <Switch defaultChecked />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">
                Change Order Approval
              </Label>
              <p className="text-xs text-muted-foreground">
                Notify when homeowner approves a change order
              </p>
            </div>
            <Switch defaultChecked />
          </div>
        </CardContent>
      </Card>

      {/* Visibility Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Eye className="h-5 w-5" />
            Content Visibility
          </CardTitle>
          <CardDescription>
            Control what content is visible in the portal by default.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">
                Auto-share Progress Photos
              </Label>
              <p className="text-xs text-muted-foreground">
                Automatically show new progress photos in portal
              </p>
            </div>
            <Switch defaultChecked />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">
                Require Document Approval
              </Label>
              <p className="text-xs text-muted-foreground">
                Documents must be marked visible before homeowners can see them
              </p>
            </div>
            <Switch defaultChecked />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">
                Show Company Contact Info
              </Label>
              <p className="text-xs text-muted-foreground">
                Display company phone and email in portal header
              </p>
            </div>
            <Switch defaultChecked />
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
