import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { 
  Trash2, 
  Download, 
  Search, 
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  FileJson,
  Shield
} from "lucide-react";
import { format } from "date-fns";

interface DeletionRecord {
  id: string;
  company_id: string;
  company_name: string;
  deleted_by: string | null;
  deleted_by_name: string | null;
  deleted_by_email: string | null;
  backup_storage_path: string | null;
  backup_size_bytes: number | null;
  email_sent_to: string | null;
  data_summary: any;
  status: string;
  error_message: string | null;
  created_at: string;
}

export const DeletionHistoryTab = () => {
  const [deletions, setDeletions] = useState<DeletionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    fetchDeletions();
  }, []);

  const fetchDeletions = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('company_deletion_backups')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setDeletions(data || []);
    } catch (error: any) {
      console.error('Error fetching deletions:', error);
      toast({
        title: "Error",
        description: "Failed to load deletion history",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const downloadBackup = async (record: DeletionRecord) => {
    if (!record.backup_storage_path) {
      toast({
        title: "No Backup Available",
        description: "This deletion does not have an associated backup file",
        variant: "destructive"
      });
      return;
    }

    try {
      const { data, error } = await supabase.storage
        .from('company-backups')
        .createSignedUrl(record.backup_storage_path, 3600); // 1 hour expiry

      if (error) throw error;

      window.open(data.signedUrl, '_blank');
      
      toast({
        title: "Download Started",
        description: "Backup file download initiated"
      });
    } catch (error: any) {
      toast({
        title: "Download Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <Badge variant="default" className="bg-green-100 text-green-800 border-green-200">
            <CheckCircle className="h-3 w-3 mr-1" />
            Completed
          </Badge>
        );
      case 'failed':
        return (
          <Badge variant="destructive">
            <XCircle className="h-3 w-3 mr-1" />
            Failed
          </Badge>
        );
      case 'pending':
        return (
          <Badge variant="secondary">
            <Clock className="h-3 w-3 mr-1" />
            Pending
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatBytes = (bytes: number | null) => {
    if (!bytes) return 'N/A';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const filteredDeletions = deletions.filter(d =>
    d.company_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    d.deleted_by_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    d.deleted_by_email?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Trash2 className="h-5 w-5 text-destructive" />
                Company Deletion History
              </CardTitle>
              <CardDescription>
                View all company deletion attempts and download backup files
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={fetchDeletions} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Search */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by company name or deleted by..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="p-4 bg-muted rounded-lg">
              <p className="text-2xl font-bold">{deletions.length}</p>
              <p className="text-sm text-muted-foreground">Total Deletions</p>
            </div>
            <div className="p-4 bg-green-50 rounded-lg">
              <p className="text-2xl font-bold text-green-700">
                {deletions.filter(d => d.status === 'completed').length}
              </p>
              <p className="text-sm text-green-600">Successful</p>
            </div>
            <div className="p-4 bg-red-50 rounded-lg">
              <p className="text-2xl font-bold text-red-700">
                {deletions.filter(d => d.status === 'failed').length}
              </p>
              <p className="text-sm text-red-600">Failed</p>
            </div>
          </div>

          {/* Table */}
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : filteredDeletions.length === 0 ? (
            <div className="text-center py-12">
              <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No deletion records found</p>
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Company</TableHead>
                    <TableHead>Deleted By</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Data Summary</TableHead>
                    <TableHead>Backup Size</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDeletions.map((record) => (
                    <TableRow key={record.id}>
                      <TableCell className="font-medium">
                        {record.company_name}
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{record.deleted_by_name || 'Unknown'}</p>
                          <p className="text-xs text-muted-foreground">{record.deleted_by_email}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        {format(new Date(record.created_at), 'MMM d, yyyy')}
                        <br />
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(record.created_at), 'h:mm a')}
                        </span>
                      </TableCell>
                      <TableCell>{getStatusBadge(record.status)}</TableCell>
                      <TableCell>
                        {record.data_summary ? (
                          <div className="text-xs space-y-0.5">
                            <p>{record.data_summary.contacts || 0} contacts</p>
                            <p>{record.data_summary.projects || 0} projects</p>
                            <p>{record.data_summary.estimates || 0} estimates</p>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">N/A</span>
                        )}
                      </TableCell>
                      <TableCell>{formatBytes(record.backup_size_bytes)}</TableCell>
                      <TableCell className="text-right">
                        {record.backup_storage_path && record.status === 'completed' && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => downloadBackup(record)}
                          >
                            <Download className="h-4 w-4 mr-1" />
                            Download
                          </Button>
                        )}
                        {record.status === 'failed' && record.error_message && (
                          <span className="text-xs text-destructive">
                            {record.error_message}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};