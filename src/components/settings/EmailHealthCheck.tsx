import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Mail, Send, CheckCircle, XCircle, Loader2, AlertTriangle, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface TestResult {
  success: boolean;
  message: string;
  timestamp: Date;
  details?: string;
}

export const EmailHealthCheck = () => {
  const [testEmail, setTestEmail] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const { toast } = useToast();

  const sendTestEmail = async () => {
    if (!testEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail)) {
      toast({
        title: "Invalid Email",
        description: "Please enter a valid email address",
        variant: "destructive",
      });
      return;
    }

    setIsSending(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('send-email', {
        body: {
          to: [testEmail],
          subject: "PITCH CRM - Email Configuration Test",
          body: `
            <h2>Email Configuration Test</h2>
            <p>This is a test email from PITCH CRM to verify your email configuration is working correctly.</p>
            <p><strong>Sent at:</strong> ${new Date().toLocaleString()}</p>
            <hr/>
            <p style="color: #666; font-size: 12px;">If you received this email, your email configuration is working properly.</p>
          `
        }
      });

      if (error) {
        throw new Error(error.message || 'Failed to send test email');
      }

      // Check if response indicates success
      const isSuccess = data && !data.error;
      
      const result: TestResult = {
        success: isSuccess,
        message: isSuccess ? `Test email sent to ${testEmail}` : `Failed: ${data?.error?.message || 'Unknown error'}`,
        timestamp: new Date(),
        details: JSON.stringify(data, null, 2)
      };

      setTestResults(prev => [result, ...prev.slice(0, 4)]);

      if (isSuccess) {
        toast({
          title: "Test Email Sent",
          description: `Check ${testEmail} for the test email`,
        });
      } else {
        toast({
          title: "Email Send Failed",
          description: data?.error?.message || "Check the results below for details",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Error sending test email:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      const result: TestResult = {
        success: false,
        message: `Error: ${errorMessage}`,
        timestamp: new Date(),
        details: errorMessage
      };

      setTestResults(prev => [result, ...prev.slice(0, 4)]);

      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-primary" />
          Email Health Check
        </CardTitle>
        <CardDescription>
          Test your email configuration and verify emails are being sent correctly
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Configuration Status */}
        <div className="p-4 border rounded-lg bg-muted/30">
          <h4 className="font-medium flex items-center gap-2 mb-3">
            <Info className="h-4 w-4 text-muted-foreground" />
            Configuration Checklist
          </h4>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span>RESEND_API_KEY configured</span>
            </div>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
              <span>RESEND_FROM_DOMAIN should be: <code className="bg-muted px-1 rounded">obriencontractingusa.com</code></span>
            </div>
            <p className="text-muted-foreground mt-2">
              If emails are failing with "Invalid from field", update the RESEND_FROM_DOMAIN secret to your verified domain (not the API key).
            </p>
          </div>
        </div>

        <Separator />

        {/* Test Email Form */}
        <div className="space-y-4">
          <h4 className="font-medium">Send Test Email</h4>
          <div className="flex gap-3">
            <div className="flex-1">
              <Label htmlFor="test-email" className="sr-only">Test Email Address</Label>
              <Input
                id="test-email"
                type="email"
                placeholder="Enter email address to test..."
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendTestEmail()}
              />
            </div>
            <Button onClick={sendTestEmail} disabled={isSending}>
              {isSending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send Test
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Test Results */}
        {testResults.length > 0 && (
          <>
            <Separator />
            <div className="space-y-3">
              <h4 className="font-medium">Recent Test Results</h4>
              <div className="space-y-2">
                {testResults.map((result, index) => (
                  <div
                    key={index}
                    className={`p-3 rounded-lg border ${
                      result.success 
                        ? 'bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-900' 
                        : 'bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-900'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {result.success ? (
                        <CheckCircle className="h-4 w-4 text-green-600 mt-0.5" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-600 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{result.message}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {result.timestamp.toLocaleString()}
                        </p>
                        {result.details && !result.success && (
                          <pre className="mt-2 text-xs bg-background/50 p-2 rounded overflow-x-auto">
                            {result.details}
                          </pre>
                        )}
                      </div>
                      <Badge variant={result.success ? "default" : "destructive"}>
                        {result.success ? "Success" : "Failed"}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
