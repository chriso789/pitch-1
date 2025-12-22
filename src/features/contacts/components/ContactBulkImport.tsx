import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Upload, FileText, AlertCircle, CheckCircle2 } from "lucide-react";
import Papa from "papaparse";
import { supabase } from "@/integrations/supabase/client";

interface ContactImportData {
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  secondary_email?: string;
  secondary_phone?: string;
  additional_emails?: string[];
  additional_phones?: string[];
  company_name?: string;
  address_street?: string;
  address_city?: string;
  address_state?: string;
  address_zip?: string;
  lead_source?: string;
  tags?: string;
  notes?: string;
  sales_rep_name?: string; // Name from CSV to match against profiles
}

interface ProfileMatch {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

interface ContactBulkImportProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportComplete: () => void;
  currentLocationId?: string | null;
}

// Smart column mapping - maps common CSV column names to our expected fields
const COLUMN_MAPPINGS: Record<string, string> = {
  // Name variations
  'first_name': 'first_name',
  'firstname': 'first_name',
  'first name': 'first_name',
  'first': 'first_name',
  'fname': 'first_name',
  'given name': 'first_name',
  'last_name': 'last_name',
  'lastname': 'last_name',
  'last name': 'last_name',
  'last': 'last_name',
  'lname': 'last_name',
  'surname': 'last_name',
  'family name': 'last_name',
  'name': 'full_name',
  'full_name': 'full_name',
  'fullname': 'full_name',
  'full name': 'full_name',
  'contact name': 'full_name',
  'customer name': 'full_name',
  'client name': 'full_name',
  
  // Primary Email variations
  'email': 'email',
  'email_address': 'email',
  'email address': 'email',
  'e-mail': 'email',
  'emailaddress': 'email',
  'email_1': 'email',
  'email 1': 'email',
  'email1': 'email',
  'primary email': 'email',
  'primary_email': 'email',
  'contact email': 'email',
  'main email': 'email',
  'home email': 'email',
  'work email': 'email',
  'email 1 - value': 'email',
  'person.email': 'email',
  'skiptrace:email': 'email',
  'skiptrace:person.email': 'email',
  
  // Secondary Email variations
  'email_2': 'secondary_email',
  'email 2': 'secondary_email',
  'email2': 'secondary_email',
  'secondary email': 'secondary_email',
  'secondary_email': 'secondary_email',
  'alternate email': 'secondary_email',
  'alt email': 'secondary_email',
  'other email': 'secondary_email',
  'email 2 - value': 'secondary_email',
  
  // Additional Emails (3+)
  'email_3': 'additional_email',
  'email 3': 'additional_email',
  'email3': 'additional_email',
  'email 3 - value': 'additional_email',
  'email_4': 'additional_email',
  'email 4': 'additional_email',
  'email4': 'additional_email',
  'email 4 - value': 'additional_email',
  
  // Primary Phone variations
  'phone': 'phone',
  'phone_number': 'phone',
  'phone number': 'phone',
  'phonenumber': 'phone',
  'telephone': 'phone',
  'mobile': 'phone',
  'cell': 'phone',
  'cell phone': 'phone',
  'mobile phone': 'phone',
  'phone_1': 'phone',
  'phone 1': 'phone',
  'phone1': 'phone',
  'primary phone': 'phone',
  'primary_phone': 'phone',
  'main phone': 'phone',
  'contact phone': 'phone',
  'mobile number': 'phone',
  'cell number': 'phone',
  'home phone': 'phone',
  'work phone': 'phone',
  'phone 1 - value': 'phone',
  'phone number 1 - value': 'phone',
  'person.phone': 'phone',
  'skiptrace:phone': 'phone',
  'skiptrace:person.phone': 'phone',
  
  // Secondary Phone variations
  'phone_2': 'secondary_phone',
  'phone 2': 'secondary_phone',
  'phone2': 'secondary_phone',
  'secondary phone': 'secondary_phone',
  'secondary_phone': 'secondary_phone',
  'alternate phone': 'secondary_phone',
  'alt phone': 'secondary_phone',
  'other phone': 'secondary_phone',
  'home phone 2': 'secondary_phone',
  'work phone 2': 'secondary_phone',
  'phone 2 - value': 'secondary_phone',
  'phone number 2 - value': 'secondary_phone',
  
  // Additional Phones (3+)
  'phone_3': 'additional_phone',
  'phone 3': 'additional_phone',
  'phone3': 'additional_phone',
  'phone 3 - value': 'additional_phone',
  'phone number 3 - value': 'additional_phone',
  'phone_4': 'additional_phone',
  'phone 4': 'additional_phone',
  'phone4': 'additional_phone',
  'phone 4 - value': 'additional_phone',
  'phone number 4 - value': 'additional_phone',
  
  // Company variations
  'company_name': 'company_name',
  'company': 'company_name',
  'company name': 'company_name',
  'companyname': 'company_name',
  'business': 'company_name',
  'business name': 'company_name',
  'organization': 'company_name',
  
  // Primary Address variations
  'address_street': 'address_street',
  'address': 'address_street',
  'street': 'address_street',
  'street address': 'address_street',
  'address1': 'address_street',
  'address_1': 'address_street',
  'address 1': 'address_street',
  'address line 1': 'address_street',
  'street_address': 'address_street',
  'primary address': 'address_street',
  'property address': 'address_street',
  'property.address': 'address_street',
  'skiptrace:property.address': 'address_street',
  'skiptrace:property.address.address': 'address_street',
  
  'address_city': 'address_city',
  'city': 'address_city',
  'city_1': 'address_city',
  'city 1': 'address_city',
  'property.city': 'address_city',
  
  'address_state': 'address_state',
  'state': 'address_state',
  'province': 'address_state',
  'region': 'address_state',
  'state_1': 'address_state',
  'state 1': 'address_state',
  'property.state': 'address_state',
  
  'address_zip': 'address_zip',
  'zip': 'address_zip',
  'zip_code': 'address_zip',
  'zipcode': 'address_zip',
  'zip code': 'address_zip',
  'postal': 'address_zip',
  'postal_code': 'address_zip',
  'postal code': 'address_zip',
  'postalcode': 'address_zip',
  'zip_1': 'address_zip',
  'zip 1': 'address_zip',
  'property.zip': 'address_zip',
  
  // Secondary Address variations (stored in notes - NOT email!)
  'address_2': 'secondary_address',
  'address 2': 'secondary_address',
  'address2': 'secondary_address',
  'secondary address': 'secondary_address',
  'secondary_address': 'secondary_address',
  'mailing address': 'secondary_address',
  'mailing_address': 'secondary_address',
  'alternate address': 'secondary_address',
  'other address': 'secondary_address',
  
  'city_2': 'secondary_city',
  'city 2': 'secondary_city',
  'secondary city': 'secondary_city',
  
  'state_2': 'secondary_state',
  'state 2': 'secondary_state',
  'secondary state': 'secondary_state',
  
  'zip_2': 'secondary_zip',
  'zip 2': 'secondary_zip',
  'zipcode_2': 'secondary_zip',
  'secondary zip': 'secondary_zip',
  
  // Lead source variations
  'lead_source': 'lead_source',
  'source': 'lead_source',
  'leadsource': 'lead_source',
  'lead source': 'lead_source',
  'how did you hear': 'lead_source',
  
  // Tags
  'tags': 'tags',
  'tag': 'tags',
  'labels': 'tags',
  'categories': 'tags',
  
  // Sales Rep / Assigned To variations
  'assigned_to': 'sales_rep_name',
  'assigned to': 'sales_rep_name',
  'assignedto': 'sales_rep_name',
  'sales_rep': 'sales_rep_name',
  'sales rep': 'sales_rep_name',
  'salesrep': 'sales_rep_name',
  'salesman': 'sales_rep_name',
  'rep': 'sales_rep_name',
  'rep name': 'sales_rep_name',
  'property owner': 'sales_rep_name',
  'property_owner': 'sales_rep_name',
  'propertyowner': 'sales_rep_name',
  'account owner': 'sales_rep_name',
  'account_owner': 'sales_rep_name',
  'owner': 'sales_rep_name',
  'agent': 'sales_rep_name',
  'agent name': 'sales_rep_name',
  'created by': 'sales_rep_name',
  'createdby': 'sales_rep_name',
  'created_by': 'sales_rep_name',
};

