import { useEffect, useState } from 'react';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { PdfAuditEngine, type PdfAuditEvent } from '@/lib/pdf-engine/PdfAuditEngine';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';

interface PdfAuditPanelProps {
  pdfDocumentId?: string;
}

const EVENT_COLORS: Record<string, string> = {
  template_created: 'bg-green-500/20 text-green-700',
  text_replaced: 'bg-blue-500/20 text-blue-700',
  object_moved: 'bg-yellow-500/20 text-yellow-700',
  object_deleted: 'bg-red-500/20 text-red-700',
  redaction_applied: 'bg-red-600/20 text-red-800',
  pdf_compiled: 'bg-purple-500/20 text-purple-700',
  ocr_completed: 'bg-teal-500/20 text-teal-700',
};

export function PdfAuditPanel({ pdfDocumentId }: PdfAuditPanelProps) {
  const tenantId = useEffectiveTenantId();
  const [events, setEvents] = useState<PdfAuditEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) return;
    setLoading(true);
    PdfAuditEngine.getEvents(tenantId, pdfDocumentId, 100)
      .then(setEvents)
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, [tenantId, pdfDocumentId]);

  if (loading) return <p className="text-xs text-muted-foreground p-4 animate-pulse">Loading audit trail...</p>;

  if (events.length === 0) {
    return <p className="text-xs text-muted-foreground text-center p-4">No audit events yet</p>;
  }

  return (
    <ScrollArea className="h-[500px]">
      <div className="space-y-1 p-2">
        {events.map(e => (
          <div key={e.id} className="p-2 border rounded text-xs space-y-0.5">
            <div className="flex items-center gap-1">
              <Badge className={`text-[9px] px-1 py-0 ${EVENT_COLORS[e.event_type] || 'bg-muted text-muted-foreground'}`}>
                {e.event_type.replace(/_/g, ' ')}
              </Badge>
              <span className="text-[10px] text-muted-foreground ml-auto">
                {formatDistanceToNow(new Date(e.created_at), { addSuffix: true })}
              </span>
            </div>
            {Object.keys(e.event_payload).length > 0 && (
              <p className="text-[10px] text-muted-foreground truncate">
                {JSON.stringify(e.event_payload).slice(0, 100)}
              </p>
            )}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
