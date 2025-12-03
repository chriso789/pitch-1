import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { 
  RotateCcw, 
  FileJson, 
  Calendar, 
  Building2,
  Loader2,
  AlertTriangle,
  CheckCircle2
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

interface BackupRecord {
  id: string;
  tenant_id: string;
  company_name: string;
  backup_type: string;
  backup_storage_path: string;
  backup_size_bytes: number | null;
  data_summary: any;
  status: string | null;
  created_at: string;
}

const RESTORABLE_TABLES = [
  { id: 'contacts', label: 'Contacts', description: 'Customer contact information' },
  { id: 'pipeline_entries', label: 'Pipeline Entries', description: 'Sales leads and pipeline data' },
  { id: 'projects', label: 'Projects', description: 'Project records' },
  { id: 'estimates', label: 'Estimates', description: 'Estimate and proposal data' },
  { id: 'documents', label: 'Documents', description: 'Document records' },
  { id: 'photos', label: 'Photos', description: 'Photo records and metadata' },
];

export const BackupRestorePanel = () => {
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBackup, setSelectedBackup] = useState<BackupRecord | null>(null);
  const [selectedTables, setSelectedTables] = useState<string[]>(RESTORABLE_TABLES.map(t => t.id));
  const [targetTenant, setTargetTenant] = useState<string>('');
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [backupsRes, companiesRes] = await Promise.all([
        supabase
          .from('company_backups')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('tenants')
          .select('id, name')
          .eq('is_active', true)
          .order('name')
      ]);

      setBackups(backupsRes.data || []);
      setCompanies(companiesRes.data || []);
    } catch (error: any) {
      console.error('Error loading backups:', error);
      toast({
        title: "Error loading backups",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const formatBytes = (bytes: number | null) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleRestoreClick = (backup: BackupRecord) => {
    setSelectedBackup(backup);
    setTargetTenant(backup.tenant_id);
    setSelectedTables(RESTORABLE_TABLES.map(t => t.id));
    setRestoreDialogOpen(true);
  };

  const handleRestore = async () => {
    if (!selectedBackup || !targetTenant || selectedTables.length === 0) {
      toast({
        title: "Invalid selection",
        description: "Please select a target company and at least one table to restore",
        variant: "destructive"
      });
      return;
    }

    setIsRestoring(true);
    try {
      const { data, error } = await supabase.functions.invoke('restore-company-backup', {
        body: {
          backup_path: selectedBackup.backup_storage_path,
          target_tenant_id: targetTenant,
          tables_to_restore: selectedTables
        }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast({
        title: "Restore completed",
        description: data.message,
      });

      setRestoreDialogOpen(false);
    } catch (error: any) {
      toast({
        title: "Restore failed",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setIsRestoring(false);
    }
  };

  const toggleTable = (tableId: string) => {
    setSelectedTables(prev => 
      prev.includes(tableId)
        ? prev.filter(t => t !== tableId)
        : [...prev, tableId]
    );
  };

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
      <div>
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <RotateCcw className="h-5 w-5 text-primary" />
          Point-in-Time Recovery
        </h3>
        <p className="text-sm text-muted-foreground">
          Restore company data from any previous backup with selective table restoration
        </p>
      </div>

      {/* Warning */}
      <Card className="border-yellow-500/50 bg-yellow-50/50 dark:bg-yellow-900/10">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-yellow-800 dark:text-yellow-200">Important Notice</p>
              <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                Restoration will add data to the target company. Existing data will not be deleted.
                For duplicate records, new IDs will be generated.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Backup List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Available Backups</CardTitle>
          <CardDescription>Select a backup to restore from</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {backups.map(backup => (
              <div 
                key={backup.id}
                className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <FileJson className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{backup.company_name}</p>
                      <Badge variant="outline" className="text-xs">
                        {backup.backup_type}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {format(new Date(backup.created_at), 'MMM d, yyyy h:mm a')}
                      </span>
                      <span>{formatBytes(backup.backup_size_bytes)}</span>
                      {backup.data_summary && (
                        <span>
                          {Object.values(backup.data_summary as Record<string, number>).reduce((a, b) => a + b, 0)} records
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => handleRestoreClick(backup)}
                >
                  <RotateCcw className="h-4 w-4 mr-1" />
                  Restore
                </Button>
              </div>
            ))}

            {backups.length === 0 && (
              <p className="text-center text-muted-foreground py-8">
                No backups available
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Restore Dialog */}
      <Dialog open={restoreDialogOpen} onOpenChange={setRestoreDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5" />
              Restore Backup
            </DialogTitle>
          </DialogHeader>

          {selectedBackup && (
            <div className="space-y-6">
              {/* Backup Info */}
              <div className="p-4 bg-muted rounded-lg">
                <p className="font-medium">{selectedBackup.company_name}</p>
                <p className="text-sm text-muted-foreground">
                  {format(new Date(selectedBackup.created_at), 'MMMM d, yyyy h:mm a')}
                </p>
              </div>

              {/* Target Company */}
              <div className="space-y-2">
                <Label>Restore to Company</Label>
                <Select value={targetTenant} onValueChange={setTargetTenant}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select target company" />
                  </SelectTrigger>
                  <SelectContent>
                    {companies.map(company => (
                      <SelectItem key={company.id} value={company.id}>
                        <span className="flex items-center gap-2">
                          <Building2 className="h-4 w-4" />
                          {company.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Table Selection */}
              <div className="space-y-3">
                <Label>Tables to Restore</Label>
                <div className="grid gap-2">
                  {RESTORABLE_TABLES.map(table => (
                    <div 
                      key={table.id}
                      className="flex items-center space-x-3 p-3 border rounded-lg hover:bg-muted/50"
                    >
                      <Checkbox
                        id={table.id}
                        checked={selectedTables.includes(table.id)}
                        onCheckedChange={() => toggleTable(table.id)}
                      />
                      <div className="flex-1">
                        <Label htmlFor={table.id} className="cursor-pointer font-medium">
                          {table.label}
                        </Label>
                        <p className="text-xs text-muted-foreground">{table.description}</p>
                      </div>
                      {selectedBackup.data_summary?.[table.id] !== undefined && (
                        <Badge variant="secondary" className="text-xs">
                          {selectedBackup.data_summary[table.id]} records
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleRestore} 
              disabled={isRestoring || !targetTenant || selectedTables.length === 0}
            >
              {isRestoring ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Restoring...
                </>
              ) : (
                <>
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Restore Selected
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};