/**
 * Fuzzy match column name if no direct mapping found
 * Checks if column name CONTAINS key terms
 * IMPORTANT: Excludes 'address' columns from email matching!
 */
function fuzzyMatchColumn(columnName: string, existingMappings: Record<string, boolean>): string | null {
  const normalized = columnName.toLowerCase().trim();
  
  // Skip columns that contain 'address' - they should NOT match as email!
  if (normalized.includes('address') || normalized.includes('street') || normalized.includes('mailing')) {
    return null;
  }
  
  // Skip columns that are clearly metadata/type columns
  if (normalized.includes('type') || normalized.includes('label') || normalized.includes('status')) {
    return null;
  }
  
  // Check for email - must contain 'email' or 'e-mail', NOT just 'mail' (which matches 'mailing')
  if (normalized.includes('email') || normalized.includes('e-mail')) {
    // Check if it's clearly a 3rd+ email
    if (normalized.includes('3') || normalized.includes('4') || normalized.includes('5')) {
      return 'additional_email';
    }
    // Check if it's clearly a secondary/alternate email
    if (normalized.includes('2') || normalized.includes('secondary') || normalized.includes('alt') || normalized.includes('other')) {
      return existingMappings['secondary_email'] ? 'additional_email' : 'secondary_email';
    }
    // Primary email (if not already mapped)
    if (existingMappings['email']) {
      return existingMappings['secondary_email'] ? 'additional_email' : 'secondary_email';
    }
    return 'email';
  }
  
  // Check for phone/mobile/cell
  if (normalized.includes('phone') || normalized.includes('mobile') || normalized.includes('cell') || normalized.includes('tel')) {
    // Check if it's clearly a 3rd+ phone
    if (normalized.includes('3') || normalized.includes('4') || normalized.includes('5')) {
      return 'additional_phone';
    }
    // Check if it's clearly a secondary/alternate phone
    if (normalized.includes('2') || normalized.includes('secondary') || normalized.includes('alt') || normalized.includes('other')) {
      return existingMappings['secondary_phone'] ? 'additional_phone' : 'secondary_phone';
    }
    // Primary phone (if not already mapped)
    if (existingMappings['phone']) {
      return existingMappings['secondary_phone'] ? 'additional_phone' : 'secondary_phone';
    }
    return 'phone';
  }
  
  return null;
}

