import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { 
  Database, 
  HardDrive, 
  Clock, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle,
  RefreshCw,
  Download,
  Loader2
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface BackupStatus {
  tenant_id: string;
  company_name: string;
  last_backup_at: string | null;
  backup_count: number;
  total_size_bytes: number;
  status: 'healthy' | 'stale' | 'failed' | 'never';
}

export const BackupStatusDashboard = () => {
  const [backupStatuses, setBackupStatuses] = useState<BackupStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadBackupStatuses();
    // Auto-refresh every 60 seconds
    const interval = setInterval(loadBackupStatuses, 60000);
    return () => clearInterval(interval);
  }, []);

  const loadBackupStatuses = async () => {
    try {
      // Get all companies
      const { data: companies } = await supabase
        .from('tenants')
        .select('id, name, is_active')
        .eq('is_active', true)
        .order('name');

      if (!companies) return;

      // Get backup info for each company
      const { data: backups } = await supabase
        .from('company_backups')
        .select('tenant_id, company_name, created_at, backup_size_bytes, status')
        .order('created_at', { ascending: false });

      // Calculate status for each company
      const statuses: BackupStatus[] = companies.map(company => {
        const companyBackups = backups?.filter(b => b.tenant_id === company.id) || [];
        const lastBackup = companyBackups[0];
        const totalSize = companyBackups.reduce((sum, b) => sum + (b.backup_size_bytes || 0), 0);

        let status: BackupStatus['status'] = 'never';
        if (lastBackup) {
          const lastBackupDate = new Date(lastBackup.created_at);
          const hoursSinceBackup = (Date.now() - lastBackupDate.getTime()) / (1000 * 60 * 60);
          
          if (lastBackup.status === 'failed') {
            status = 'failed';
          } else if (hoursSinceBackup < 24) {
            status = 'healthy';
          } else if (hoursSinceBackup < 48) {
            status = 'stale';
          } else {
            status = 'failed';
          }
        }

        return {
          tenant_id: company.id,
          company_name: company.name,
          last_backup_at: lastBackup?.created_at || null,
          backup_count: companyBackups.length,
          total_size_bytes: totalSize,
          status
        };
      });

      setBackupStatuses(statuses);
    } catch (error: any) {
      console.error('Error loading backup statuses:', error);
      toast({
        title: "Error loading backup statuses",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    loadBackupStatuses();
  };

  const triggerManualBackup = async (tenantId: string, companyName: string) => {
    toast({
      title: "Starting backup...",
      description: `Backing up ${companyName}`,
    });

    try {
      const { data, error } = await supabase.functions.invoke('daily-company-backup', {
        body: { tenant_id: tenantId }
      });

      if (error) throw error;

      toast({
        title: "Backup completed",
        description: `${companyName} backup created successfully`,
      });
      
      loadBackupStatuses();
    } catch (error: any) {
      toast({
        title: "Backup failed",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getStatusBadge = (status: BackupStatus['status']) => {
    switch (status) {
      case 'healthy':
        return <Badge className="bg-green-500"><CheckCircle2 className="h-3 w-3 mr-1" />Healthy</Badge>;
      case 'stale':
        return <Badge variant="outline" className="text-yellow-600 border-yellow-600"><AlertTriangle className="h-3 w-3 mr-1" />Stale</Badge>;
      case 'failed':
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Failed</Badge>;
      case 'never':
        return <Badge variant="secondary">No Backups</Badge>;
    }
  };

  const stats = {
    healthy: backupStatuses.filter(s => s.status === 'healthy').length,
    stale: backupStatuses.filter(s => s.status === 'stale').length,
    failed: backupStatuses.filter(s => s.status === 'failed' || s.status === 'never').length,
    totalSize: backupStatuses.reduce((sum, s) => sum + s.total_size_bytes, 0)
  };

  const healthPercentage = backupStatuses.length > 0 
    ? Math.round((stats.healthy / backupStatuses.length) * 100)
    : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            Backup Health Dashboard
          </h3>
          <p className="text-sm text-muted-foreground">
            Real-time backup status for all companies
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500/10 rounded-lg">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.healthy}</p>
                <p className="text-sm text-muted-foreground">Healthy</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-yellow-500/10 rounded-lg">
                <AlertTriangle className="h-5 w-5 text-yellow-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.stale}</p>
                <p className="text-sm text-muted-foreground">Stale (&gt;24h)</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-destructive/10 rounded-lg">
                <XCircle className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.failed}</p>
                <p className="text-sm text-muted-foreground">Need Attention</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <HardDrive className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{formatBytes(stats.totalSize)}</p>
                <p className="text-sm text-muted-foreground">Total Storage</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Overall Health */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Overall Backup Health</CardTitle>
          <CardDescription>{healthPercentage}% of companies have recent backups</CardDescription>
        </CardHeader>
        <CardContent>
          <Progress value={healthPercentage} className="h-3" />
        </CardContent>
      </Card>

      {/* Company List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Company Backup Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {backupStatuses.map(status => (
              <div 
                key={status.tenant_id}
                className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-4">
                  {getStatusBadge(status.status)}
                  <div>
                    <p className="font-medium">{status.company_name}</p>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {status.last_backup_at 
                          ? `Last backup ${formatDistanceToNow(new Date(status.last_backup_at), { addSuffix: true })}`
                          : 'Never backed up'
                        }
                      </span>
                      <span>{status.backup_count} backups</span>
                      <span>{formatBytes(status.total_size_bytes)}</span>
                    </div>
                  </div>
                </div>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => triggerManualBackup(status.tenant_id, status.company_name)}
                >
                  <Download className="h-4 w-4 mr-1" />
                  Backup Now
                </Button>
              </div>
            ))}

            {backupStatuses.length === 0 && (
              <p className="text-center text-muted-foreground py-8">
                No companies found
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};