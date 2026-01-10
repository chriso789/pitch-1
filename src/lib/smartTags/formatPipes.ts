/**
 * Smart Tags Format Pipes
 * Implements formatting transformations for smart tag values
 */

// Date formatting with common patterns
export function formatDate(value: any, format: string = 'MMM D, YYYY'): string {
  if (!value) return '';
  
  try {
    const date = new Date(value);
    if (isNaN(date.getTime())) return '';
    
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const fullMonths = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    
    const day = date.getDate();
    const month = date.getMonth();
    const year = date.getFullYear();
    const hours = date.getHours();
    const minutes = date.getMinutes();
    
    // Common format patterns
    const replacements: Record<string, string> = {
      'YYYY': year.toString(),
      'YY': year.toString().slice(-2),
      'MMMM': fullMonths[month],
      'MMM': months[month],
      'MM': (month + 1).toString().padStart(2, '0'),
      'M': (month + 1).toString(),
      'DD': day.toString().padStart(2, '0'),
      'D': day.toString(),
      'HH': hours.toString().padStart(2, '0'),
      'H': hours.toString(),
      'hh': (hours % 12 || 12).toString().padStart(2, '0'),
      'h': (hours % 12 || 12).toString(),
      'mm': minutes.toString().padStart(2, '0'),
      'm': minutes.toString(),
      'A': hours >= 12 ? 'PM' : 'AM',
      'a': hours >= 12 ? 'pm' : 'am',
    };
    
    let result = format;
    // Sort by length descending to replace longer patterns first
    const sortedKeys = Object.keys(replacements).sort((a, b) => b.length - a.length);
    for (const key of sortedKeys) {
      result = result.replace(new RegExp(key, 'g'), replacements[key]);
    }
    
    return result;
  } catch {
    return String(value);
  }
}

// Currency formatting
export function formatMoney(value: any, currency: string = 'USD'): string {
  if (value === null || value === undefined || value === '') return '';
  
  const num = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^0-9.-]/g, ''));
  if (isNaN(num)) return '';
  
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    return `$${num.toFixed(2)}`;
  }
}

// Phone number formatting
export function formatPhone(value: any): string {
  if (!value) return '';
  
  const cleaned = String(value).replace(/\D/g, '');
  
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
  }
  
  return String(value);
}

// Case transformations
export function formatUpper(value: any): string {
  return String(value || '').toUpperCase();
}

export function formatLower(value: any): string {
  return String(value || '').toLowerCase();
}

export function formatTitle(value: any): string {
  return String(value || '')
    .toLowerCase()
    .replace(/(?:^|\s)\w/g, (match) => match.toUpperCase());
}

// Text truncation
export function formatTruncate(value: any, length: number = 100): string {
  const str = String(value || '');
  if (str.length <= length) return str;
  return str.slice(0, length).trim() + '...';
}

// Number formatting
export function formatNumber(value: any, decimals?: number): string {
  if (value === null || value === undefined || value === '') return '';
  
  const num = typeof value === 'number' ? value : parseFloat(String(value));
  if (isNaN(num)) return '';
  
  const options: Intl.NumberFormatOptions = {};
  if (decimals !== undefined) {
    options.minimumFractionDigits = decimals;
    options.maximumFractionDigits = decimals;
  }
  
  return new Intl.NumberFormat('en-US', options).format(num);
}

// Percent formatting
export function formatPercent(value: any, decimals: number = 0): string {
  if (value === null || value === undefined || value === '') return '';
  
  const num = typeof value === 'number' ? value : parseFloat(String(value));
  if (isNaN(num)) return '';
  
  return new Intl.NumberFormat('en-US', {
    style: 'percent',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num / 100);
}

// HTML escaping (default behavior)
export function escapeHtml(value: any): string {
  const str = String(value || '');
  const htmlEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return str.replace(/[&<>"']/g, (char) => htmlEscapes[char]);
}

// Raw output (bypass escaping)
export function formatRaw(value: any): string {
  return String(value || '');
}

// Apply a pipe transformation
export function applyPipe(value: any, pipeName: string, pipeArg?: string): string {
  switch (pipeName.toLowerCase()) {
    case 'date':
      return formatDate(value, pipeArg);
    case 'money':
    case 'currency':
      return formatMoney(value, pipeArg);
    case 'phone':
      return formatPhone(value);
    case 'upper':
    case 'uppercase':
      return formatUpper(value);
    case 'lower':
    case 'lowercase':
      return formatLower(value);
    case 'title':
    case 'titlecase':
      return formatTitle(value);
    case 'truncate':
      return formatTruncate(value, pipeArg ? parseInt(pipeArg, 10) : 100);
    case 'number':
      return formatNumber(value, pipeArg ? parseInt(pipeArg, 10) : undefined);
    case 'percent':
      return formatPercent(value, pipeArg ? parseInt(pipeArg, 10) : 0);
    case 'raw':
      return formatRaw(value);
    default:
      return escapeHtml(value);
  }
}