/**
 * Split a full name into first and last name parts
 */
function splitFullName(fullName: string): { firstName: string; lastName: string } {
  if (!fullName || typeof fullName !== 'string') {
    return { firstName: '', lastName: '' };
  }
  
  const trimmed = fullName.trim();
  if (!trimmed) {
    return { firstName: '', lastName: '' };
  }
  
  const parts = trimmed.split(/\s+/).filter(Boolean);
  
  if (parts.length === 0) {
    return { firstName: '', lastName: '' };
  }
  
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }
  
  if (parts.length === 2) {
    return { firstName: parts[0], lastName: parts[1] };
  }
  
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' ')
  };
}

/**
 * Build additional info notes from secondary address data
 */
function buildSecondaryAddressNotes(data: Record<string, any>): string {
  const lines: string[] = [];
  
  // Secondary Address only (phones and emails are now stored in their own columns)
  const secondaryAddressParts: string[] = [];
  if (data.secondary_address) {
    const addr = String(data.secondary_address).trim();
    if (addr) secondaryAddressParts.push(addr);
  }
  if (data.secondary_city) {
    const city = String(data.secondary_city).trim();
    if (city) secondaryAddressParts.push(city);
  }
  if (data.secondary_state) {
    const state = String(data.secondary_state).trim();
    if (state) secondaryAddressParts.push(state);
  }
  if (data.secondary_zip) {
    const zip = String(data.secondary_zip).trim();
    if (zip) secondaryAddressParts.push(zip);
  }
  
  if (secondaryAddressParts.length > 0) {
    lines.push(`Secondary Address: ${secondaryAddressParts.join(', ')}`);
  }
  
  if (lines.length === 0) return '';
  
  return `--- Additional Information (from import) ---\n${lines.join('\n')}`;
}

