import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Calendar, User, MapPin, Monitor, Download, Filter,
  ChevronDown, ChevronRight, Loader2 
} from "lucide-react";
import { auditService } from "@/services/auditService";
import { formatDistanceToNow } from 'date-fns';

interface AuditTrailViewerProps {
  recordId: string;
  tableName: string;
}

export const AuditTrailViewer = ({ recordId, tableName }: AuditTrailViewerProps) => {
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchAuditLog();
  }, [recordId, tableName]);

  const fetchAuditLog = async () => {
    try {
      const data = await auditService.getAuditTrail(recordId, tableName);
      setAuditLog(data);
    } catch (error) {
      console.error('Error fetching audit log:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleExpanded = (entryId: string) => {
    const newExpanded = new Set(expandedEntries);
    if (newExpanded.has(entryId)) {
      newExpanded.delete(entryId);
    } else {
      newExpanded.add(entryId);
    }
    setExpandedEntries(newExpanded);
  };

  const handleExport = async () => {
    try {
      const csv = await auditService.exportAuditLog({ tableName });
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-log-${tableName}-${recordId}-${Date.now()}.csv`;
      a.click();
    } catch (error) {
      console.error('Error exporting audit log:', error);
    }
  };

  const getActionColor = (action: string) => {
    switch (action) {
      case 'INSERT': return 'bg-success text-success-foreground';
      case 'UPDATE': return 'bg-warning text-warning-foreground';
      case 'DELETE': return 'bg-destructive text-destructive-foreground';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Audit Trail
          </CardTitle>
          <Button onClick={handleExport} size="sm" variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[500px]">
          {auditLog.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No audit entries found
            </div>
          ) : (
            <div className="space-y-4">
              {auditLog.map((entry) => {
                const isExpanded = expandedEntries.has(entry.id);
                const changes = auditService.getFieldDiff(entry.old_values, entry.new_values);

                return (
                  <div key={entry.id} className="border rounded-lg p-4 space-y-3">
                    {/* Entry header */}
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleExpanded(entry.id)}
                          className="h-6 w-6 p-0"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </Button>
                        <Badge className={getActionColor(entry.action)}>
                          {entry.action}
                        </Badge>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {formatDistanceToNow(new Date(entry.changed_at), { addSuffix: true })}
                      </span>
                    </div>

                    {/* Entry metadata */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span>
                          {entry.changed_by_profile 
                            ? `${entry.changed_by_profile.first_name} ${entry.changed_by_profile.last_name}`
                            : 'Unknown User'
                          }
                        </span>
                      </div>
                      {entry.ip_address && (
                        <div className="flex items-center gap-2">
                          <Monitor className="h-4 w-4 text-muted-foreground" />
                          <span className="font-mono text-xs">{entry.ip_address}</span>
                        </div>
                      )}
                      {entry.location_data?.address && (
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4 text-muted-foreground" />
                          <span className="text-xs">{entry.location_data.address}</span>
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground">
                        Session: {entry.session_id?.slice(0, 8)}...
                      </div>
                    </div>

                    {/* Expanded changes */}
                    {isExpanded && changes.length > 0 && (
                      <div className="border-t pt-3 mt-3">
                        <div className="text-sm font-semibold mb-2">Changes:</div>
                        <div className="space-y-2">
                          {changes.map((change, idx) => (
                            <div key={idx} className="bg-muted/50 rounded p-2 text-sm">
                              <div className="font-medium text-primary">{change.field}</div>
                              <div className="grid grid-cols-2 gap-2 mt-1">
                                <div>
                                  <div className="text-xs text-muted-foreground">Old:</div>
                                  <div className="text-destructive line-through">
                                    {JSON.stringify(change.oldValue) || 'null'}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-xs text-muted-foreground">New:</div>
                                  <div className="text-success">
                                    {JSON.stringify(change.newValue) || 'null'}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
};