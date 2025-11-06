import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { FileText, Download, Mail, TrendingUp, Activity, BarChart3 } from "lucide-react";

export default function ContractReportsDashboard() {
  const { toast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);
  const [reportType, setReportType] = useState<'status' | 'tracking' | 'volume'>('status');
  const [dateFrom, setDateFrom] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return date.toISOString().split('T')[0];
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0]);
  const [sendEmail, setSendEmail] = useState(false);
  const [recipients, setRecipients] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [lastGeneratedUrl, setLastGeneratedUrl] = useState<string | null>(null);

  const handleGenerateReport = async () => {
    setIsGenerating(true);
    setLastGeneratedUrl(null);

    try {
      const { data, error } = await supabase.functions.invoke('generate-contract-reports', {
        body: {
          report_type: reportType,
          from: dateFrom,
          to: dateTo,
          send_email: sendEmail,
          recipients: sendEmail ? recipients.split(',').map(r => r.trim()) : [],
          subject: emailSubject || undefined,
          message: emailMessage || undefined,
        },
      });

      if (error) throw error;

      setLastGeneratedUrl(data.pdf_url);
      
      toast({
        title: "Report Generated",
        description: sendEmail 
          ? `Report generated and sent to ${data.email_results?.length || 0} recipient(s)`
          : "Report generated successfully",
      });
    } catch (error: any) {
      console.error('Report generation error:', error);
      toast({
        title: "Generation Failed",
        description: error.message || "Failed to generate report",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const reportTypeInfo = {
    status: {
      icon: <BarChart3 className="h-5 w-5" />,
      title: "Contract Status Report",
      description: "Overview of all contract statuses with completion metrics",
    },
    tracking: {
      icon: <Activity className="h-5 w-5" />,
      title: "Contract Tracking Report",
      description: "Detailed audit trail of all contract activities and events",
    },
    volume: {
      icon: <TrendingUp className="h-5 w-5" />,
      title: "Contract Volume Report",
      description: "Daily volume statistics and completion trends",
    },
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Contract Reports</h1>
          <p className="text-muted-foreground">
            Generate comprehensive contract analytics and tracking reports
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="p-6 hover:shadow-lg transition-shadow cursor-pointer" onClick={() => setReportType('status')}>
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-lg bg-primary/10 text-primary">
              <BarChart3 className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold mb-1">Status Report</h3>
              <p className="text-sm text-muted-foreground">Contract status breakdown with metrics</p>
            </div>
          </div>
        </Card>

        <Card className="p-6 hover:shadow-lg transition-shadow cursor-pointer" onClick={() => setReportType('tracking')}>
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-lg bg-primary/10 text-primary">
              <Activity className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold mb-1">Tracking Report</h3>
              <p className="text-sm text-muted-foreground">Detailed activity audit trail</p>
            </div>
          </div>
        </Card>

        <Card className="p-6 hover:shadow-lg transition-shadow cursor-pointer" onClick={() => setReportType('volume')}>
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-lg bg-primary/10 text-primary">
              <TrendingUp className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold mb-1">Volume Report</h3>
              <p className="text-sm text-muted-foreground">Daily volume and trends</p>
            </div>
          </div>
        </Card>
      </div>

      <Card className="p-6">
        <Tabs defaultValue="configure">
          <TabsList className="mb-6">
            <TabsTrigger value="configure">Configure Report</TabsTrigger>
            <TabsTrigger value="delivery">Email Delivery</TabsTrigger>
          </TabsList>

          <TabsContent value="configure" className="space-y-6">
            <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
              <div className="text-primary">{reportTypeInfo[reportType].icon}</div>
              <div className="flex-1">
                <h3 className="font-semibold">{reportTypeInfo[reportType].title}</h3>
                <p className="text-sm text-muted-foreground">{reportTypeInfo[reportType].description}</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <Label htmlFor="report-type">Report Type</Label>
                <Select value={reportType} onValueChange={(value: any) => setReportType(value)}>
                  <SelectTrigger id="report-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="status">Contract Status Report</SelectItem>
                    <SelectItem value="tracking">Contract Tracking Report</SelectItem>
                    <SelectItem value="volume">Contract Volume Report</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="date-from">From Date</Label>
                  <Input
                    id="date-from"
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="date-to">To Date</Label>
                  <Input
                    id="date-to"
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="delivery" className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label htmlFor="send-email">Email Report</Label>
                <p className="text-sm text-muted-foreground">Send the generated report via email</p>
              </div>
              <Switch
                id="send-email"
                checked={sendEmail}
                onCheckedChange={setSendEmail}
              />
            </div>

            {sendEmail && (
              <div className="space-y-4">
                <div>
                  <Label htmlFor="recipients">Recipients (comma-separated)</Label>
                  <Input
                    id="recipients"
                    type="text"
                    placeholder="email1@example.com, email2@example.com"
                    value={recipients}
                    onChange={(e) => setRecipients(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="email-subject">Email Subject (optional)</Label>
                  <Input
                    id="email-subject"
                    type="text"
                    placeholder="Contract Report - [Date Range]"
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="email-message">Email Message (optional)</Label>
                  <Textarea
                    id="email-message"
                    placeholder="Your contract report is ready..."
                    value={emailMessage}
                    onChange={(e) => setEmailMessage(e.target.value)}
                    rows={4}
                  />
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <div className="mt-6 flex items-center gap-4">
          <Button
            onClick={handleGenerateReport}
            disabled={isGenerating || (sendEmail && !recipients)}
            className="flex-1"
            size="lg"
          >
            <FileText className="mr-2 h-4 w-4" />
            {isGenerating ? "Generating..." : "Generate Report"}
          </Button>

          {lastGeneratedUrl && (
            <Button
              variant="outline"
              size="lg"
              asChild
            >
              <a href={lastGeneratedUrl} target="_blank" rel="noopener noreferrer">
                <Download className="mr-2 h-4 w-4" />
                Download
              </a>
            </Button>
          )}
        </div>

        {lastGeneratedUrl && (
          <div className="mt-4 p-4 bg-muted rounded-lg">
            <div className="flex items-start gap-3">
              <FileText className="h-5 w-5 text-primary mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium mb-1">Report Generated Successfully</p>
                <p className="text-xs text-muted-foreground break-all">{lastGeneratedUrl}</p>
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
