import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import { CONDITION_OPS, RuleCondition } from './types';

interface Props {
  value: RuleCondition[];
  onChange: (next: RuleCondition[]) => void;
}

export function ConditionsBuilder({ value, onChange }: Props) {
  const update = (i: number, patch: Partial<RuleCondition>) => {
    const next = [...value];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };

  const add = () => onChange([...value, { field: '', op: 'equals', value: '' }]);
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No conditions — rule will fire on every matching event.
        </p>
      )}

      {value.map((cond, i) => {
        const opMeta = CONDITION_OPS.find((o) => o.value === cond.op);
        return (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
            <Input
              className="min-w-[180px] flex-1"
              placeholder="field (e.g. job.status)"
              value={cond.field}
              onChange={(e) => update(i, { field: e.target.value })}
            />
            <Select value={cond.op} onValueChange={(v) => update(i, { op: v as any })}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONDITION_OPS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {opMeta?.needsValue && (
              <Input
                className="min-w-[180px] flex-1"
                placeholder="value"
                value={(cond.value ?? '').toString()}
                onChange={(e) => update(i, { value: e.target.value })}
              />
            )}
            <Button type="button" variant="ghost" size="icon" onClick={() => remove(i)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        );
      })}

      <Button type="button" variant="outline" size="sm" onClick={add}>
        <Plus className="mr-1 h-4 w-4" /> Add condition
      </Button>
    </div>
  );
}
