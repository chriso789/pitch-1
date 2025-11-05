import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, Code, FileText, Bug, Key, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

export const GitHubActionsGuide = () => {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Code className="h-5 w-5" />
            GitHub Actions + Claude AI
          </CardTitle>
          <CardDescription>
            Automated code review, documentation, and bug detection workflows
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <strong>Prerequisites:</strong> GitHub repository connected and workflows created in <code>.github/workflows/</code>
            </AlertDescription>
          </Alert>

          {/* Workflow 1: Code Review */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <h3 className="text-lg font-semibold">1. Automated Code Review</h3>
              <Badge variant="outline">claude-code-review.yml</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Claude AI reviews every pull request for security issues, performance concerns, code quality, and potential bugs.
            </p>
            <div className="bg-muted/50 rounded-lg p-4 space-y-2">
              <p className="text-sm font-medium">Triggers:</p>
              <ul className="text-sm space-y-1 ml-4">
                <li>• Pull requests to <code>main</code> or <code>develop</code></li>
                <li>• Analyzes TypeScript/TSX files only</li>
                <li>• Posts review as PR comment</li>
              </ul>
            </div>
          </div>

          {/* Workflow 2: Documentation */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-500" />
              <h3 className="text-lg font-semibold">2. Auto-Generate Documentation</h3>
              <Badge variant="outline">claude-documentation.yml</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Automatically generates comprehensive technical documentation when code changes are pushed to main.
            </p>
            <div className="bg-muted/50 rounded-lg p-4 space-y-2">
              <p className="text-sm font-medium">Triggers:</p>
              <ul className="text-sm space-y-1 ml-4">
                <li>• Push to <code>main</code> branch</li>
                <li>• Manual trigger via workflow_dispatch</li>
                <li>• Creates/updates <code>docs/DOCUMENTATION.md</code></li>
              </ul>
            </div>
          </div>

          {/* Workflow 3: Bug Detection */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Bug className="h-5 w-5 text-red-500" />
              <h3 className="text-lg font-semibold">3. Bug Detection Scanner</h3>
              <Badge variant="outline">claude-bug-detection.yml</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Deep analysis of code for runtime errors, logic bugs, security vulnerabilities, and memory leaks.
            </p>
            <div className="bg-muted/50 rounded-lg p-4 space-y-2">
              <p className="text-sm font-medium">Triggers:</p>
              <ul className="text-sm space-y-1 ml-4">
                <li>• Weekly schedule (Mondays 9 AM UTC)</li>
                <li>• Push to <code>main</code> or <code>develop</code></li>
                <li>• Pull requests</li>
                <li>• Manual trigger via workflow_dispatch</li>
              </ul>
              <p className="text-sm font-medium mt-3">Actions:</p>
              <ul className="text-sm space-y-1 ml-4">
                <li>• Creates GitHub issues for critical bugs</li>
                <li>• Comments on PRs if issues found</li>
                <li>• Fails build if critical bugs detected</li>
              </ul>
            </div>
          </div>

          {/* Setup Instructions */}
          <div className="border-t pt-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Key className="h-5 w-5" />
              Setup GitHub Secrets
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              Add these secrets to your GitHub repository (Settings → Secrets and variables → Actions):
            </p>
            <div className="space-y-2">
              <div className="bg-muted/50 rounded-lg p-3">
                <code className="text-sm">SUPABASE_URL</code>
                <p className="text-xs text-muted-foreground mt-1">Your Supabase project URL</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3">
                <code className="text-sm">SUPABASE_ANON_KEY</code>
                <p className="text-xs text-muted-foreground mt-1">Your Supabase anon/public key</p>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3 pt-4">
            <Button variant="outline" size="sm" asChild>
              <a 
                href="https://docs.github.com/en/actions/quickstart" 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center gap-2"
              >
                <ExternalLink className="h-4 w-4" />
                GitHub Actions Docs
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a 
                href="https://docs.lovable.dev/features/ai" 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center gap-2"
              >
                <ExternalLink className="h-4 w-4" />
                Lovable AI Docs
              </a>
            </Button>
          </div>

          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <strong>Cost Note:</strong> These workflows use your Lovable AI credits. Monitor usage in Settings → Workspace → Usage.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
};
