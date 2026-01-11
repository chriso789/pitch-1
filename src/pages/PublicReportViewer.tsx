import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, Eye, Clock, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { MobilePDFViewer } from '@/components/ui/MobilePDFViewer';
import { isMobileDevice } from '@/utils/mobileDetection';

export default function PublicReportViewer() {
  const { token } = useParams<{ token: string }>();
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  useEffect(() => {
    if (token) {
      loadReport();
    }
  }, [token]);

  const loadReport = async () => {
    try {
      console.log('📄 Loading report with token:', token);

      const { data: reportData, error } = await (supabase as any)
        .from('measurement_reports')
        .select('*')
        .eq('share_token', token)
        .single();

      if (error) throw new Error('Report not found');

      if (reportData.expires_at && new Date(reportData.expires_at) < new Date()) {
        throw new Error('This report link has expired');
      }

      setReport(reportData);

      await (supabase as any).rpc('increment_report_view_count', {
        report_token: token,
      });

      const { data: signedData } = await supabase.storage
        .from(reportData.storage_bucket)
        .createSignedUrl(reportData.storage_path, 3600);

      if (signedData?.signedUrl) {
        setPdfUrl(signedData.signedUrl);
      }
    } catch (error: any) {
      console.error('Failed to load report:', error);
      toast.error(error.message || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!pdfUrl || !token) return;

    try {
      await (supabase as any).rpc('increment_report_download_count', {
        report_token: token,
      });

      const link = document.createElement('a');
      link.href = pdfUrl;
      link.download = report?.file_name || 'measurement-report.pdf';
      link.click();

      toast.success('Report downloaded!');
    } catch (error) {
      console.error('Download failed:', error);
      toast.error('Failed to download report');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading report...</p>
        </div>
      </div>
    );
  }

  if (!report || !pdfUrl) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="p-8 max-w-md text-center">
          <h2 className="text-xl font-semibold mb-2">Report Not Found</h2>
          <p className="text-muted-foreground">
            This report link is invalid or has expired.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold">Roof Measurement Report</h1>
              <p className="text-sm text-muted-foreground">
                {report.property_address || 'Property Report'}
              </p>
            </div>

            <Button onClick={handleDownload}>
              <Download className="h-4 w-4 mr-2" />
              Download PDF
            </Button>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-4 md:py-6">
        <Card className="overflow-hidden">
          <MobilePDFViewer
            url={pdfUrl}
            title={report.property_address || 'Measurement Report'}
            filename={report?.file_name || 'measurement-report.pdf'}
            onDownload={handleDownload}
            className="min-h-[50vh] md:min-h-[70vh]"
          />
        </Card>

        <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <Eye className="h-4 w-4" />
              {report.view_count} views
            </span>
            {report.expires_at && (
              <span className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                Expires: {format(new Date(report.expires_at), 'PPP')}
              </span>
            )}
          </div>
          <span>Report ID: {report.report_id}</span>
        </div>
      </div>
    </div>
  );
}
