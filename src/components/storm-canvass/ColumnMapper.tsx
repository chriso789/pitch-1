import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowRight, Check, AlertCircle } from 'lucide-react';

export interface ColumnMapping {
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zipcode: string | null;
  phone: string | null;
  email: string | null;
  status: string | null;
  repName: string | null;
  repEmail: string | null;
  notes: string | null;
  // Skiptrace fields for enriched data
  skiptraceFirstName: string | null;
  skiptraceLastName: string | null;
  skiptracePhone: string | null;
  skiptraceEmail: string | null;
}

interface ColumnMapperProps {
  excelColumns: string[];
  mapping: ColumnMapping;
  onMappingChange: (mapping: ColumnMapping) => void;
  onConfirm: () => void;
  sampleData: Record<string, unknown>[];
}

// CRM fields with their display names and whether they're required
const CRM_FIELDS: { key: keyof ColumnMapping; label: string; required: boolean; hint: string }[] = [
  { key: 'name', label: 'Name (First & Last)', required: true, hint: 'Homeowner full name' },
  { key: 'skiptraceFirstName', label: 'First Name (Skiptrace)', required: false, hint: 'Skiptrace first name' },
  { key: 'skiptraceLastName', label: 'Last Name (Skiptrace)', required: false, hint: 'Skiptrace last name' },
  { key: 'address', label: 'Street Address', required: true, hint: 'Property address' },
  { key: 'city', label: 'City', required: false, hint: 'City name' },
  { key: 'state', label: 'State', required: false, hint: 'State abbreviation' },
  { key: 'zipcode', label: 'Zip Code', required: false, hint: 'Postal code' },
  { key: 'phone', label: 'Phone Number', required: false, hint: 'Contact phone' },
  { key: 'skiptracePhone', label: 'Phone (Skiptrace)', required: false, hint: 'Skiptrace phone number' },
  { key: 'email', label: 'Email', required: false, hint: 'Contact email' },
  { key: 'skiptraceEmail', label: 'Email (Skiptrace)', required: false, hint: 'Skiptrace email' },
  { key: 'status', label: 'Status', required: false, hint: 'Lead status/disposition' },
  { key: 'repName', label: 'Rep Name', required: false, hint: 'Assigned sales rep name' },
  { key: 'repEmail', label: 'Rep Email', required: false, hint: 'Rep email for assignment' },
  { key: 'notes', label: 'Notes', required: false, hint: 'Additional notes' },
];

// Common column name patterns for auto-detection
const COLUMN_PATTERNS: Record<keyof ColumnMapping, string[]> = {
  name: ['ho_name', 'homeowner', 'name', 'customer_name', 'customer', 'full_name', 'contact_name', 'owner'],
  skiptraceFirstName: ['skiptrace:name.first', 'skiptrace_first', 'first_name', 'firstname'],
  skiptraceLastName: ['skiptrace:name.last', 'skiptrace_last', 'last_name', 'lastname'],
  address: ['address', 'street', 'street_address', 'property_address', 'addr', 'address1'],
  city: ['city', 'town', 'municipality'],
  state: ['state', 'st', 'province', 'region'],
  zipcode: ['zipcode', 'zip', 'zip_code', 'postal', 'postal_code', 'postalcode'],
  phone: ['phone', 'phone_number', 'phonenumber', 'tel', 'telephone', 'mobile', 'cell'],
  skiptracePhone: ['skiptrace:phonenumbers.0.number', 'skiptrace_phone', 'skiptrace:phone'],
  email: ['email', 'email_address', 'e-mail', 'mail'],
  skiptraceEmail: ['skiptrace:emails.0.email', 'skiptrace_email', 'skiptrace:email'],
  status: ['status', 'status_name', 'disposition', 'lead_status', 'result'],
  repName: ['rep_name', 'rep', 'sales_rep', 'assigned_to', 'salesperson', 'representative'],
  repEmail: ['rep email', 'rep_email', 'agent_email', 'salesperson_email'],
  notes: ['notes', 'note', 'last_note', 'comments', 'comment', 'remarks'],
};

