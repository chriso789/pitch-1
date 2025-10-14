import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, FileText, Package, Download, Mail, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ProfessionalTemplatesDialogProps {
  open: boolean;
  onClose: () => void;
  jobId?: string;
  leadId?: string;
}

const PHOTO_REPORTS = [
  {
    slug: 'asphalt-photo-report',
    title: 'Asphalt Shingle Report',
    description: 'Comprehensive inspection report for asphalt shingle roofs',
    icon: FileText
  },
  {
    slug: 'scs-photo-report',
    title: 'Stone-Coated Steel Report',
    description: 'Inspection report for Worthouse and stone-coated steel products',
    icon: FileText
  },
  {
    slug: 'concrete-tile-photo-report',
    title: 'Concrete Tile Report',
    description: 'Detailed concrete tile roof inspection report',
    icon: FileText
  },
  {
    slug: 'metal-photo-report',
    title: 'Metal Roofing Report',
    description: 'Inspection report for exposed and hidden fastener metal roofs',
    icon: FileText
  }
];

const ROOF_TYPES = [
  { value: 'asphalt_shingle', label: 'Asphalt Shingle' },
  { value: 'stone_coated_steel', label: 'Stone-Coated Steel' },
  { value: 'concrete_tile', label: 'Concrete Tile' },
  { value: 'metal_exposed', label: 'Metal (Exposed)' },
  { value: 'metal_hidden', label: 'Metal (Hidden)' }
];

export function ProfessionalTemplatesDialog({ open, onClose, jobId, leadId }: ProfessionalTemplatesDialogProps) {
  const [loading, setLoading] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [selectedRoofType, setSelectedRoofType] = useState('asphalt_shingle');
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailRecipient, setEmailRecipient] = useState("");
  const [emailMessage, setEmailMessage] = useState("Thank you for meeting with us. Please find your report attached.");

  const handleGenerate = async (slug: string) => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error('Please sign in to generate reports');
        return;
      }

      const payload = {
        slug,
        job_id: jobId || null,
        lead_id: leadId || null,
        extra: {
          roof_type: selectedRoofType,
          inspector_name: session.user.user_metadata?.first_name || 'Roofing Specialist'
        },
        save_instance: true
      };

      const response = await supabase.functions.invoke('smart-docs-renderer', {
        body: payload
      });

      if (response.error) throw response.error;

      setPreviewHtml(response.data.html);
      setInstanceId(response.data.instance_id);
      toast.success('Report generated successfully');
    } catch (error) {
      console.error('Error generating report:', error);
      toast.error('Failed to generate report');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateGBB = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error('Please sign in to generate recommendations');
        return;
      }

      const payload = {
        slug: 'gbb-roofing-options',
        job_id: jobId || null,
        lead_id: leadId || null,
        extra: {
          roof_type: selectedRoofType
        },
        save_instance: true
      };

      const response = await supabase.functions.invoke('smart-docs-renderer', {
        body: payload
      });

      if (response.error) throw response.error;

      setPreviewHtml(response.data.html);
      setInstanceId(response.data.instance_id);
      toast.success('Recommendations generated successfully');
    } catch (error) {
      console.error('Error generating GBB:', error);
      toast.error('Failed to generate recommendations');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadPDF = async () => {
    if (!previewHtml || !instanceId) {
      toast.error('No document to download');
      return;
    }

    try {
      setLoading(true);
      
      const { data, error } = await supabase.functions.invoke('smart-docs-pdf', {
        body: {
          instance_id: instanceId,
          upload: 'signed',
          filename: `report-${new Date().toISOString().split('T')[0]}.pdf`
        }
      });

      if (error) throw error;

      // Open PDF in new tab
      window.open(data.pdf_url, '_blank');
      
      toast.success('PDF generated successfully');
    } catch (error) {
      console.error('PDF generation error:', error);
      toast.error('Failed to generate PDF');
    } finally {
      setLoading(false);
    }
  };

  const handleEmail = () => {
    setEmailDialogOpen(true);
  };

  const handleSendEmail = async () => {
    if (!emailRecipient || !instanceId) {
      toast.error('Please enter a valid email address');
      return;
    }

    try {
      setLoading(true);
      
      const { data, error } = await supabase.functions.invoke('smart-docs-pdf', {
        body: {
          instance_id: instanceId,
          upload: 'signed',
          filename: `report-${new Date().toISOString().split('T')[0]}.pdf`,
          to_email: emailRecipient,
          subject: 'Your Roofing Report',
          message: emailMessage,
          attach: false
        }
      });

      if (error) throw error;
      
      toast.success(`PDF sent to ${emailRecipient}`);
      
      setEmailDialogOpen(false);
      setEmailRecipient("");
    } catch (error) {
      console.error('Email error:', error);
      toast.error('Failed to send email');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setPreviewHtml(null);
    setInstanceId(null);
    onClose();
  };

  if (previewHtml) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>Report Preview</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={handleDownloadPDF}>
                  <Download className="mr-2 h-4 w-4" />
                  Download PDF
                </Button>
                <Button size="sm" variant="outline" onClick={handleEmail}>
                  <Mail className="mr-2 h-4 w-4" />
                  Email
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPreviewHtml(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="h-[70vh] border rounded-lg p-6 bg-white">
            <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </ScrollArea>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Professional Templates</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="photo-reports" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="photo-reports">Photo Reports</TabsTrigger>
            <TabsTrigger value="gbb-options">Good/Better/Best</TabsTrigger>
          </TabsList>

          <TabsContent value="photo-reports" className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {PHOTO_REPORTS.map((report) => (
                <Card key={report.slug} className="cursor-pointer hover:shadow-lg transition-shadow">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <report.icon className="h-8 w-8 text-primary" />
                      <Button
                        size="sm"
                        onClick={() => handleGenerate(report.slug)}
                        disabled={loading}
                      >
                        {loading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          'Generate'
                        )}
                      </Button>
                    </div>
                    <CardTitle className="text-lg">{report.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription>{report.description}</CardDescription>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="gbb-options" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Good/Better/Best Options</CardTitle>
                <CardDescription>
                  Generate product recommendations in three tiers
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">Roof Type</label>
                  <Select value={selectedRoofType} onValueChange={setSelectedRoofType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROOF_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  className="w-full"
                  onClick={handleGenerateGBB}
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Package className="mr-2 h-4 w-4" />
                      Generate Recommendations
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </DialogContent>

      {/* Email Dialog */}
      <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send PDF via Email</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium">Recipient Email</label>
              <Input
                type="email"
                placeholder="customer@example.com"
                value={emailRecipient}
                onChange={(e) => setEmailRecipient(e.target.value)}
                className="mt-2"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Message</label>
              <Textarea
                placeholder="Optional message..."
                value={emailMessage}
                onChange={(e) => setEmailMessage(e.target.value)}
                rows={4}
                className="mt-2"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSendEmail} disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                'Send Email'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
