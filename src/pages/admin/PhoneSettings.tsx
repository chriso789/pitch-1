import React from "react";
import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { PhoneProvisioningPanel } from "@/components/admin/PhoneProvisioningPanel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Phone, Settings } from "lucide-react";

const PhoneSettings = () => {
  return (
    <GlobalLayout>
      <div className="space-y-6">
        <div>
          <div className="flex items-center gap-2">
            <Phone className="h-6 w-6" />
            <h1 className="text-2xl font-bold">Phone Settings</h1>
            <Badge variant="secondary">Admin</Badge>
          </div>
          <p className="text-muted-foreground mt-1">
            Manage Telnyx phone numbers for SMS and voice communications
          </p>
        </div>

        <PhoneProvisioningPanel />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              How It Works
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              <strong>1. Click "Provision Number"</strong> to search for available phone numbers in your location's area code.
            </p>
            <p>
              <strong>2. Auto-Selection</strong> - The system automatically picks the catchiest number, prioritizing:
            </p>
            <ul className="list-disc list-inside ml-4 space-y-1">
              <li>Numbers ending in <strong>7663</strong> (spells ROOF)</li>
              <li>Repeating patterns (555-1111, 888-0000)</li>
              <li>Sequential numbers (234-5678)</li>
              <li>Easy-to-remember combinations</li>
            </ul>
            <p>
              <strong>3. One-Click Setup</strong> - The number is automatically configured for both SMS and Voice calls.
            </p>
            <p>
              <strong>4. Location-Based Routing</strong> - SMS and calls are automatically routed through the appropriate location's number based on user settings.
            </p>
          </CardContent>
        </Card>
      </div>
    </GlobalLayout>
  );
};

export default PhoneSettings;