export function ColumnMapper({ 
  excelColumns, 
  mapping, 
  onMappingChange, 
  onConfirm,
  sampleData 
}: ColumnMapperProps) {
  
  // Auto-detect column mappings based on patterns
  const autoDetectMapping = useMemo(() => {
    const detected: Partial<ColumnMapping> = {};
    
    for (const [field, patterns] of Object.entries(COLUMN_PATTERNS)) {
      const matchedColumn = excelColumns.find(col => {
        const normalizedCol = col.toLowerCase().replace(/[^a-z0-9]/g, '');
        return patterns.some(pattern => {
          const normalizedPattern = pattern.replace(/[^a-z0-9]/g, '');
          return normalizedCol === normalizedPattern ||
            normalizedCol.includes(normalizedPattern) ||
            col.toLowerCase().includes(pattern.toLowerCase());
        });
      });
      if (matchedColumn) {
        detected[field as keyof ColumnMapping] = matchedColumn;
      }
    }
    
    return detected;
  }, [excelColumns]);

  // Apply auto-detection on first render if mapping is empty
  React.useEffect(() => {
    const hasAnyMapping = Object.values(mapping).some(v => v !== null);
    if (!hasAnyMapping && Object.keys(autoDetectMapping).length > 0) {
      onMappingChange({
        ...mapping,
        ...autoDetectMapping,
      } as ColumnMapping);
    }
  }, [autoDetectMapping]);

  const handleFieldChange = (field: keyof ColumnMapping, value: string | null) => {
    onMappingChange({
      ...mapping,
      [field]: value === 'none' ? null : value,
    });
  };

  // Get sample value for a mapped column
  const getSampleValue = (columnName: string | null): string => {
    if (!columnName || sampleData.length === 0) return '-';
    const value = sampleData[0][columnName];
    if (value === undefined || value === null || value === '') return '-';
    const strValue = String(value);
    return strValue.length > 30 ? strValue.substring(0, 30) + '...' : strValue;
  };

  const requiredFieldsMapped = CRM_FIELDS
    .filter(f => f.required)
    .every(f => mapping[f.key] !== null);

  const mappedCount = Object.values(mapping).filter(v => v !== null).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Map Your Columns</span>
          <Badge variant={requiredFieldsMapped ? 'default' : 'destructive'}>
            {mappedCount} / {CRM_FIELDS.length} mapped
          </Badge>
        </CardTitle>
        <CardDescription>
          Match your Excel columns to CRM fields. Required fields are marked with *
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3">
          {CRM_FIELDS.map((field) => (
            <div 
              key={field.key} 
              className="grid grid-cols-[1fr,auto,1fr,1fr] items-center gap-3 p-3 rounded-lg bg-muted/30"
            >
              {/* CRM Field Label */}
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">
                  {field.label}
                  {field.required && <span className="text-destructive ml-1">*</span>}
                </span>
              </div>

              {/* Arrow */}
              <ArrowRight className="h-4 w-4 text-muted-foreground" />

              {/* Excel Column Selector */}
              <Select
                value={mapping[field.key] || 'none'}
                onValueChange={(value) => handleFieldChange(field.key, value)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select column..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    <span className="text-muted-foreground">Don't import</span>
                  </SelectItem>
                  {excelColumns.map((col) => (
                    <SelectItem key={col} value={col}>
                      {col}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Sample Value Preview */}
              <div className="text-xs text-muted-foreground truncate">
                {mapping[field.key] ? (
                  <span className="flex items-center gap-1">
                    <Check className="h-3 w-3 text-green-500" />
                    {getSampleValue(mapping[field.key])}
                  </span>
                ) : (
                  <span className="text-muted-foreground/60">{field.hint}</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {!requiredFieldsMapped && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span className="text-sm">Please map all required fields (Name, Address)</span>
          </div>
        )}

        <Button 
          onClick={onConfirm} 
          disabled={!requiredFieldsMapped}
          className="w-full"
          size="lg"
        >
          <Check className="h-4 w-4 mr-2" />
          Apply Mapping & Preview
        </Button>
      </CardContent>
    </Card>
  );
}