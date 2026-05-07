import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { GitCompare, Plus, Minus, Edit } from 'lucide-react';

interface DiffEntry {
  type: 'added' | 'removed' | 'modified';
  object_type: string;
  page_number: number;
  description: string;
  old_value?: string;
  new_value?: string;
}

interface PdfVersionDiffViewerProps {
  versionA: { label: string; operations: Array<{ operation_type: string; operation_payload: Record<string, unknown>; target_object_id?: string }> };
  versionB: { label: string; operations: Array<{ operation_type: string; operation_payload: Record<string, unknown>; target_object_id?: string }> };
}

export function PdfVersionDiffViewer({ versionA, versionB }: PdfVersionDiffViewerProps) {
  const diffs = useMemo(() => {
    const entries: DiffEntry[] = [];
    const aOps = new Map(versionA.operations.map(o => [o.target_object_id || crypto.randomUUID(), o]));
    const bOps = new Map(versionB.operations.map(o => [o.target_object_id || crypto.randomUUID(), o]));

    for (const [id, op] of bOps) {
      const prev = aOps.get(id);
      const payload = op.operation_payload as any;
      if (!prev) {
        entries.push({ type: 'added', object_type: op.operation_type, page_number: payload.page_number || 1, description: `Added ${op.operation_type}`, new_value: payload.replacement_text || payload.text || '' });
      } else {
        const prevPayload = prev.operation_payload as any;
        const oldText = prevPayload.replacement_text || prevPayload.text || '';
        const newText = payload.replacement_text || payload.text || '';
        if (oldText !== newText) {
          entries.push({ type: 'modified', object_type: op.operation_type, page_number: payload.page_number || 1, description: `Modified ${op.operation_type}`, old_value: oldText, new_value: newText });
        }
      }
    }

    for (const [id, op] of aOps) {
      if (!bOps.has(id)) {
        const payload = op.operation_payload as any;
        entries.push({ type: 'removed', object_type: op.operation_type, page_number: payload.page_number || 1, description: `Removed ${op.operation_type}`, old_value: payload.replacement_text || payload.text || '' });
      }
    }

    return entries.sort((a, b) => a.page_number - b.page_number);
  }, [versionA, versionB]);

  const icon = (type: DiffEntry['type']) => {
    switch (type) {
      case 'added': return <Plus className="h-4 w-4 text-green-500" />;
      case 'removed': return <Minus className="h-4 w-4 text-red-500" />;
      case 'modified': return <Edit className="h-4 w-4 text-amber-500" />;
    }
  };

  const badgeVariant = (type: DiffEntry['type']) => {
    switch (type) {
      case 'added': return 'default' as const;
      case 'removed': return 'destructive' as const;
      case 'modified': return 'secondary' as const;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitCompare className="h-5 w-5" />
          Version Diff: {versionA.label} → {versionB.label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {diffs.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No differences found between versions.</p>
        ) : (
          <ScrollArea className="h-[400px]">
            <div className="space-y-2">
              {diffs.map((d, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg border bg-card">
                  {icon(d.type)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant={badgeVariant(d.type)}>{d.type}</Badge>
                      <span className="text-xs text-muted-foreground">Page {d.page_number}</span>
                    </div>
                    <p className="text-sm">{d.description}</p>
                    {d.old_value && <p className="text-xs text-red-400 line-through mt-1 truncate">{d.old_value}</p>}
                    {d.new_value && <p className="text-xs text-green-400 mt-1 truncate">{d.new_value}</p>}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
        <p className="text-xs text-muted-foreground mt-3">{diffs.length} change(s) detected</p>
      </CardContent>
    </Card>
  );
}
