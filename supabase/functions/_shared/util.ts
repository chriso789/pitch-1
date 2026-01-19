// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Get current timestamp in ISO format
 */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Generate a versioned document storage path
 * Pattern: company/{tenant_id}/permit_cases/{permit_case_id}/{timestamp}_{filename}
 */
export function versionedDocPath(args: {
  tenant_id: string;
  permit_case_id: string;
  filename: string;
}): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `company/${args.tenant_id}/permit_cases/${args.permit_case_id}/${ts}_${args.filename}`;
}

/**
 * Build full address from components
 */
export function buildFullAddress(components: {
  address_street?: string | null;
  address_city?: string | null;
  address_state?: string | null;
  address_zip?: string | null;
} | null): string | null {
  if (!components) return null;
  
  const parts: string[] = [];
  if (components.address_street) parts.push(components.address_street);
  if (components.address_city) parts.push(components.address_city);
  if (components.address_state) {
    if (components.address_zip) {
      parts.push(`${components.address_state} ${components.address_zip}`);
    } else {
      parts.push(components.address_state);
    }
  } else if (components.address_zip) {
    parts.push(components.address_zip);
  }
  
  return parts.length > 0 ? parts.join(', ') : null;
}

/**
 * Split owner name into first/last names (best effort)
 */
export function splitOwnerName(fullName: string | null): { firstName: string | null; lastName: string | null } {
  if (!fullName) return { firstName: null, lastName: null };
  
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) {
    return { firstName: null, lastName: parts[0] };
  }
  
  // Handle "LASTNAME, FIRSTNAME" format common in property records
  if (fullName.includes(',')) {
    const [last, ...rest] = fullName.split(',').map(s => s.trim());
    return { firstName: rest.join(' ') || null, lastName: last };
  }
  
  // Standard "FIRSTNAME LASTNAME" format
  const lastName = parts.pop() || null;
  const firstName = parts.join(' ') || null;
  
  return { firstName, lastName };
}

/**
 * Check if a date string is stale (older than TTL days)
 */
export function isStale(dateString: string | null, ttlDays: number): boolean {
  if (!dateString) return true;
  
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  
  return diffDays > ttlDays;
}
