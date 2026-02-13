import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GitHubConnectionGuide } from "./GitHubConnectionGuide";
import { AIUsageDashboard } from "./AIUsageDashboard";
import { TelnyxIntegrationPanel } from "./TelnyxIntegrationPanel";
import { SessionActivityLog } from "./SessionActivityLog";
import { MeasurementCorrectionsLog } from "./MeasurementCorrectionsLog";
import { ApiKeyManager } from "./ApiKeyManager";
import { WebsiteIntegration } from "./WebsiteIntegration";
import { SLAPolicyManager } from "./SLAPolicyManager";
import { RoutingRulesManager } from "./RoutingRulesManager";
import { SmsAutoResponseConfig } from "./SmsAutoResponseConfig";
import { Github, BarChart3, Phone, Shield, Ruler, Key, Globe, Clock, Route, MessageSquare } from "lucide-react";

export const IntegrationsSettings = () => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Integrations</h2>
        <p className="text-muted-foreground">
          Connect external services and manage API integrations
        </p>
      </div>

      <Tabs defaultValue="api-keys" className="space-y-6">
        <TabsList className="flex-wrap">
          <TabsTrigger value="api-keys" className="flex items-center gap-2">
            <Key className="h-4 w-4" />
            API Keys
          </TabsTrigger>
          <TabsTrigger value="website" className="flex items-center gap-2">
            <Globe className="h-4 w-4" />
            Website Integration
          </TabsTrigger>
          <TabsTrigger value="sla-policies" className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            SLA Policies
          </TabsTrigger>
          <TabsTrigger value="routing-rules" className="flex items-center gap-2">
            <Route className="h-4 w-4" />
            Routing Rules
          </TabsTrigger>
          <TabsTrigger value="telnyx" className="flex items-center gap-2">
            <Phone className="h-4 w-4" />
            Telnyx
          </TabsTrigger>
          <TabsTrigger value="sms-auto" className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            SMS Auto-Reply
          </TabsTrigger>
          <TabsTrigger value="ai-analytics" className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            AI Analytics
          </TabsTrigger>
          <TabsTrigger value="github" className="flex items-center gap-2">
            <Github className="h-4 w-4" />
            GitHub
          </TabsTrigger>
          <TabsTrigger value="session-activity" className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Session Activity
          </TabsTrigger>
          <TabsTrigger value="measurement-corrections" className="flex items-center gap-2">
            <Ruler className="h-4 w-4" />
            AI Corrections
          </TabsTrigger>
        </TabsList>

        <TabsContent value="api-keys" className="space-y-6">
          <ApiKeyManager />
        </TabsContent>

        <TabsContent value="website" className="space-y-6">
          <WebsiteIntegration />
        </TabsContent>

        <TabsContent value="sla-policies" className="space-y-6">
          <SLAPolicyManager />
        </TabsContent>

        <TabsContent value="routing-rules" className="space-y-6">
          <RoutingRulesManager />
        </TabsContent>

        <TabsContent value="telnyx" className="space-y-6">
          <TelnyxIntegrationPanel />
        </TabsContent>

        <TabsContent value="sms-auto" className="space-y-6">
          <SmsAutoResponseConfig />
        </TabsContent>

        <TabsContent value="ai-analytics" className="space-y-6">
          <AIUsageDashboard />
        </TabsContent>

        <TabsContent value="github" className="space-y-6">
          <GitHubConnectionGuide />
        </TabsContent>

        <TabsContent value="session-activity" className="space-y-6">
          <SessionActivityLog />
        </TabsContent>

        <TabsContent value="measurement-corrections" className="space-y-6">
          <MeasurementCorrectionsLog />
        </TabsContent>
      </Tabs>
    </div>
  );
};
