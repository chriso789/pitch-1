import { Address } from './types';

export function hashAddress(addr: Address): string {
  const normalized = `${addr.line1.toLowerCase().trim()}_${addr.city.toLowerCase().trim()}_${addr.state.toLowerCase()}_${addr.postal_code}`;
  return btoa(normalized).replace(/[^a-zA-Z0-9]/g, '').substring(0, 32);
}

export function redactConfig(config: Record<string, any>): Record<string, any> {
  const redacted = { ...config };
  for (const [key, value] of Object.entries(redacted)) {
    if (key.toLowerCase().includes('key') || 
        key.toLowerCase().includes('token') || 
        key.toLowerCase().includes('secret')) {
      redacted[key] = value ? `${String(value).substring(0, 8)}...` : undefined;
    }
  }
  return redacted;
}

export function normalizePhoneNumber(phone: string): string {
  // Remove all non-digits
  const digits = phone.replace(/\D/g, '');
  
  // Add country code if missing
  if (digits.length === 10) {
    return `+1${digits}`;
  } else if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  
  return phone; // Return original if can't normalize
}

export function formatPhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  } else if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return phone;
}

export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function generateIdempotencyKey(address: Address): string {
  const input = `${address.line1}_${address.city}_${address.state}_${address.postal_code}`;
  return btoa(input).replace(/[^a-zA-Z0-9]/g, '').substring(0, 16);
}
