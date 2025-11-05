import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Github, CheckCircle2, ExternalLink, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const GitHubConnectionGuide = () => {
  const steps = [
    {
      number: 1,
      title: "Connect to GitHub",
      description: "Click the GitHub button in the top-right corner of the Lovable editor",
      action: "Look for the GitHub icon",
    },
    {
      number: 2,
      title: "Authorize Lovable",
      description: "Select 'Connect to GitHub' and authorize the Lovable GitHub App when prompted",
      action: "Grant permissions",
    },
    {
      number: 3,
      title: "Select Account",
      description: "Choose which GitHub account or organization to use for your repository",
      action: "Pick your account",
    },
    {
      number: 4,
      title: "Create Repository",
      description: "Click 'Create Repository' in Lovable to push your entire CRM codebase to GitHub",
      action: "Create repo",
    },
    {
      number: 5,
      title: "Verify Connection",
      description: "Check your GitHub account - you should see a new repository with all your CRM code",
      action: "Confirm sync",
    },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Github className="h-8 w-8" />
            <div>
              <CardTitle>Connect to GitHub</CardTitle>
              <CardDescription>
                Set up bidirectional sync between Lovable and GitHub in 5 minutes
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Your API keys and secrets in .env are NOT pushed to GitHub for security.
              Only your code is synchronized.
            </AlertDescription>
          </Alert>

          <div className="space-y-4">
            {steps.map((step) => (
              <div key={step.number} className="flex gap-4">
                <div className="flex-shrink-0">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground font-semibold">
                    {step.number}
                  </div>
                </div>
                <div className="flex-1 space-y-1">
                  <h4 className="font-semibold">{step.title}</h4>
                  <p className="text-sm text-muted-foreground">{step.description}</p>
                  <p className="text-xs text-primary font-medium">{step.action}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-muted p-4 rounded-lg space-y-3">
            <h4 className="font-semibold flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              What You Get
            </h4>
            <ul className="text-sm space-y-2 ml-6">
              <li className="list-disc">✅ Changes in Lovable automatically push to GitHub</li>
              <li className="list-disc">✅ Changes pushed to GitHub automatically sync to Lovable</li>
              <li className="list-disc">✅ All 15 modules and 114 edge functions included</li>
              <li className="list-disc">✅ Full version history on GitHub</li>
              <li className="list-disc">✅ Clone repo locally for backups</li>
              <li className="list-disc">✅ Set up GitHub Actions for CI/CD</li>
            </ul>
          </div>

          <div className="flex gap-3">
            <Button asChild className="flex-1">
              <a href="https://docs.lovable.dev" target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4 mr-2" />
                View Documentation
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Important Notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">One Account Limit</p>
              <p className="text-muted-foreground">
                Only ONE GitHub account can be connected to a Lovable account at a time
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Security First</p>
              <p className="text-muted-foreground">
                Environment variables and API keys stay secure - they're never pushed to GitHub
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Real-time Sync</p>
              <p className="text-muted-foreground">
                Both directions sync automatically - no manual push/pull required
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