/**
 * Normalize a CSV row using smart column mapping with fuzzy fallback
 */
function normalizeRow(rawRow: Record<string, any>): ContactImportData {
  const normalized: Record<string, any> = {};
  const mappedFields: Record<string, boolean> = {};
  let fullName = '';
  
  // Collect all emails and phones
  const allEmails: string[] = [];
  const allPhones: string[] = [];
  
  // First pass: map columns to normalized names
  for (const [rawKey, value] of Object.entries(rawRow)) {
    const normalizedKey = rawKey.toLowerCase().trim();
    const valueStr = value ? String(value).trim() : '';
    
    if (!valueStr) continue; // Skip empty values
    
    // Try direct mapping first
    let mappedField = COLUMN_MAPPINGS[normalizedKey];
    
    // If no direct mapping, try fuzzy matching
    if (!mappedField) {
      mappedField = fuzzyMatchColumn(normalizedKey, mappedFields) || undefined;
    }
    
    if (mappedField === 'full_name') {
      fullName = valueStr;
    } else if (mappedField === 'email') {
      allEmails.push(valueStr);
      mappedFields['email'] = true;
    } else if (mappedField === 'secondary_email') {
      allEmails.push(valueStr);
      mappedFields['secondary_email'] = true;
    } else if (mappedField === 'additional_email') {
      allEmails.push(valueStr);
    } else if (mappedField === 'phone') {
      allPhones.push(valueStr);
      mappedFields['phone'] = true;
    } else if (mappedField === 'secondary_phone') {
      allPhones.push(valueStr);
      mappedFields['secondary_phone'] = true;
    } else if (mappedField === 'additional_phone') {
      allPhones.push(valueStr);
    } else if (mappedField === 'sales_rep_name') {
      normalized.sales_rep_name = valueStr;
    } else if (mappedField) {
      // Only set if we don't already have a value (first match wins)
      if (!normalized[mappedField]) {
        normalized[mappedField] = valueStr;
      }
    }
  }
  
  // Deduplicate emails and phones
  const uniqueEmails = [...new Set(allEmails.filter(e => e && e.includes('@')))];
  const uniquePhones = [...new Set(allPhones.filter(p => p && p.length >= 7))];
  
  // Split full name if we don't have explicit first/last names
  if (fullName && !normalized.first_name && !normalized.last_name) {
    const { firstName, lastName } = splitFullName(fullName);
    normalized.first_name = firstName;
    normalized.last_name = lastName;
  }
  
  // Also check if first_name contains a full name (no last_name provided)
  if (normalized.first_name && !normalized.last_name) {
    const firstNameValue = String(normalized.first_name).trim();
    if (firstNameValue.includes(' ')) {
      const { firstName, lastName } = splitFullName(firstNameValue);
      normalized.first_name = firstName;
      normalized.last_name = lastName;
    }
  }
  
  // Build notes from secondary address data only
  const secondaryNotes = buildSecondaryAddressNotes(normalized);
  
  return {
    first_name: String(normalized.first_name || '').trim(),
    last_name: String(normalized.last_name || '').trim(),
    email: uniqueEmails[0] || undefined,
    phone: uniquePhones[0] || undefined,
    secondary_email: uniqueEmails[1] || undefined,
    secondary_phone: uniquePhones[1] || undefined,
    additional_emails: uniqueEmails.slice(2),
    additional_phones: uniquePhones.slice(2),
    company_name: normalized.company_name || undefined,
    address_street: normalized.address_street || undefined,
    address_city: normalized.address_city || undefined,
    address_state: normalized.address_state || undefined,
    address_zip: normalized.address_zip || undefined,
    lead_source: normalized.lead_source || undefined,
    tags: normalized.tags || undefined,
    notes: secondaryNotes || undefined,
    sales_rep_name: normalized.sales_rep_name || undefined,
  };
}

/**
 * Match a sales rep name from CSV to a profile ID
 */
