import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

interface EventType { key: string; description: string }

export function EventTypesReference() {
  const [rows, setRows] = useState<EventType[]>([]);
  const [q, setQ] = useState('');

  useEffect(() => {
    supabase.from('event_types').select('key, description').order('key')
      .then(({ data }) => setRows((data as EventType[]) || []));
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => r.key.toLowerCase().includes(s) || r.description.toLowerCase().includes(s));
  }, [rows, q]);

  const grouped = useMemo(() => {
    const groups: Record<string, EventType[]> = {};
    filtered.forEach((r) => {
      const g = r.key.split('.')[0];
      (groups[g] ||= []).push(r);
    });
    return groups;
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Event types</h3>
        <p className="text-sm text-muted-foreground">Canonical events your rules can listen for.</p>
      </div>
      <Input placeholder="Search events…" value={q} onChange={(e) => setQ(e.target.value)} />

      <div className="space-y-4">
        {Object.entries(grouped).map(([group, items]) => (
          <Card key={group}>
            <CardContent className="space-y-2 p-4">
              <div className="text-sm font-semibold capitalize">{group}</div>
              <div className="flex flex-wrap gap-2">
                {items.map((r) => (
                  <Badge key={r.key} variant="outline" className="font-mono text-xs" title={r.description}>
                    {r.key}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
