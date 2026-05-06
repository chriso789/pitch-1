import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import type { PdfEngineOperation, PdfEngineVersion } from '@/lib/pdf-engine/engineTypes';

interface PdfOperationHistoryProps {
  operations: PdfEngineOperation[];
  versions: PdfEngineVersion[];
}

export function PdfOperationHistory({ operations, versions }: PdfOperationHistoryProps) {
  return (
    <ScrollArea className="h-full">
      <div className="p-2 space-y-3">
        {versions.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-1">Versions</h4>
            {versions.map(v => (
              <div key={v.id} className="text-xs p-2 rounded border mb-1">
                <span className="font-medium">v{v.version_number}</span>
                <Badge variant="outline" className="ml-2 text-[10px]">{v.operation_count} ops</Badge>
                <p className="text-muted-foreground mt-0.5">
                  {new Date(v.created_at).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        )}

        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-1">Operations</h4>
          {operations.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">No operations yet</p>
          ) : (
            [...operations].reverse().slice(0, 50).map(op => (
              <div
                key={op.id}
                className={`text-xs p-2 rounded border mb-1 ${op.is_undone ? 'opacity-40 line-through' : ''}`}
              >
                <span className="font-medium">{op.operation_type.replace(/_/g, ' ')}</span>
                <p className="text-muted-foreground mt-0.5">
                  {new Date(op.created_at).toLocaleString()}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </ScrollArea>
  );
}
