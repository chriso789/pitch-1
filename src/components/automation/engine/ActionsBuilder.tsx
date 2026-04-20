import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import { ACTION_TYPES, ActionType, RuleAction } from './types';

interface Props {
  value: RuleAction[];
  onChange: (next: RuleAction[]) => void;
}

// Param schemas per action type — keep this minimal and friendly.
const PARAM_FIELDS: Record<ActionType, { key: string; label: string; type: 'text' | 'textarea' | 'number' }[]> = {
  create_task: [
    { key: 'title', label: 'Title', type: 'text' },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'assignee_role', label: 'Assignee role (e.g. production_manager)', type: 'text' },
    { key: 'due_in_hours', label: 'Due in (hours)', type: 'number' },
  ],
  create_followup_reminder: [
    { key: 'title', label: 'Title', type: 'text' },
    { key: 'due_in_minutes', label: 'Due in (minutes)', type: 'number' },
    { key: 'assignee_field', label: 'Assignee field (e.g. job.owner_user_id)', type: 'text' },
  ],
  create_internal_note: [{ key: 'body', label: 'Note body', type: 'textarea' }],
  send_email_template: [
    { key: 'template_slug', label: 'Email template slug', type: 'text' },
    { key: 'to_field', label: 'Recipient field (e.g. contact.email)', type: 'text' },
  ],
  send_sms_template: [
    { key: 'template_slug', label: 'SMS template slug', type: 'text' },
    { key: 'to_field', label: 'Recipient field (e.g. contact.phone)', type: 'text' },
  ],
  assign_user: [
    { key: 'assignee_field', label: 'Field to set', type: 'text' },
    { key: 'user_id', label: 'User ID', type: 'text' },
  ],
  change_status: [{ key: 'status', label: 'New status', type: 'text' }],
  update_field: [
    { key: 'field', label: 'Field path', type: 'text' },
    { key: 'value', label: 'Value', type: 'text' },
  ],
  request_document: [
    { key: 'document_type', label: 'Document type', type: 'text' },
    { key: 'message', label: 'Message to customer', type: 'textarea' },
  ],
  notify_channel: [
    { key: 'channel', label: 'Channel (e.g. job_feed)', type: 'text' },
    { key: 'message', label: 'Message', type: 'textarea' },
  ],
  webhook_post: [
    { key: 'url', label: 'Webhook URL', type: 'text' },
    { key: 'body_template', label: 'Body (JSON, supports {{tags}})', type: 'textarea' },
  ],
  rebuild_smart_tags: [{ key: 'scope', label: 'Scope (entity/parent/company)', type: 'text' }],
  rebuild_ai_memory: [{ key: 'scope', label: 'Scope (job/contact/lead/company)', type: 'text' }],
  escalate_to_manager: [{ key: 'reason', label: 'Reason', type: 'text' }],
};

export function ActionsBuilder({ value, onChange }: Props) {
  const update = (i: number, patch: Partial<RuleAction>) => {
    const next = [...value];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };

  const updateParam = (i: number, key: string, val: any) => {
    const next = [...value];
    next[i] = { ...next[i], params: { ...next[i].params, [key]: val } };
    onChange(next);
  };

  const add = () => onChange([...value, { type: 'create_task', params: {} }]);
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No actions yet. Add at least one for the rule to do anything.
        </p>
      )}

      {value.map((action, i) => {
        const fields = PARAM_FIELDS[action.type] ?? [];
        const meta = ACTION_TYPES.find((a) => a.value === action.type);
        return (
          <div key={i} className="space-y-3 rounded-lg border bg-card p-4">
            <div className="flex items-start gap-2">
              <div className="flex-1 space-y-1">
                <Select value={action.type} onValueChange={(v) => update(i, { type: v as ActionType, params: {} })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACTION_TYPES.map((a) => (
                      <SelectItem key={a.value} value={a.value}>
                        {a.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {meta && <p className="text-xs text-muted-foreground">{meta.description}</p>}
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={() => remove(i)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {fields.map((f) => {
                const val = action.params?.[f.key] ?? '';
                if (f.type === 'textarea') {
                  return (
                    <div key={f.key} className="md:col-span-2">
                      <label className="text-xs font-medium text-muted-foreground">{f.label}</label>
                      <Textarea value={val} onChange={(e) => updateParam(i, f.key, e.target.value)} />
                    </div>
                  );
                }
                return (
                  <div key={f.key}>
                    <label className="text-xs font-medium text-muted-foreground">{f.label}</label>
                    <Input
                      type={f.type === 'number' ? 'number' : 'text'}
                      value={val}
                      onChange={(e) =>
                        updateParam(i, f.key, f.type === 'number' ? Number(e.target.value) || 0 : e.target.value)
                      }
                    />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <Button type="button" variant="outline" size="sm" onClick={add}>
        <Plus className="mr-1 h-4 w-4" /> Add action
      </Button>
    </div>
  );
}
