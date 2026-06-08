// Defensive coercion for values that may be strings, numbers, or accidentally
// shaped as catalog objects like { code, name, description }.
// Always returns a string safe to render as a React child.
export function safeText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object') {
    const o = v as any;
    return String(o.description || o.name || o.code || o.label || o.title || '');
  }
  return String(v);
}
