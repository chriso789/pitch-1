import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Github, RefreshCw, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

export const GitHubConnectionGuide = () => {
  return (
    <div className="space-y-6">
      {/* Connection Status Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Github className="h-6 w-6 text-primary" />
              </div>
              <div>
                <CardTitle>GitHub Integration</CardTitle>
                <CardDescription>Repository synchronization status</CardDescription>
              </div>
            </div>
            <Badge variant="default" className="bg-green-500/10 text-green-600 border-green-500/20">
              <CheckCircle className="h-3 w-3 mr-1" />
              Connected
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshCw className="h-4 w-4" />
            <span>Bi-directional sync is active. Changes sync automatically between Lovable and GitHub.</span>
          </div>

          <div className="grid gap-3 pt-2">
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div>
                <p className="font-medium text-sm">Push to GitHub</p>
                <p className="text-xs text-muted-foreground">Code changes push automatically</p>
              </div>
              <Badge variant="outline" className="text-green-600">Active</Badge>
            </div>
            
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div>
                <p className="font-medium text-sm">Pull from GitHub</p>
                <p className="text-xs text-muted-foreground">External commits sync to Lovable</p>
              </div>
              <Badge variant="outline" className="text-green-600">Active</Badge>
            </div>
          </div>

          <Button variant="outline" size="sm" asChild className="mt-4">
            <a 
              href="https://docs.lovable.dev/integrations/git-and-github" 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center gap-2"
            >
              <ExternalLink className="h-4 w-4" />
              View Documentation
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};
