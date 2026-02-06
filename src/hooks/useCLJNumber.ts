import { useMemo } from 'react';

interface CLJData {
  contact_sequence?: number | null;
  lead_sequence?: number | null;
  job_sequence?: number | null;
  clj_formatted_number?: string | null;
}

interface UseCLJNumberResult {
  formatted: string;
  display: string;
  parts: {
    contact: string;
    lead: string;
    job: string;
  };
  isComplete: boolean;
  hasJob: boolean;
}

/**
 * Hook for consistent C-L-J number formatting across the application
 * 
 * C-L-J Format: C{contact}-L{lead}-J{job}
 * Examples:
 *   - "C12-L3-J1" = Contact #12, Lead #3, Job #1
 *   - "C5-L2-J0" = Contact #5, Lead #2, No Job yet
 *   - "C7-L0-J0" = Contact #7 only (not yet a lead)
 */
export const useCLJNumber = (data: CLJData | null | undefined): UseCLJNumberResult => {
  return useMemo(() => {
    // If already formatted, parse it
    if (data?.clj_formatted_number) {
      const match = data.clj_formatted_number.match(/C(\d+)-L(\d+)-J(\d+)/);
      if (match) {
        return {
          formatted: data.clj_formatted_number,
          display: data.clj_formatted_number,
          parts: {
            contact: match[1],
            lead: match[2],
            job: match[3],
          },
          isComplete: true,
          hasJob: parseInt(match[3]) > 0,
        };
      }
    }

    // Build from individual sequences
    const contact = data?.contact_sequence ?? 0;
    const lead = data?.lead_sequence ?? 0;
    const job = data?.job_sequence ?? 0;

    const formatted = `C${contact}-L${lead}-J${job}`;
    
    return {
      formatted,
      display: formatted,
      parts: {
        contact: String(contact),
        lead: String(lead),
        job: String(job),
      },
      isComplete: contact > 0,
      hasJob: job > 0,
    };
  }, [data?.clj_formatted_number, data?.contact_sequence, data?.lead_sequence, data?.job_sequence]);
};

/**
 * Format a C-L-J number for display
 * @param cljNumber - The raw CLJ number string
 * @param options - Formatting options
 */
export const formatCLJNumber = (
  cljNumber: string | null | undefined,
  options?: {
    showLabel?: boolean;
    compact?: boolean;
  }
): string => {
  if (!cljNumber) return options?.showLabel ? 'C-L-J: N/A' : 'N/A';
  
  if (options?.compact) {
    // Remove "C", "L", "J" prefixes for compact display
    return cljNumber.replace(/[CLJ]/g, '').replace(/--/g, '-');
  }
  
  return options?.showLabel ? `C-L-J: ${cljNumber}` : cljNumber;
};

/**
 * Parse a C-L-J number into its component parts
 */
export const parseCLJNumber = (cljNumber: string | null | undefined): {
  contact: number;
  lead: number;
  job: number;
} | null => {
  if (!cljNumber) return null;
  
  const match = cljNumber.match(/C(\d+)-L(\d+)-J(\d+)/);
  if (!match) return null;
  
  return {
    contact: parseInt(match[1], 10),
    lead: parseInt(match[2], 10),
    job: parseInt(match[3], 10),
  };
};

/**
 * Generate search patterns for C-L-J lookup
 */
export const getCLJSearchPatterns = (searchTerm: string): string[] => {
  const patterns: string[] = [];
  
  // Direct match
  patterns.push(searchTerm);
  
  // If user types just numbers separated by dashes, convert to CLJ format
  const numbersOnly = searchTerm.match(/^(\d+)-(\d+)-(\d+)$/);
  if (numbersOnly) {
    patterns.push(`C${numbersOnly[1]}-L${numbersOnly[2]}-J${numbersOnly[3]}`);
  }
  
  // If user types partial CLJ (e.g., "C12" or "C12-L")
  if (searchTerm.toUpperCase().startsWith('C')) {
    patterns.push(searchTerm.toUpperCase());
  }
  
  return patterns;
};

export default useCLJNumber;
