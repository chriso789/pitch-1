// Shared condition evaluator for the automation engine.
// Mirrors the operators in src/components/automation/engine/types.ts.

export type Condition = {
  field: string;
  op: string;
  value?: any;
};

export function evaluateConditions(conds: Condition[], payload: Record<string, any>): boolean {
  if (!conds || conds.length === 0) return true;
  return conds.every((c) => evalOne(c, payload));
}

function getPath(obj: any, path: string): any {
  if (!path) return undefined;
  return path.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
}

function evalOne(c: Condition, payload: Record<string, any>): boolean {
  const left = getPath(payload, c.field);
  const v = c.value;

  switch (c.op) {
    case 'equals': return left == v;
    case 'not_equals': return left != v;
    case 'in': return Array.isArray(v) && v.includes(left);
    case 'not_in': return Array.isArray(v) && !v.includes(left);
    case 'greater_than': return Number(left) > Number(v);
    case 'less_than': return Number(left) < Number(v);
    case 'contains':
      return typeof left === 'string' && typeof v === 'string' && left.includes(v);
    case 'starts_with':
      return typeof left === 'string' && typeof v === 'string' && left.startsWith(v);
    case 'is_true': return left === true || left === 'true';
    case 'is_false': return left === false || left === 'false';
    case 'exists': return left !== undefined && left !== null;
    case 'not_exists': return left === undefined || left === null;
    case 'changed_to': return getPath(payload, 'new_' + c.field.split('.').pop()) == v
      || (payload?.changes && payload.changes[c.field]?.new == v);
    case 'changed_from': return getPath(payload, 'old_' + c.field.split('.').pop()) == v
      || (payload?.changes && payload.changes[c.field]?.old == v);
    case 'days_since_gt': {
      const t = left ? new Date(left).getTime() : NaN;
      if (!Number.isFinite(t)) return false;
      return (Date.now() - t) / 86400000 > Number(v);
    }
    case 'hours_since_gt': {
      const t = left ? new Date(left).getTime() : NaN;
      if (!Number.isFinite(t)) return false;
      return (Date.now() - t) / 3600000 > Number(v);
    }
    default:
      console.warn('[conditions] unknown op', c.op);
      return false;
  }
}
