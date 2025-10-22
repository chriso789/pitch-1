import { useState } from "react";
import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HelpCircle, Mail, FileText, Video, Play } from "lucide-react";
import { VideoWalkthrough } from "@/shared/components/VideoWalkthrough";

const HelpPage = () => {
  const [showWalkthrough, setShowWalkthrough] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSection, setCurrentSection] = useState("dashboard");

  if (showWalkthrough) {
    return (
      <GlobalLayout>
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">Product Walkthrough</h1>
              <p className="text-muted-foreground mt-2">Comprehensive tour of PITCH CRM features</p>
            </div>
            <Button variant="outline" onClick={() => setShowWalkthrough(false)}>
              Back to Help
            </Button>
          </div>
          <VideoWalkthrough
            onSectionChange={setCurrentSection}
            isPlaying={isPlaying}
            onPlayingChange={setIsPlaying}
          />
        </div>
      </GlobalLayout>
    );
  }

  return (
    <GlobalLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Help & Support</h1>
          <p className="text-muted-foreground mt-2">Get assistance and learn how to use the platform</p>
        </div>

        <Card className="bg-gradient-to-br from-primary/10 to-secondary/10 border-primary/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Video className="h-5 w-5" />
              Interactive Product Walkthrough
            </CardTitle>
            <CardDescription>
              New to PITCH CRM? Take our comprehensive guided tour to learn all features
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setShowWalkthrough(true)} size="lg" className="gap-2">
              <Play className="h-5 w-5" />
              Start Walkthrough
            </Button>
          </CardContent>
        </Card>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Documentation
              </CardTitle>
              <CardDescription>
                Browse our comprehensive guides and tutorials
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Learn how to use all features of the platform with step-by-step guides.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Video className="h-5 w-5" />
                Video Tutorials
              </CardTitle>
              <CardDescription>
                Watch video guides for common tasks
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Visual walkthroughs to help you get started quickly.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                Contact Support
              </CardTitle>
              <CardDescription>
                Reach out to our support team
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Get personalized help from our support team via email or chat.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HelpCircle className="h-5 w-5" />
                FAQ
              </CardTitle>
              <CardDescription>
                Find answers to common questions
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Quick answers to frequently asked questions.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </GlobalLayout>
  );
};

export default HelpPage;
