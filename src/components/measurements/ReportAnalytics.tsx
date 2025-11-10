import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Eye, Download, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';

export function ReportAnalytics() {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadReports();
  }, []);

  const loadReports = async () => {
    try {
      const { data, error } = await supabase
        .from('measurement_reports')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setReports(data || []);
    } catch (error) {
      console.error('Failed to load reports:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
      </div>
    );
  }

  return (
    <Card className="p-6">
      <h2 className="text-xl font-semibold mb-4">Report Analytics</h2>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Report ID</TableHead>
            <TableHead>Property</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="text-center">Views</TableHead>
            <TableHead className="text-center">Downloads</TableHead>
            <TableHead>Status</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reports.map((report) => (
            <TableRow key={report.id}>
              <TableCell className="font-mono text-sm">
                {report.report_id}
              </TableCell>
              <TableCell>{report.property_address || '—'}</TableCell>
              <TableCell>{report.customer_name || '—'}</TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {format(new Date(report.created_at), 'MMM d, yyyy')}
              </TableCell>
              <TableCell className="text-center">
                <span className="flex items-center justify-center gap-1">
                  <Eye className="h-4 w-4 text-muted-foreground" />
                  {report.view_count}
                </span>
              </TableCell>
              <TableCell className="text-center">
                <span className="flex items-center justify-center gap-1">
                  <Download className="h-4 w-4 text-muted-foreground" />
                  {report.download_count}
                </span>
              </TableCell>
              <TableCell>
                {report.expires_at && new Date(report.expires_at) < new Date() ? (
                  <Badge variant="destructive">Expired</Badge>
                ) : report.is_public ? (
                  <Badge variant="default">Active</Badge>
                ) : (
                  <Badge variant="secondary">Private</Badge>
                )}
              </TableCell>
              <TableCell>
                {report.share_token && (
                  <a
                    href={`/reports/${report.share_token}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {reports.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          No reports generated yet
        </div>
      )}
    </Card>
  );
}
