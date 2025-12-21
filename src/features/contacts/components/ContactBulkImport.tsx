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
  'name': 'full_name', // Special: will be split
  'full_name': 'full_name',
  'fullname': 'full_name',
  'full name': 'full_name',
  'contact name': 'full_name',
  'customer name': 'full_name',
  'client name': 'full_name',
  
  // Email variations
  'email': 'email',
  'email_address': 'email',
  'email address': 'email',
  'e-mail': 'email',
  'emailaddress': 'email',
  
  // Phone variations
  'phone': 'phone',
  'phone_number': 'phone',
  'phone number': 'phone',
  'phonenumber': 'phone',
  'telephone': 'phone',
  'mobile': 'phone',
  'cell': 'phone',
  'cell phone': 'phone',
  'mobile phone': 'phone',
  
  // Company variations
  'company_name': 'company_name',
  'company': 'company_name',
  'company name': 'company_name',
  'companyname': 'company_name',
  'business': 'company_name',
  'business name': 'company_name',
  'organization': 'company_name',
  
  // Address variations
  'address_street': 'address_street',
  'address': 'address_street',
  'street': 'address_street',
  'street address': 'address_street',
  'address1': 'address_street',
  'address_1': 'address_street',
  'address line 1': 'address_street',
  
  'address_city': 'address_city',
  'city': 'address_city',
  
  'address_state': 'address_state',
  'state': 'address_state',
  'province': 'address_state',
  'region': 'address_state',
  
  'address_zip': 'address_zip',
  'zip': 'address_zip',
  'zip_code': 'address_zip',
  'zipcode': 'address_zip',
  'zip code': 'address_zip',
  'postal': 'address_zip',
  'postal_code': 'address_zip',
  'postal code': 'address_zip',
  'postalcode': 'address_zip',
  
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
 * Normalize a CSV row using smart column mapping
 */
function normalizeRow(rawRow: Record<string, any>): ContactImportData {
  const normalized: Record<string, any> = {};
  let fullName = '';
  
  // First pass: map columns to normalized names
  for (const [rawKey, value] of Object.entries(rawRow)) {
    const normalizedKey = rawKey.toLowerCase().trim();
    const mappedField = COLUMN_MAPPINGS[normalizedKey];
    
    if (mappedField === 'full_name') {
      // Store full name for splitting later
      fullName = String(value || '').trim();
    } else if (mappedField) {
      normalized[mappedField] = value;
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
  };
}

/**
 * Detect which columns were mapped from the CSV
 */
function detectMappedColumns(rawHeaders: string[]): { original: string; mappedTo: string }[] {
  const mappings: { original: string; mappedTo: string }[] = [];
  
  for (const header of rawHeaders) {
    const normalizedKey = header.toLowerCase().trim();
    const mappedField = COLUMN_MAPPINGS[normalizedKey];
    
    if (mappedField) {
      mappings.push({
        original: header,
        mappedTo: mappedField === 'full_name' ? 'first_name + last_name (split)' : mappedField
      });
    }
  }
  
  return mappings;
}

export function ContactBulkImport({ open, onOpenChange, onImportComplete, currentLocationId }: ContactBulkImportProps) {
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<ContactImportData[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [columnMappings, setColumnMappings] = useState<{ original: string; mappedTo: string }[]>([]);

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
          const mappings = detectMappedColumns(results.meta.fields);
          setColumnMappings(mappings);
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

          {preview.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Preview ({totalRows} total rows, showing first 5):</p>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="px-3 py-2 text-left">First Name</th>
                      <th className="px-3 py-2 text-left">Last Name</th>
                      <th className="px-3 py-2 text-left">Email</th>
                      <th className="px-3 py-2 text-left">Phone</th>
                      <th className="px-3 py-2 text-left">City</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-3 py-2">{row.first_name || '-'}</td>
                        <td className="px-3 py-2">{row.last_name || '-'}</td>
                        <td className="px-3 py-2">{row.email || '-'}</td>
                        <td className="px-3 py-2">{row.phone || '-'}</td>
                        <td className="px-3 py-2">{row.address_city || '-'}</td>
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