function matchSalesRepToProfile(
  repName: string | undefined,
  profiles: ProfileMatch[]
): string | null {
  if (!repName || !profiles.length) return null;
  
  const normalized = repName.toLowerCase().trim();
  if (!normalized) return null;
  
  for (const profile of profiles) {
    const firstName = profile.first_name?.toLowerCase().trim() || '';
    const lastName = profile.last_name?.toLowerCase().trim() || '';
    const fullName = `${firstName} ${lastName}`.trim();
    const reverseName = `${lastName} ${firstName}`.trim();
    const emailPrefix = profile.email?.toLowerCase().split('@')[0] || '';
    
    // Exact full name match
    if (normalized === fullName || normalized === reverseName) return profile.id;
    
    // Email prefix match (e.g., "john.smith" matches john.smith@company.com)
    if (emailPrefix && normalized === emailPrefix) return profile.id;
    
    // First name only match (when there's only first name in CSV)
    if (firstName && normalized === firstName && !normalized.includes(' ')) return profile.id;
    
    // Last name only match
    if (lastName && normalized === lastName && !normalized.includes(' ')) return profile.id;
    
    // Contains match for partial names (e.g., "John" matches "John Smith")
    if (fullName && (fullName.includes(normalized) || normalized.includes(fullName))) return profile.id;
  }
  
  return null; // No match found
}

/**
 * Detect which columns were mapped from the CSV and which were unmatched
 */
function detectMappedColumns(rawHeaders: string[]): { 
  mapped: { original: string; mappedTo: string }[]; 
  unmatched: string[];
} {
  const mapped: { original: string; mappedTo: string }[] = [];
  const unmatched: string[] = [];
  const mappedFields: Record<string, boolean> = {};
  
  for (const header of rawHeaders) {
    const normalizedKey = header.toLowerCase().trim();
    let mappedField = COLUMN_MAPPINGS[normalizedKey];
    
    // Try fuzzy matching if no direct mapping
    if (!mappedField) {
      mappedField = fuzzyMatchColumn(normalizedKey, mappedFields) || undefined;
    }
    
    if (mappedField) {
      mapped.push({
        original: header,
        mappedTo: mappedField === 'full_name' ? 'first_name + last_name (split)' : mappedField
      });
      mappedFields[mappedField] = true;
    } else {
      unmatched.push(header);
    }
  }
  
  return { mapped, unmatched };
}

