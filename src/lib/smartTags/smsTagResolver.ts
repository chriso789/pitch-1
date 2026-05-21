/**
 * SMS Smart Tag Resolver
 * Used by the MSFH campaign engine and other SMS blasts to substitute
 * {{contact.first_name}}, {{company.name}}, {{assigned_user.first_name}} etc.
 * into a template body for per-recipient personalization.
 *
 * Fallbacks are intentionally consultative ("there", "your property") so the
 * message never looks like an unfilled merge field.
 */

export interface SmsTagContext {
  contact?: {
    first_name?: string | null;
    last_name?: string | null;
    address1?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    zip_code?: string | null;
    phone?: string | null;
    email?: string | null;
  } | null;
  company?: {
    name?: string | null;
    phone?: string | null;
  } | null;
  assigned_user?: {
    first_name?: string | null;
    last_name?: string | null;
  } | null;
}

const FALLBACKS: Record<string, string> = {
  'contact.first_name': 'there',
  'contact.last_name': '',
  'contact.address1': 'your property',
  'contact.full_address': 'your property',
  'contact.city': 'your area',
  'contact.state': 'FL',
  'contact.zip': '',
  'company.name': 'our team',
  'company.phone': '',
  'assigned_user.first_name': 'a teammate',
};

function buildFullAddress(c: SmsTagContext['contact']): string | null {
  if (!c) return null;
  const street = (c.address1 || c.address || '').toString().trim();
  const city = (c.city || '').toString().trim();
  const state = (c.state || '').toString().trim();
  const zip = (c.zip || c.zip_code || '').toString().trim();
  const cityStateZip = [city, [state, zip].filter(Boolean).join(' ').trim()].filter(Boolean).join(', ');
  const full = [street, cityStateZip].filter(Boolean).join(', ');
  return full || null;
}

function pick(ctx: SmsTagContext, key: string): string | null | undefined {
  switch (key) {
    case 'contact.first_name': return ctx.contact?.first_name;
    case 'contact.last_name': return ctx.contact?.last_name;
    case 'contact.address1': return ctx.contact?.address1 || ctx.contact?.address;
    case 'contact.full_address': return buildFullAddress(ctx.contact);
    case 'contact.city': return ctx.contact?.city;
    case 'contact.state': return ctx.contact?.state;
    case 'contact.zip': return ctx.contact?.zip || ctx.contact?.zip_code;
    case 'contact.phone': return ctx.contact?.phone;
    case 'company.name': return ctx.company?.name;
    case 'company.phone': return ctx.company?.phone;
    case 'assigned_user.first_name': return ctx.assigned_user?.first_name;
    case 'assigned_user.last_name': return ctx.assigned_user?.last_name;
    default: return undefined;
  }
}

/**
 * Replace all {{tag}} occurrences with values from ctx, falling back to
 * sensible defaults when a value is missing or empty.
 */
export function resolveSmsTags(template: string, ctx: SmsTagContext): string {
  if (!template) return '';
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_match, rawKey) => {
    const key = String(rawKey).trim();
    const val = pick(ctx, key);
    if (val && String(val).trim().length > 0) return String(val).trim();
    if (key in FALLBACKS) return FALLBACKS[key];
    return '';
  });
}

/** Available tags for the UI helper / picker. */
export const SMS_AVAILABLE_TAGS: { tag: string; label: string }[] = [
  { tag: '{{contact.first_name}}', label: 'Contact first name' },
  { tag: '{{contact.last_name}}', label: 'Contact last name' },
  { tag: '{{contact.address1}}', label: 'Property address' },
  { tag: '{{contact.city}}', label: 'City' },
  { tag: '{{contact.state}}', label: 'State' },
  { tag: '{{contact.zip}}', label: 'Zip code' },
  { tag: '{{company.name}}', label: 'Company name' },
  { tag: '{{company.phone}}', label: 'Company phone' },
  { tag: '{{assigned_user.first_name}}', label: 'Assigned rep first name' },
];

/** Sample preview context for the Creator UI. */
export const SAMPLE_TAG_CONTEXT: SmsTagContext = {
  contact: {
    first_name: 'John',
    last_name: 'Smith',
    address1: '4063 Fonsica Dr',
    city: 'Sarasota',
    state: 'FL',
    zip: '34232',
  },
  company: { name: "O'Brien Contracting", phone: '(941) 541-0117' },
  assigned_user: { first_name: 'Chris' },
};
