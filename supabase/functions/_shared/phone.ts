// ============================================
// PHONE NUMBER UTILITIES
// ============================================

/**
 * Normalize a phone number to E.164 format.
 * Examples:
 *   "(555) 123-4567" -> "+15551234567"
 *   "1-555-123-4567" -> "+15551234567"
 *   "+1 555 123 4567" -> "+15551234567"
 */
export function normalizeE164(input: string | null | undefined): string {
  const s = (input ?? '').trim();
  if (!s) return '';

  // Remove all non-digit characters except leading +
  let cleaned = s.replace(/[^\\d+]/g, '');

  // If already starts with +, just remove spaces
  if (cleaned.startsWith('+')) {
    return cleaned;
  }

  // Remove leading zeros
  cleaned = cleaned.replace(/^0+/, '');

  // If US 10-digit, prefix +1
  if (cleaned.length === 10) {
    return `+1${cleaned}`;
  }

  // If 11 digits starting with 1, prefix +
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+${cleaned}`;
  }

  // Otherwise just prefix +
  return `+${cleaned}`;
}

/**
 * Validate E.164 phone number format
 */
export function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{1,14}$/.test(phone);
}

/**
 * Format phone for display (US format)
 */
export function formatPhoneDisplay(phone: string): string {
  const normalized = normalizeE164(phone);
  if (!normalized) return phone;

  // US number formatting
  if (normalized.startsWith('+1') && normalized.length === 12) {
    const digits = normalized.slice(2);
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  return normalized;
}
