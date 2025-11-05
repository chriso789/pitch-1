import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GitHubConnectionGuide } from "./GitHubConnectionGuide";
import { ClaudeAITester } from "./ClaudeAITester";
import { GitHubActionsGuide } from "./GitHubActionsGuide";
import { Github, Sparkles, Workflow } from "lucide-react";

export const IntegrationsSettings = () => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Integrations</h2>
        <p className="text-muted-foreground">
          Connect external services and test AI integrations
        </p>
      </div>

      <Tabs defaultValue="github" className="space-y-6">
        <TabsList>
          <TabsTrigger value="github" className="flex items-center gap-2">
            <Github className="h-4 w-4" />
            GitHub Connection
          </TabsTrigger>
          <TabsTrigger value="github-actions" className="flex items-center gap-2">
            <Workflow className="h-4 w-4" />
            GitHub Actions
          </TabsTrigger>
          <TabsTrigger value="claude-ai" className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Claude AI Testing
          </TabsTrigger>
        </TabsList>

        <TabsContent value="github" className="space-y-6">
          <GitHubConnectionGuide />
        </TabsContent>

        <TabsContent value="github-actions" className="space-y-6">
          <GitHubActionsGuide />
        </TabsContent>

        <TabsContent value="claude-ai" className="space-y-6">
          <ClaudeAITester />
        </TabsContent>
      </Tabs>
    </div>
  );
};
