// Shared types for the Automation Engine v2 UI

export type ConditionOp =
  | 'equals'
  | 'not_equals'
  | 'in'
  | 'not_in'
  | 'greater_than'
  | 'less_than'
  | 'contains'
  | 'starts_with'
  | 'is_true'
  | 'is_false'
  | 'exists'
  | 'not_exists'
  | 'changed_to'
  | 'changed_from'
  | 'days_since_gt'
  | 'hours_since_gt';

export interface RuleCondition {
  field: string;
  op: ConditionOp;
  value?: string | number | boolean | string[] | number[];
}

export type ActionType =
  | 'create_task'
  | 'create_internal_note'
  | 'send_email_template'
  | 'send_sms_template'
  | 'assign_user'
  | 'change_status'
  | 'update_field'
  | 'create_followup_reminder'
  | 'request_document'
  | 'notify_channel'
  | 'webhook_post'
  | 'rebuild_smart_tags'
  | 'rebuild_ai_memory'
  | 'escalate_to_manager';

export interface RuleAction {
  type: ActionType;
  params: Record<string, any>;
}

export interface AutomationRuleV2 {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  trigger_event: string;
  trigger_scope: string;
  conditions: RuleCondition[];
  actions: RuleAction[];
  cooldown_seconds: number;
  max_runs_per_entity_per_day: number | null;
  stop_processing_on_match: boolean;
  created_at: string;
  updated_at: string;
}

export interface RuleTemplate {
  id: string;
  name: string;
  description: string | null;
  category: string;
  trigger_event: string;
  trigger_scope: string;
  conditions: RuleCondition[];
  actions: RuleAction[];
  default_cooldown_seconds: number;
  default_max_runs_per_entity_per_day: number | null;
  is_recommended: boolean;
  is_active: boolean;
  sort_order: number;
}

export const CONDITION_OPS: { value: ConditionOp; label: string; needsValue: boolean }[] = [
  { value: 'equals', label: 'Equals', needsValue: true },
  { value: 'not_equals', label: 'Does not equal', needsValue: true },
  { value: 'in', label: 'In list', needsValue: true },
  { value: 'not_in', label: 'Not in list', needsValue: true },
  { value: 'greater_than', label: 'Greater than', needsValue: true },
  { value: 'less_than', label: 'Less than', needsValue: true },
  { value: 'contains', label: 'Contains', needsValue: true },
  { value: 'starts_with', label: 'Starts with', needsValue: true },
  { value: 'is_true', label: 'Is true', needsValue: false },
  { value: 'is_false', label: 'Is false', needsValue: false },
  { value: 'exists', label: 'Exists', needsValue: false },
  { value: 'not_exists', label: 'Does not exist', needsValue: false },
  { value: 'changed_to', label: 'Changed to', needsValue: true },
  { value: 'changed_from', label: 'Changed from', needsValue: true },
  { value: 'days_since_gt', label: 'Days since >', needsValue: true },
  { value: 'hours_since_gt', label: 'Hours since >', needsValue: true },
];

export const ACTION_TYPES: { value: ActionType; label: string; description: string }[] = [
  { value: 'create_task', label: 'Create task', description: 'Add a task assigned to a user or role' },
  { value: 'create_followup_reminder', label: 'Create follow-up reminder', description: 'Time-based reminder for the assignee' },
  { value: 'create_internal_note', label: 'Add internal note', description: 'Append a note to the entity' },
  { value: 'send_email_template', label: 'Send email', description: 'Send a templated email' },
  { value: 'send_sms_template', label: 'Send SMS', description: 'Send a templated SMS' },
  { value: 'assign_user', label: 'Assign user', description: 'Assign a rep / owner to the entity' },
  { value: 'change_status', label: 'Change status', description: 'Move the entity to a new status' },
  { value: 'update_field', label: 'Update field', description: 'Set a field on the entity' },
  { value: 'request_document', label: 'Request document', description: 'Send the customer a document request link' },
  { value: 'notify_channel', label: 'Notify channel', description: 'Post to an internal feed/channel' },
  { value: 'webhook_post', label: 'Send webhook', description: 'POST data to an external URL' },
  { value: 'rebuild_smart_tags', label: 'Rebuild smart tags', description: 'Refresh cached smart tag values' },
  { value: 'rebuild_ai_memory', label: 'Rebuild AI memory', description: 'Queue an AI context refresh for this scope' },
  { value: 'escalate_to_manager', label: 'Escalate to manager', description: 'Notify the assignee\'s manager' },
];

export const TRIGGER_SCOPES = [
  { value: 'entity', label: 'Entity (just this record)' },
  { value: 'parent', label: 'Parent (parent record)' },
  { value: 'company', label: 'Company-wide' },
];