export function ContactBulkImport({ open, onOpenChange, onImportComplete, currentLocationId }: ContactBulkImportProps) {
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<string>('');
  const [preview, setPreview] = useState<ContactImportData[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [columnMappings, setColumnMappings] = useState<{ original: string; mappedTo: string }[]>([]);
  const [unmatchedColumns, setUnmatchedColumns] = useState<string[]>([]);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rawData = results.data as Record<string, any>[];
        
        // Detect column mappings for display
        if (results.meta.fields) {
          const { mapped, unmatched } = detectMappedColumns(results.meta.fields);
          setColumnMappings(mapped);
          setUnmatchedColumns(unmatched);
        }
        
        // Normalize all rows using smart mapping
        const normalizedData = rawData.map(row => normalizeRow(row));
        
        setTotalRows(normalizedData.length);
        setPreview(normalizedData.slice(0, 5));
      },
      error: (error) => {
        toast.error("Parse Error: " + error.message);
      }
    });
  };

  const handleImport = async () => {
    const fileInput = document.getElementById('contact-csv-upload') as HTMLInputElement;
    const file = fileInput?.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportProgress('Preparing import...');
    
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) throw new Error('Not authenticated');

          const { data: profile } = await supabase
            .from('profiles')
            .select('tenant_id')
            .eq('id', user.id)
            .single();

          if (!profile?.tenant_id) throw new Error('No tenant found');

          // Fetch all profiles for sales rep matching
          setImportProgress('Loading sales reps...');
          const { data: allProfiles } = await supabase
            .from('profiles')
            .select('id, first_name, last_name, email')
            .eq('tenant_id', profile.tenant_id);

          const profilesForMatching: ProfileMatch[] = allProfiles || [];

          const rawData = results.data as Record<string, any>[];
          const normalizedData = rawData.map(row => normalizeRow(row));
          
          // Track unmatched sales reps
          const unmatchedReps = new Set<string>();
          
          const contacts = normalizedData.map(row => {
            // Match sales rep name to profile ID
            const assignedTo = matchSalesRepToProfile(row.sales_rep_name, profilesForMatching);
            
            // Track if we couldn't match a sales rep
            if (row.sales_rep_name && !assignedTo) {
              unmatchedReps.add(row.sales_rep_name);
            }
            
            return {
              first_name: row.first_name || 'Unknown',
              last_name: row.last_name || '',
              email: row.email || null,
              phone: row.phone || null,
              secondary_email: row.secondary_email || null,
              secondary_phone: row.secondary_phone || null,
              additional_emails: row.additional_emails?.length ? row.additional_emails : [],
              additional_phones: row.additional_phones?.length ? row.additional_phones : [],
              company_name: row.company_name || null,
              address_street: row.address_street || null,
              address_city: row.address_city || null,
              address_state: row.address_state || null,
              address_zip: row.address_zip || null,
              lead_source: row.lead_source || 'csv_import',
              tags: row.tags ? row.tags.split(',').map((t: string) => t.trim()) : [],
              notes: row.notes || null,
              tenant_id: profile.tenant_id,
              location_id: currentLocationId || null,
              type: 'homeowner' as const,
              is_deleted: false,
              assigned_to: assignedTo,
            };
          });

          // Batch insert to prevent timeout for large imports
          const batchSize = 100;
          let successCount = 0;
          const totalBatches = Math.ceil(contacts.length / batchSize);

          for (let i = 0; i < contacts.length; i += batchSize) {
            const batchNumber = Math.floor(i / batchSize) + 1;
            setImportProgress(`Importing batch ${batchNumber} of ${totalBatches}...`);
            
            const batch = contacts.slice(i, i + batchSize);
            const { data, error } = await supabase
              .from('contacts')
              .insert(batch)
              .select();

            if (error) {
              console.error(`Batch ${batchNumber} failed:`, error);
              throw error;
            }
            
            successCount += data?.length || 0;
          }

          // Show success message
          toast.success(`Imported ${successCount} contacts successfully`);
          
          // Warn about unmatched sales reps
          if (unmatchedReps.size > 0) {
            const repsList = [...unmatchedReps].slice(0, 5).join(', ');
            const moreCount = unmatchedReps.size > 5 ? ` and ${unmatchedReps.size - 5} more` : '';
            toast.warning(`Some sales reps not found in system: ${repsList}${moreCount}. These contacts were left unassigned.`);
          }

          onImportComplete();
          onOpenChange(false);
          setPreview([]);
          setTotalRows(0);
          setColumnMappings([]);
          setUnmatchedColumns([]);
          setImportProgress('');
        } catch (error: any) {
          console.error('Error importing contacts:', error);
          toast.error("Import Failed: " + error.message);
        } finally {
          setImporting(false);
          setImportProgress('');
        }
      }
    });
  };

  const downloadTemplate = () => {
    const csv = "first_name,last_name,email,phone,secondary_email,secondary_phone,company_name,address_street,address_city,address_state,address_zip,lead_source,tags\nJohn,Doe,john@example.com,555-123-4567,john.backup@example.com,555-999-8888,Acme Corp,123 Main St,Miami,FL,33101,website,\"roofing,residential\"\nJane,Smith,jane@example.com,555-987-6543,,,,456 Oak Ave,Tampa,FL,33602,referral,commercial";
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'contact_import_template.csv';
    a.click();
  };

  const handleClose = () => {
    onOpenChange(false);
    setPreview([]);
    setTotalRows(0);
    setColumnMappings([]);
    setUnmatchedColumns([]);
  };

  // Count total contact methods for preview
  const countContactMethods = (row: ContactImportData) => {
    let emailCount = 0;
    let phoneCount = 0;
    if (row.email) emailCount++;
    if (row.secondary_email) emailCount++;
    emailCount += row.additional_emails?.length || 0;
    if (row.phone) phoneCount++;
    if (row.secondary_phone) phoneCount++;
    phoneCount += row.additional_phones?.length || 0;
    return { emailCount, phoneCount };
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Contacts</DialogTitle>
          <DialogDescription>
            Upload a CSV file to import multiple contacts at once. Column names are automatically detected including multiple emails and phone numbers.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2 p-4 bg-muted/50 rounded-lg">
            <AlertCircle className="h-5 w-5 text-muted-foreground shrink-0" />
            <div className="text-sm">
              <p className="font-medium">Smart Column Detection:</p>
              <p className="text-muted-foreground">
                Automatically maps columns like "name", "email", "phone", "Email 1 - Value", "Phone Number 1 - Value", skip trace data, and more. Multiple emails/phones are captured.
              </p>
            </div>
          </div>

          <Button variant="outline" onClick={downloadTemplate} className="w-full">
            <FileText className="h-4 w-4 mr-2" />
            Download CSV Template
          </Button>

          <div className="border-2 border-dashed rounded-lg p-8 text-center">
            <input
              id="contact-csv-upload"
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              className="hidden"
            />
            <label htmlFor="contact-csv-upload" className="cursor-pointer">
              <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-sm font-medium">Click to upload CSV file</p>
              <p className="text-xs text-muted-foreground mt-1">or drag and drop</p>
            </label>
          </div>

          {/* Column Mapping Display */}
          {columnMappings.length > 0 && (
            <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span className="text-sm font-medium text-green-700">Columns Detected:</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {columnMappings.map((mapping, i) => (
                  <span 
                    key={i} 
                    className="text-xs px-2 py-1 bg-background rounded border"
                    title={`"${mapping.original}" → ${mapping.mappedTo}`}
                  >
                    {mapping.original} → {mapping.mappedTo}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Unmatched Columns Warning */}
          {unmatchedColumns.length > 0 && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <span className="text-sm font-medium text-amber-700">Unmatched Columns (skipped):</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {unmatchedColumns.map((col, i) => (
                  <span 
                    key={i} 
                    className="text-xs px-2 py-1 bg-background rounded border text-muted-foreground"
                  >
                    {col}
                  </span>
                ))}
              </div>
            </div>
          )}

          {preview.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Preview ({totalRows} total rows, showing first 5):</p>
              <div className="border rounded-lg overflow-hidden overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="px-3 py-2 text-left whitespace-nowrap">First Name</th>
                      <th className="px-3 py-2 text-left whitespace-nowrap">Last Name</th>
                      <th className="px-3 py-2 text-left whitespace-nowrap">Email</th>
                      <th className="px-3 py-2 text-left whitespace-nowrap">Phone</th>
                      <th className="px-3 py-2 text-left whitespace-nowrap">City</th>
                      <th className="px-3 py-2 text-left whitespace-nowrap">Sales Rep</th>
                      <th className="px-3 py-2 text-left whitespace-nowrap">Contact Info</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => {
                      const { emailCount, phoneCount } = countContactMethods(row);
                      return (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-2">{row.first_name || '-'}</td>
                          <td className="px-3 py-2">{row.last_name || '-'}</td>
                          <td className="px-3 py-2 max-w-[150px] truncate" title={row.email}>{row.email || '-'}</td>
                          <td className="px-3 py-2">{row.phone || '-'}</td>
                          <td className="px-3 py-2">{row.address_city || '-'}</td>
                          <td className="px-3 py-2">
                            {row.sales_rep_name ? (
                              <span className="text-xs px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded">
                                {row.sales_rep_name}
                              </span>
                            ) : '-'}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex gap-2">
                              {emailCount > 1 && (
                                <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">
                                  {emailCount} emails
                                </span>
                              )}
                              {phoneCount > 1 && (
                                <span className="text-xs px-1.5 py-0.5 bg-green-100 text-green-700 rounded">
                                  {phoneCount} phones
                                </span>
                              )}
                              {emailCount <= 1 && phoneCount <= 1 && '-'}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={handleClose} disabled={importing}>
              Cancel
            </Button>
            <Button onClick={handleImport} disabled={importing || preview.length === 0}>
              {importing ? (importProgress || "Importing...") : `Import ${totalRows} Contacts`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
