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
  company_name?: string;
  address_street?: string;
  address_city?: string;
  address_state?: string;
  address_zip?: string;
  lead_source?: string;
  tags?: string;
  notes?: string; // Contains secondary addresses, phones, emails from import
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
  
  // Secondary Email variations (stored in notes)
  'email_2': 'secondary_email',
  'email 2': 'secondary_email',
  'email2': 'secondary_email',
  'secondary email': 'secondary_email',
  'secondary_email': 'secondary_email',
  'alternate email': 'secondary_email',
  'alt email': 'secondary_email',
  'other email': 'secondary_email',
  
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
  
  // Secondary Phone variations (stored in notes)
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
  
  'address_city': 'address_city',
  'city': 'address_city',
  'city_1': 'address_city',
  'city 1': 'address_city',
  
  'address_state': 'address_state',
  'state': 'address_state',
  'province': 'address_state',
  'region': 'address_state',
  'state_1': 'address_state',
  'state 1': 'address_state',
  
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
  
  // Secondary Address variations (stored in notes)
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
};

/**
 * Fuzzy match column name if no direct mapping found
 * Checks if column name CONTAINS key terms
 */
function fuzzyMatchColumn(columnName: string): string | null {
  const normalized = columnName.toLowerCase().trim();
  
  // Check for email (primary first, then secondary)
  if (normalized.includes('email') || normalized.includes('e-mail') || normalized.includes('mail')) {
    // Check if it's clearly a secondary/alternate email
    if (normalized.includes('2') || normalized.includes('secondary') || normalized.includes('alt') || normalized.includes('other')) {
      return 'secondary_email';
    }
    return 'email';
  }
  
  // Check for phone/mobile/cell (primary first, then secondary)
  if (normalized.includes('phone') || normalized.includes('mobile') || normalized.includes('cell') || normalized.includes('tel')) {
    // Check if it's clearly a secondary/alternate phone
    if (normalized.includes('2') || normalized.includes('secondary') || normalized.includes('alt') || normalized.includes('other')) {
      return 'secondary_phone';
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
  
  // Split by whitespace
  const parts = trimmed.split(/\s+/).filter(Boolean);
  
  if (parts.length === 0) {
    return { firstName: '', lastName: '' };
  }
  
  if (parts.length === 1) {
    // Just one name - use as first name
    return { firstName: parts[0], lastName: '' };
  }
  
  if (parts.length === 2) {
    // Standard "First Last" format
    return { firstName: parts[0], lastName: parts[1] };
  }
  
  // More than 2 parts - assume first word is first name, rest is last name
  // This handles "Mary Jane Watson" -> "Mary" + "Jane Watson"
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' ')
  };
}

/**
 * Build additional info notes from secondary data
 */
function buildSecondaryDataNotes(data: Record<string, any>): string {
  const lines: string[] = [];
  
  // Secondary Phone
  if (data.secondary_phone) {
    const phone = String(data.secondary_phone).trim();
    if (phone) lines.push(`Secondary Phone: ${phone}`);
  }
  
  // Secondary Email
  if (data.secondary_email) {
    const email = String(data.secondary_email).trim();
    if (email) lines.push(`Secondary Email: ${email}`);
  }
  
  // Secondary Address
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
  
  return `--- Additional Contact Information (from import) ---\n${lines.join('\n')}`;
}

/**
 * Normalize a CSV row using smart column mapping with fuzzy fallback
 */
