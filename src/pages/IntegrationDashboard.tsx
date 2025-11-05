import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  RefreshCw,
  Database,
  Sparkles,
  Github,
  BarChart3
} from "lucide-react";

interface IntegrationStatus {
  name: string;
  status: "success" | "error" | "pending" | "untested";
  message: string;
  icon: any;
}

export default function IntegrationDashboard() {
  const { toast } = useToast();
  const [isChecking, setIsChecking] = useState(false);
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([
    { name: "Supabase Database", status: "untested", message: "Not tested yet", icon: Database },
    { name: "Claude AI Processor", status: "untested", message: "Not tested yet", icon: Sparkles },
    { name: "AI Usage Metrics", status: "untested", message: "Not tested yet", icon: BarChart3 },
    { name: "GitHub Integration", status: "untested", message: "Not tested yet", icon: Github },
  ]);

  const testSupabaseConnection = async (): Promise<IntegrationStatus> => {
    try {
      const { data, error } = await supabase.from('ai_usage_metrics').select('count');
      if (error) throw error;
      return {
        name: "Supabase Database",
        status: "success",
        message: "Connected successfully",
        icon: Database
      };
    } catch (error) {
      return {
        name: "Supabase Database",
        status: "error",
        message: error instanceof Error ? error.message : "Connection failed",
        icon: Database
      };
    }
  };

  const testClaudeAI = async (): Promise<IntegrationStatus> => {
    try {
      const { data, error } = await supabase.functions.invoke('ai-claude-processor', {
        body: {
          prompt: "Say 'Hello' in one word",
          model: "claude-3-5-sonnet-20241022"
        }
      });
      
      if (error) throw error;
      if (!data?.response) throw new Error("No response from Claude AI");
      
      return {
        name: "Claude AI Processor",
        status: "success",
        message: `Response: ${data.response.substring(0, 50)}...`,
        icon: Sparkles
      };
    } catch (error) {
      return {
        name: "Claude AI Processor",
        status: "error",
        message: error instanceof Error ? error.message : "AI test failed",
        icon: Sparkles
      };
    }
  };

  const testAIMetrics = async (): Promise<IntegrationStatus> => {
    try {
      const { data, error } = await supabase
        .from('ai_usage_summary')
        .select('*')
        .limit(1);
      
      if (error) throw error;
      
      return {
        name: "AI Usage Metrics",
        status: "success",
        message: "Metrics tracking operational",
        icon: BarChart3
      };
    } catch (error) {
      return {
        name: "AI Usage Metrics",
        status: "error",
        message: error instanceof Error ? error.message : "Metrics check failed",
        icon: BarChart3
      };
    }
  };

  const testGitHubIntegration = async (): Promise<IntegrationStatus> => {
    // Check if GitHub Actions workflows exist by checking localStorage or settings
    const hasGitHub = localStorage.getItem('github_connected') === 'true';
    
    return {
      name: "GitHub Integration",
      status: hasGitHub ? "success" : "pending",
      message: hasGitHub ? "GitHub connected" : "Connect GitHub for automated workflows",
      icon: Github
    };
  };

  const runAllChecks = async () => {
    setIsChecking(true);
    
    try {
      const results = await Promise.all([
        testSupabaseConnection(),
        testClaudeAI(),
        testAIMetrics(),
        testGitHubIntegration()
      ]);
      
      setIntegrations(results);
      
      const failedCount = results.filter(r => r.status === "error").length;
      const successCount = results.filter(r => r.status === "success").length;
      
      toast({
        title: "Integration Check Complete",
        description: `${successCount} successful, ${failedCount} failed`,
        variant: failedCount > 0 ? "destructive" : "default"
      });
    } catch (error) {
      toast({
        title: "Check Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    } finally {
      setIsChecking(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "success":
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case "error":
        return <XCircle className="h-5 w-5 text-red-500" />;
      case "pending":
        return <RefreshCw className="h-5 w-5 text-yellow-500" />;
      default:
        return <Loader2 className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "success":
        return <Badge variant="default">Active</Badge>;
      case "error":
        return <Badge variant="destructive">Error</Badge>;
      case "pending":
        return <Badge variant="secondary">Pending</Badge>;
      default:
        return <Badge variant="outline">Untested</Badge>;
    }
  };

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Integration Dashboard</h1>
          <p className="text-muted-foreground">
            Monitor and test your CRM integrations
          </p>
        </div>
        <Button 
          onClick={runAllChecks} 
          disabled={isChecking}
          size="lg"
        >
          {isChecking ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Checking...
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              Run Integration Checks
            </>
          )}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {integrations.map((integration) => {
          const Icon = integration.icon;
          return (
            <Card key={integration.name}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className="h-5 w-5" />
                    {integration.name}
                  </div>
                  {getStatusIcon(integration.status)}
                </CardTitle>
                <CardDescription>
                  {getStatusBadge(integration.status)}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {integration.message}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Quick Links</CardTitle>
          <CardDescription>Access integration configuration pages</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button variant="outline" className="w-full justify-start" asChild>
            <a href="/#/settings">
              <Sparkles className="mr-2 h-4 w-4" />
              AI Settings & Testing
            </a>
          </Button>
          <Button variant="outline" className="w-full justify-start" asChild>
            <a href="https://supabase.com/dashboard/project/alxelfrbjzkmtnsulcei" target="_blank">
              <Database className="mr-2 h-4 w-4" />
              Supabase Dashboard
            </a>
          </Button>
          <Button variant="outline" className="w-full justify-start" asChild>
            <a href="https://supabase.com/dashboard/project/alxelfrbjzkmtnsulcei/functions" target="_blank">
              <Sparkles className="mr-2 h-4 w-4" />
              Edge Functions
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