function normalizeRow(rawRow: Record<string, any>): ContactImportData {
  const normalized: Record<string, any> = {};
  let fullName = '';
  
  // First pass: map columns to normalized names
  for (const [rawKey, value] of Object.entries(rawRow)) {
    const normalizedKey = rawKey.toLowerCase().trim();
    
    // Try direct mapping first
    let mappedField = COLUMN_MAPPINGS[normalizedKey];
    
    // If no direct mapping, try fuzzy matching
    if (!mappedField) {
      mappedField = fuzzyMatchColumn(normalizedKey) || undefined;
    }
    
    if (mappedField === 'full_name') {
      fullName = String(value || '').trim();
    } else if (mappedField) {
      // Only set if we don't already have a value (first match wins for primary fields)
      if (!normalized[mappedField] || mappedField.startsWith('secondary_')) {
        normalized[mappedField] = value;
      }
    }
  }
  
  // Second pass: split full name if we don't have explicit first/last names
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
  
  // Build notes from secondary data
  const secondaryNotes = buildSecondaryDataNotes(normalized);
  
  return {
    first_name: String(normalized.first_name || '').trim(),
    last_name: String(normalized.last_name || '').trim(),
    email: normalized.email ? String(normalized.email).trim() : undefined,
    phone: normalized.phone ? String(normalized.phone).trim() : undefined,
    company_name: normalized.company_name ? String(normalized.company_name).trim() : undefined,
    address_street: normalized.address_street ? String(normalized.address_street).trim() : undefined,
    address_city: normalized.address_city ? String(normalized.address_city).trim() : undefined,
    address_state: normalized.address_state ? String(normalized.address_state).trim() : undefined,
    address_zip: normalized.address_zip ? String(normalized.address_zip).trim() : undefined,
    lead_source: normalized.lead_source ? String(normalized.lead_source).trim() : undefined,
    tags: normalized.tags ? String(normalized.tags).trim() : undefined,
    notes: secondaryNotes || undefined,
  };
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
  
  for (const header of rawHeaders) {
    const normalizedKey = header.toLowerCase().trim();
    let mappedField = COLUMN_MAPPINGS[normalizedKey];
    
    // Try fuzzy matching if no direct mapping
    if (!mappedField) {
      mappedField = fuzzyMatchColumn(normalizedKey) || undefined;
    }
    
    if (mappedField) {
      mapped.push({
        original: header,
        mappedTo: mappedField === 'full_name' ? 'first_name + last_name (split)' : mappedField
      });
    } else {
      unmatched.push(header);
    }
  }
  
  return { mapped, unmatched };
}

export function ContactBulkImport({ open, onOpenChange, onImportComplete, currentLocationId }: ContactBulkImportProps) {
  const [importing, setImporting] = useState(false);
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

          const rawData = results.data as Record<string, any>[];
          const normalizedData = rawData.map(row => normalizeRow(row));
          
          const contacts = normalizedData.map(row => ({
            first_name: row.first_name || 'Unknown',
            last_name: row.last_name || '',
            email: row.email || null,
            phone: row.phone || null,
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
            is_deleted: false
          }));

          const { data, error } = await supabase
            .from('contacts')
            .insert(contacts)
            .select();

          if (error) throw error;

          toast.success(`Imported ${data.length} contacts successfully`);

          onImportComplete();
          onOpenChange(false);
          setPreview([]);
          setTotalRows(0);
          setColumnMappings([]);
          setUnmatchedColumns([]);
        } catch (error: any) {
          console.error('Error importing contacts:', error);
          toast.error("Import Failed: " + error.message);
        } finally {
          setImporting(false);
        }
      }
    });
  };

  const downloadTemplate = () => {
    const csv = "first_name,last_name,email,phone,company_name,address_street,address_city,address_state,address_zip,lead_source,tags\nJohn,Doe,john@example.com,555-123-4567,Acme Corp,123 Main St,Miami,FL,33101,website,\"roofing,residential\"\nJane,Smith,jane@example.com,555-987-6543,,456 Oak Ave,Tampa,FL,33602,referral,commercial";
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

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Contacts</DialogTitle>
          <DialogDescription>
            Upload a CSV file to import multiple contacts at once. Column names are automatically detected.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2 p-4 bg-muted/50 rounded-lg">
            <AlertCircle className="h-5 w-5 text-muted-foreground shrink-0" />
            <div className="text-sm">
              <p className="font-medium">Smart Column Detection:</p>
              <p className="text-muted-foreground">
                Automatically maps columns like "name", "Name", "Full Name", "firstName", "email address", "phone number", "city", "zip", etc.
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
                      <th className="px-3 py-2 text-left whitespace-nowrap">Additional Info</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-3 py-2">{row.first_name || '-'}</td>
                        <td className="px-3 py-2">{row.last_name || '-'}</td>
                        <td className="px-3 py-2 max-w-[150px] truncate" title={row.email}>{row.email || '-'}</td>
                        <td className="px-3 py-2">{row.phone || '-'}</td>
                        <td className="px-3 py-2">{row.address_city || '-'}</td>
                        <td className="px-3 py-2">
                          {row.notes ? (
                            <span className="text-xs text-muted-foreground" title={row.notes}>
                              ✓ Has secondary data
                            </span>
                          ) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button onClick={handleImport} disabled={importing || preview.length === 0}>
              {importing ? "Importing..." : `Import ${totalRows} Contacts`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
