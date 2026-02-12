import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Upload, FileText, AlertCircle, CheckCircle2, MapPin, UserCheck, UserX, UserPlus } from "lucide-react";
import Papa from "papaparse";
import { supabase } from "@/integrations/supabase/client";
import { useLocation } from "@/contexts/LocationContext";

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
  qualification_status?: string; // Status/disposition from CSV
  estimated_value?: string; // Estimated amount/contract price from CSV
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
  // Owner/Homeowner name variations (for contact's name, NOT sales rep)
  'owner name': 'full_name',
  'owner_name': 'full_name',
  'ownername': 'full_name',
  'property owner name': 'full_name',
  'property_owner_name': 'full_name',
  'homeowner': 'full_name',
  'homeowner name': 'full_name',
  'homeowner_name': 'full_name',
  'home owner': 'full_name',
  'home owner name': 'full_name',
  'customer': 'full_name',
  'contact': 'full_name',
  'person': 'full_name',
  'person name': 'full_name',
  'lead name': 'full_name',
  'lead_name': 'full_name',
  'leadname': 'full_name',
  'resident': 'full_name',
  'resident name': 'full_name',
  
  // Job name variations (often contains homeowner name)
  'job name': 'full_name',
  'job_name': 'full_name',
  'jobname': 'full_name',
  'job': 'full_name',
  
  // Skiptrace name formats (nested dot notation)
  'skiptrace:name.first': 'first_name',
  'skiptrace:name.last': 'last_name',
  'skiptrace:name.middle': 'middle_name',
  'skiptrace:property.owner.name.first': 'first_name',
  'skiptrace:property.owner.name.last': 'last_name',
  'skiptrace:property.owner.name.middle': 'middle_name',
  
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
  // Location Address variations
  'location address': 'address_street',
  'location_address': 'address_street',
  'locationaddress': 'address_street',
  
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
  
  // Skiptrace address formats
  'skiptrace:mailingaddress.street': 'address_street',
  'skiptrace:mailingaddress.city': 'address_city',
  'skiptrace:mailingaddress.state': 'address_state',
  'skiptrace:mailingaddress.zip': 'address_zip',
  'skiptrace:property.address.street': 'address_street',
  'skiptrace:property.address.city': 'address_city',
  'skiptrace:property.address.state': 'address_state',
  'skiptrace:property.address.zip': 'address_zip',
  'skiptrace:property.address.county': 'county',
  'skiptrace:property.owner.mailingaddress.street': 'secondary_address',
  'skiptrace:property.owner.mailingaddress.city': 'secondary_city',
  'skiptrace:property.owner.mailingaddress.state': 'secondary_state',
  'skiptrace:property.owner.mailingaddress.zip': 'secondary_zip',
  
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
  // NOTE: "owner", "property owner" etc. are mapped to full_name above (contact's name)
  // These are for the INTERNAL sales rep assignment only
  'assigned_to': 'sales_rep_name',
  'assigned to': 'sales_rep_name',
  'assignedto': 'sales_rep_name',
  'sales_rep': 'sales_rep_name',
  'sales rep': 'sales_rep_name',
  'salesrep': 'sales_rep_name',
  'salesman': 'sales_rep_name',
  'rep': 'sales_rep_name',
  'rep name': 'sales_rep_name',
  'account owner': 'sales_rep_name',
  'account_owner': 'sales_rep_name',
  'agent': 'sales_rep_name',
  'agent name': 'sales_rep_name',
  'created by': 'sales_rep_name',
  'createdby': 'sales_rep_name',
  'created_by': 'sales_rep_name',
  // Primary Salesperson variations (common CRM export format)
  'primary salesperson': 'sales_rep_name',
  'primary_salesperson': 'sales_rep_name',
  'primarysalesperson': 'sales_rep_name',
  'salesperson': 'sales_rep_name',
  'sales person': 'sales_rep_name',
  'salesperson name': 'sales_rep_name',
  
  // Status / Qualification Status variations
  'status': 'qualification_status',
  'qualification_status': 'qualification_status',
  'qualification status': 'qualification_status',
  'lead_status': 'qualification_status',
  'lead status': 'qualification_status',
  'disposition': 'qualification_status',
  'contact_status': 'qualification_status',
  'contact status': 'qualification_status',
  'stage': 'qualification_status',
  'pipeline_stage': 'qualification_status',
  'pipeline stage': 'qualification_status',
  'result': 'qualification_status',
  'outcome': 'qualification_status',
  // Current Milestone variations (common CRM export format)
  'current milestone': 'qualification_status',
  'current_milestone': 'qualification_status',
  'currentmilestone': 'qualification_status',
  'milestone': 'qualification_status',
  
  // Estimated Value / Contract Price variations
  'estimated': 'estimated_value',
  'estimated amount': 'estimated_value',
  'estimated_amount': 'estimated_value',
  'estimatedamount': 'estimated_value',
  'estimate': 'estimated_value',
  'estimate amount': 'estimated_value',
  'contract price': 'estimated_value',
  'contract_price': 'estimated_value',
  'contractprice': 'estimated_value',
  'contract amount': 'estimated_value',
  'contract_amount': 'estimated_value',
  'contract value': 'estimated_value',
  'job value': 'estimated_value',
  'job_value': 'estimated_value',
  'job amount': 'estimated_value',
  'job price': 'estimated_value',
  'price': 'estimated_value',
  'amount': 'estimated_value',
  'value': 'estimated_value',
  'total': 'estimated_value',
  'total amount': 'estimated_value',
  'total_amount': 'estimated_value',
  'deal value': 'estimated_value',
  'deal_value': 'estimated_value',
};

/**
 * Smart pattern matching for Skiptrace nested column names
 * Handles formats like "Skiptrace:name.first", "Skiptrace:property.owner.mailingAddress.city"
 */
function matchSkiptraceColumn(columnName: string): string | null {
  const lower = columnName.toLowerCase().trim();
  
  // Check if it's a Skiptrace column
  if (!lower.startsWith('skiptrace:')) return null;
  
  // Extract the path after "skiptrace:"
  const path = lower.replace('skiptrace:', '');
  
  // Name patterns - prioritize property.owner for homeowner data
  if (path.includes('name.first') || path.endsWith('.first')) return 'first_name';
  if (path.includes('name.last') || path.endsWith('.last')) return 'last_name';
  if (path.includes('name.middle') || path.endsWith('.middle')) return 'middle_name';
  
  // IMPORTANT: Check owner mailing FIRST (before generic mailing) - these go to secondary_*
  if (path.includes('owner') && (path.includes('mailing') || path.includes('mailingaddress'))) {
    if (path.includes('street') || path.endsWith('.address')) return 'secondary_address';
    if (path.includes('city')) return 'secondary_city';
    if (path.includes('state')) return 'secondary_state';
    if (path.includes('zip') || path.includes('postal')) return 'secondary_zip';
  }
  
  // Property address patterns (preferred for primary address)
  if (path.includes('property.address') && !path.includes('owner')) {
    if (path.includes('street') || path.endsWith('.address')) return 'address_street';
    if (path.includes('city')) return 'address_city';
    if (path.includes('state')) return 'address_state';
    if (path.includes('zip') || path.includes('postal')) return 'address_zip';
    if (path.includes('county')) return 'county';
  }
  
  // Generic mailing address patterns (use for primary address if no property.address)
  if (path.includes('mailingaddress') || path.includes('mailing')) {
    if (path.includes('street') || path.endsWith('.address')) return 'address_street';
    if (path.includes('city')) return 'address_city';
    if (path.includes('state')) return 'address_state';
    if (path.includes('zip') || path.includes('postal')) return 'address_zip';
  }
  
  // Phone patterns
  if (path.includes('phone') || path.includes('mobile') || path.includes('cell')) {
    return 'phone';
  }
  
  // Email patterns
  if (path.includes('email')) {
    return 'email';
  }
  
  return null;
}

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
  
  // Skip columns that are clearly metadata/type columns (but NOT status - we want that!)
  if (normalized.includes('type') || normalized.includes('label')) {
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
    
    // If no direct mapping, try Skiptrace pattern matching
    if (!mappedField) {
      mappedField = matchSkiptraceColumn(rawKey) || undefined;
    }
    
    // If still no mapping, try fuzzy matching
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
    } else if (mappedField === 'qualification_status') {
      normalized.qualification_status = valueStr;
    } else if (mappedField === 'estimated_value') {
      normalized.estimated_value = valueStr;
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
  
  // Normalize status value
  const normalizedStatus = normalizeStatus(normalized.qualification_status);
  
  // Extract city from address if not already set
  let city = normalized.address_city;
  if (!city && normalized.address_street) {
    city = extractCityFromAddress(normalized.address_street);
  }
  
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
    address_city: city || undefined,
    address_state: normalized.address_state || undefined,
    address_zip: normalized.address_zip || undefined,
    lead_source: normalized.lead_source || undefined,
    tags: normalized.tags || undefined,
    notes: secondaryNotes || undefined,
    sales_rep_name: normalized.sales_rep_name || undefined,
    qualification_status: normalizedStatus || undefined,
    estimated_value: normalized.estimated_value || undefined,
  };
}

/**
 * Extract city from a full address string
 * Handles formats like:
 * - "123 Main St, Sarasota, FL 34231"
 * - "123 Main St, Sarasota FL 34231"
 */
function extractCityFromAddress(address: string): string | null {
  if (!address) return null;
  
  // Known Florida cities for matching (common in this business)
  const KNOWN_CITIES = [
    'sarasota', 'venice', 'bradenton', 'naples', 'tampa', 
    'st petersburg', 'st. petersburg', 'clearwater', 'lakewood ranch', 
    'palmetto', 'punta gorda', 'port charlotte', 'englewood',
    'north port', 'osprey', 'nokomis', 'siesta key', 'longboat key',
    'anna maria', 'holmes beach', 'ellenton', 'parrish', 'myakka city',
    'arcadia', 'fort myers', 'cape coral', 'bonita springs', 'estero',
    'orlando', 'kissimmee', 'jacksonville', 'gainesville', 'ocala',
    'miami', 'fort lauderdale', 'west palm beach', 'boca raton',
    'delray beach', 'boynton beach', 'jupiter', 'stuart', 'vero beach'
  ];
  
  const normalized = address.toLowerCase();
  
  // Check if any known city appears in the address
  for (const city of KNOWN_CITIES) {
    if (normalized.includes(city)) {
      // Return properly capitalized
      return city.split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    }
  }
  
  // Try to parse from comma-separated format: "Street, City, State ZIP"
  const parts = address.split(',').map(p => p.trim());
  if (parts.length >= 2) {
    // Second part is usually city - remove state and zip if present
    const potentialCity = parts[1]
      .replace(/\s+(FL|CA|TX|NY|GA|NC|SC|OH|PA|NJ|VA|MD|MA|CT|CO|AZ|WA|OR|NV|TN|AL|LA|KY|IN|MO|WI|MN|IA|KS|AR|OK|MS|UT|NM|NE|WV|ID|HI|ME|NH|RI|MT|DE|SD|ND|AK|VT|WY|DC)\s*\d{5}(-\d{4})?$/i, '')
      .trim();
    if (potentialCity && potentialCity.length > 1 && !/^\d+$/.test(potentialCity)) {
      return potentialCity;
    }
  }
  
  return null;
}

/**
 * Parse estimated value from CSV (handles currency symbols, commas, etc.)
 */
function parseEstimatedValue(value: string | undefined): number | null {
  if (!value) return null;
  // Remove currency symbols, commas, whitespace, and common prefixes
  const cleaned = value.replace(/[$€£,\s]/g, '').trim();
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Special company name mappings to sales rep names
 * When CSV contains a company name instead of a person name, map it to the correct rep
 */
const COMPANY_TO_REP_MAPPING: Record<string, string> = {
  "o'brien contracting": 'chris o',
  'obrien contracting': 'chris o',
  "o'brien contracting usa": 'chris o',
  'obrien contracting usa': 'chris o',
  "o'brien": 'chris o',
  'obrien': 'chris o',
};

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
  
  // Check if this is a company name that should map to a specific rep
  const mappedRepName = COMPANY_TO_REP_MAPPING[normalized];
  if (mappedRepName) {
    // Find the mapped rep in profiles
    for (const profile of profiles) {
      const firstName = profile.first_name?.toLowerCase().trim() || '';
      const lastName = profile.last_name?.toLowerCase().trim() || '';
      const fullName = `${firstName} ${lastName}`.trim();
      
      if (fullName === mappedRepName || `${firstName} ${lastName.charAt(0)}` === mappedRepName) {
        return profile.id;
      }
    }
  }
  
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
 * Known metadata column patterns that are safe to ignore
 * These are columns from skip trace services that contain metadata, not contact data
 * NOTE: 'status' is NOT included here - we want to map it to qualification_status!
 */
const METADATA_COLUMN_PATTERNS = [
  // Type columns (but NOT status - we want that for qualification_status!)
  /\btype$/i, /\btype\s*$/i, /:type$/i,
  /\blabel$/i, /:label$/i,
  /\bvalidity$/i, /:validity$/i,
  // Compliance/flag columns
  /\bdeceased$/i, /\blitigator$/i, /\bdnc$/i, /\btcpa$/i,
  /\bdo.?not.?call$/i, /\bmatched$/i,
  // Meta/timestamp columns  
  /\bmeta$/i, /:meta$/i,
  /\bdate$/i, /\btime$/i, /\btimestamp$/i,
  // Auto-generated empty columns
  /^column\s*\d+$/i, /^_\d+$/, /^field\s*\d+$/i,
  // Input data prefix (duplicates of skiptrace data)
  /^input\s*data:/i,
  // Notes/results columns from services
  /\bnotes?$/i, /\bresult$/i, /\bscore$/i,
  // Coordinate data we don't use
  /\blatitude$/i, /\blongitude$/i, /\blat$/i, /\blng$/i,
];

/**
 * Check if a column name matches known metadata patterns
 */
function isMetadataColumn(columnName: string): boolean {
  const normalized = columnName.toLowerCase().trim();
  return METADATA_COLUMN_PATTERNS.some(pattern => pattern.test(normalized));
}

/**
 * Check if a column is a duplicate of mapped data (e.g., "Input Data:name" when "Skiptrace:name" is mapped)
 */
function isDuplicateColumn(columnName: string, mappedColumns: { original: string; mappedTo: string }[]): boolean {
  const normalized = columnName.toLowerCase().trim();
  
  // Check if this is an "Input Data:" column that duplicates a mapped column
  if (normalized.startsWith('input data:')) {
    const fieldPart = normalized.replace('input data:', '').trim();
    
    // Check if a similar field was already mapped (from Skiptrace or direct)
    return mappedColumns.some(m => {
      const mappedNormalized = m.original.toLowerCase().trim();
      // Check if skiptrace version is mapped
      if (mappedNormalized.includes(fieldPart)) return true;
      // Check for common field equivalents
      if (fieldPart.includes('name') && m.mappedTo.includes('name')) return true;
      if (fieldPart.includes('email') && m.mappedTo.includes('email')) return true;
      if (fieldPart.includes('phone') && m.mappedTo.includes('phone')) return true;
      if (fieldPart.includes('address') && m.mappedTo.includes('address')) return true;
      if (fieldPart.includes('city') && m.mappedTo.includes('city')) return true;
      if (fieldPart.includes('state') && m.mappedTo.includes('state')) return true;
      if (fieldPart.includes('zip') && m.mappedTo.includes('zip')) return true;
      return false;
    });
  }
  
  return false;
}

/**
 * Categorize unmatched columns into metadata (safe to ignore) and truly unmatched
 */
interface ColumnAnalysis {
  mapped: { original: string; mappedTo: string }[];
  metadata: string[];      // Safe to ignore - metadata columns
  duplicates: string[];    // Safe to ignore - duplicates of mapped data
  unmatched: string[];     // Potentially important unmapped columns
}

/**
 * Detect which columns were mapped from the CSV and which were unmatched
 */
function detectMappedColumns(rawHeaders: string[]): ColumnAnalysis {
  const mapped: { original: string; mappedTo: string }[] = [];
  const metadata: string[] = [];
  const duplicates: string[] = [];
  const unmatched: string[] = [];
  const mappedFields: Record<string, boolean> = {};
  
  // First pass: identify mapped columns
  for (const header of rawHeaders) {
    const normalizedKey = header.toLowerCase().trim();
    let mappedField = COLUMN_MAPPINGS[normalizedKey];
    
    // Try Skiptrace pattern matching if no direct mapping
    if (!mappedField) {
      mappedField = matchSkiptraceColumn(header) || undefined;
    }
    
    // Try fuzzy matching if still no mapping
    if (!mappedField) {
      mappedField = fuzzyMatchColumn(normalizedKey, mappedFields) || undefined;
    }
    
    if (mappedField) {
      mapped.push({
        original: header,
        mappedTo: mappedField === 'full_name' ? 'first_name + last_name (split)' : mappedField
      });
      mappedFields[mappedField] = true;
    }
  }
  
  // Second pass: categorize unmapped columns
  for (const header of rawHeaders) {
    const normalizedKey = header.toLowerCase().trim();
    const isMapped = mapped.some(m => m.original === header);
    
    if (!isMapped) {
      if (isMetadataColumn(header)) {
        metadata.push(header);
      } else if (isDuplicateColumn(header, mapped)) {
        duplicates.push(header);
      } else {
        unmatched.push(header);
      }
    }
  }
  
  return { mapped, metadata, duplicates, unmatched };
}

/**
 * Detect if headers look like auto-generated names (_1, _2, etc.) indicating missing header row
 */
function detectHeaderStatus(fields: string[]): { 
  status: 'ok' | 'missing' | 'suspicious';
  genericCount: number;
  totalCount: number;
  message: string;
} {
  if (!fields || fields.length === 0) {
    return { status: 'missing', genericCount: 0, totalCount: 0, message: 'No headers detected in file.' };
  }
  
  // Pattern to detect auto-generated column names like _1, _2, _81, etc.
  const genericPattern = /^_\d+$/;
  const genericCount = fields.filter(f => genericPattern.test(f.trim())).length;
  const totalCount = fields.length;
  
  // If more than 50% of columns are generic, likely missing headers
  if (genericCount / totalCount >= 0.5) {
    return { 
      status: 'missing', 
      genericCount, 
      totalCount,
      message: `Your CSV appears to have no header row. Detected ${genericCount} of ${totalCount} columns with auto-generated names like "_1", "_2", etc.`
    };
  }
  
  // If some columns are generic but less than 50%, suspicious
  if (genericCount > 0) {
    return { 
      status: 'suspicious', 
      genericCount, 
      totalCount,
      message: `Found ${genericCount} columns with unusual names. Some data may not import correctly.`
    };
  }
  
  return { status: 'ok', genericCount, totalCount, message: '' };
}

/**
 * Normalize status value to valid qualification_status enum
 */
function normalizeStatus(status: string | undefined): string | null {
  if (!status) return null;
  
  const normalized = status.toLowerCase().trim();
  
  // Map common status values to our qualification_status enum
  const statusMap: Record<string, string> = {
    // Storm Damage / Interested
    'storm damage': 'storm_damage',
    'storm': 'storm_damage',
    'interested': 'interested',
    'hot': 'interested',
    'hot lead': 'interested',
    'warm': 'interested',
    
    // Not Interested
    'not interested': 'not_interested',
    'not_interested': 'not_interested',
    'cold': 'not_interested',
    'no': 'not_interested',
    
    // Not Home
    'not home': 'not_home',
    'not_home': 'not_home',
    'no answer': 'not_home',
    'no_answer': 'not_home',
    
    // Come Back
    'come back': 'come_back',
    'come_back': 'come_back',
    'callback': 'come_back',
    'follow up': 'come_back',
    'follow_up': 'come_back',
    
    // Appointment Set
    'appointment': 'appointment_set',
    'appointment set': 'appointment_set',
    'appointment_set': 'appointment_set',
    'scheduled': 'appointment_set',
    'booked': 'appointment_set',
    
    // Sold / Won
    'sold': 'sold',
    'won': 'sold',
    'closed': 'sold',
    'closed won': 'sold',
    
    // Lost
    'lost': 'lost',
    'closed lost': 'lost',
    
    // Do Not Knock
    'do not knock': 'do_not_knock',
    'do_not_knock': 'do_not_knock',
    'dnk': 'do_not_knock',
    'no soliciting': 'do_not_knock',
    
    // Unqualified
    'unqualified': 'unqualified',
    'disqualified': 'unqualified',
    'bad lead': 'unqualified',
  };
  
  // Direct match
  if (statusMap[normalized]) {
    return statusMap[normalized];
  }
  
  // Partial match - check if any key is contained in the status
  for (const [key, value] of Object.entries(statusMap)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return value;
    }
  }
  
  // Return as-is if it looks like a valid status format
  if (normalized.includes('_') || /^[a-z_]+$/.test(normalized)) {
    return normalized;
  }
  
  return null;
}

/**
 * Analyze why rows are being skipped
 */
interface SkipAnalysis {
  missingName: number;
  missingContact: number;
  missingBoth: number;
  importable: number;
}

function analyzeSkippedRows(rows: ContactImportData[]): SkipAnalysis {
  let missingName = 0;
  let missingContact = 0;
  let missingBoth = 0;
  let importable = 0;
  
  for (const row of rows) {
    const hasName = (row.first_name && row.first_name !== 'Unknown' && row.first_name.trim() !== '') || 
                    (row.last_name && row.last_name.trim() !== '');
    const hasContactInfo = row.email || row.phone || row.address_street || row.address_city;
    
    if (hasName && hasContactInfo) {
      importable++;
    } else if (!hasName && !hasContactInfo) {
      missingBoth++;
    } else if (!hasName) {
      missingName++;
    } else {
      missingContact++;
    }
  }
  
  return { missingName, missingContact, missingBoth, importable };
}

/**
 * Check if a row is importable (has meaningful data)
 * RELAXED: Now allows address-only rows (will set name as "Homeowner")
 * Must have at least SOME contact info (email, phone, or address)
 */
function isRowImportable(row: ContactImportData): boolean {
  const hasName = (row.first_name && row.first_name !== 'Unknown' && row.first_name.trim() !== '') || 
                  (row.last_name && row.last_name.trim() !== '');
  const hasContactInfo = row.email || row.phone || row.address_street || row.address_city;
  
  // RELAXED: If we have contact info (especially address), we can import even without a name
  // The import will auto-set "Homeowner" as the first name
  return Boolean(hasContactInfo);
}

/**
 * Count how many normalized rows have at least one key contact field
 */
function countValidRows(normalizedData: ContactImportData[]): { 
  validCount: number; 
  totalCount: number; 
  percentage: number;
} {
  const validCount = normalizedData.filter(isRowImportable).length;
  
  const totalCount = normalizedData.length;
  const percentage = totalCount > 0 ? (validCount / totalCount) * 100 : 0;
  
  return { validCount, totalCount, percentage };
}

// Cross-location duplicate check result type
interface CrossLocationDuplicate {
  importRow: ContactImportData;
  existingContact: { name: string; phone: string; location_name: string };
}

// Same-location duplicate check result type
interface SameLocationDuplicate {
  importRow: ContactImportData;
  matchedBy: 'phone' | 'email';
  existingValue: string;
}

// Comprehensive duplicate check: same-location + cross-location
async function checkForDuplicates(
  contacts: ContactImportData[],
  tenantId: string,
  currentLocationId: string | null
): Promise<{ 
  sameLocationDuplicates: SameLocationDuplicate[];
  crossLocationDuplicates: CrossLocationDuplicate[];
  clean: ContactImportData[];
}> {
  if (!currentLocationId) {
    return { sameLocationDuplicates: [], crossLocationDuplicates: [], clean: contacts };
  }

  // Query same-location contacts
  const { data: sameLocContacts } = await supabase
    .from('contacts')
    .select('id, first_name, last_name, phone, email, location_id')
    .eq('tenant_id', tenantId)
    .eq('location_id', currentLocationId)
    .eq('is_deleted', false);

  // Query other-location contacts
  const { data: otherLocContacts } = await supabase
    .from('contacts')
    .select('id, first_name, last_name, phone, email, location_id')
    .eq('tenant_id', tenantId)
    .eq('is_deleted', false)
    .neq('location_id', currentLocationId)
    .not('phone', 'is', null);

  // Build same-location lookup maps
  const sameLocPhoneMap = new Map<string, boolean>();
  const sameLocEmailMap = new Map<string, boolean>();
  (sameLocContacts || []).forEach(c => {
    const normalizedPhone = c.phone?.replace(/\D/g, '');
    if (normalizedPhone && normalizedPhone.length >= 7) {
      sameLocPhoneMap.set(normalizedPhone, true);
    }
    if (c.email) {
      sameLocEmailMap.set(c.email.toLowerCase().trim(), true);
    }
  });

  // Build cross-location lookup map
  const locationIds = [...new Set((otherLocContacts || []).map(c => c.location_id).filter(Boolean))];
  let locationNameMap = new Map<string, string>();
  if (locationIds.length > 0) {
    const { data: locations } = await supabase
      .from('locations')
      .select('id, name')
      .in('id', locationIds);
    (locations || []).forEach(loc => locationNameMap.set(loc.id, loc.name));
  }

  type ExistingContact = { id: string; first_name: string | null; last_name: string | null; phone: string | null; email: string | null; location_id: string | null };
  const otherLocPhoneMap = new Map<string, ExistingContact>();
  (otherLocContacts || []).forEach((c: ExistingContact) => {
    const normalizedPhone = c.phone?.replace(/\D/g, '');
    if (normalizedPhone && normalizedPhone.length >= 7) {
      otherLocPhoneMap.set(normalizedPhone, c);
    }
  });

  // Classify each import row
  const sameLocationDuplicates: SameLocationDuplicate[] = [];
  const crossLocationDuplicates: CrossLocationDuplicate[] = [];
  const clean: ContactImportData[] = [];

  contacts.forEach(c => {
    const normalizedPhone = c.phone?.replace(/\D/g, '');
    const normalizedEmail = c.email?.toLowerCase().trim();

    // Check same-location first (highest priority skip)
    if (normalizedPhone && normalizedPhone.length >= 7 && sameLocPhoneMap.has(normalizedPhone)) {
      sameLocationDuplicates.push({ importRow: c, matchedBy: 'phone', existingValue: c.phone || '' });
      return;
    }
    if (normalizedEmail && sameLocEmailMap.has(normalizedEmail)) {
      sameLocationDuplicates.push({ importRow: c, matchedBy: 'email', existingValue: c.email || '' });
      return;
    }

    // Check cross-location
    const existing = normalizedPhone ? otherLocPhoneMap.get(normalizedPhone) : null;
    if (existing) {
      crossLocationDuplicates.push({
        importRow: c,
        existingContact: {
          name: `${existing.first_name} ${existing.last_name}`,
          phone: existing.phone || '',
          location_name: locationNameMap.get(existing.location_id || '') || 'Unknown Location'
        }
      });
      return;
    }

    clean.push(c);
  });

  return { sameLocationDuplicates, crossLocationDuplicates, clean };
}

export function ContactBulkImport({ open, onOpenChange, onImportComplete, currentLocationId }: ContactBulkImportProps) {
  const { currentLocation } = useLocation();
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<string>('');
  const [preview, setPreview] = useState<ContactImportData[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [columnMappings, setColumnMappings] = useState<{ original: string; mappedTo: string }[]>([]);
  const [unmatchedColumns, setUnmatchedColumns] = useState<string[]>([]);
  const [metadataColumns, setMetadataColumns] = useState<string[]>([]);
  const [duplicateColumns, setDuplicateColumns] = useState<string[]>([]);
  const [columnsToNotes, setColumnsToNotes] = useState<string[]>([]); // Track which unmapped columns should be added to notes
  const [rawCsvData, setRawCsvData] = useState<Record<string, any>[]>([]); // Store raw CSV data for notes extraction
  const [headerStatus, setHeaderStatus] = useState<{ status: 'ok' | 'missing' | 'suspicious'; message: string }>({ status: 'ok', message: '' });
  const [validRowStats, setValidRowStats] = useState<{ validCount: number; totalCount: number; percentage: number }>({ validCount: 0, totalCount: 0, percentage: 0 });
  const [skipAnalysis, setSkipAnalysis] = useState<SkipAnalysis>({ missingName: 0, missingContact: 0, missingBoth: 0, importable: 0 });
  const [profilesForPreview, setProfilesForPreview] = useState<ProfileMatch[]>([]);
  const [repMatchStats, setRepMatchStats] = useState<{ matched: number; unmatched: string[] }>({ matched: 0, unmatched: [] });
  const [manualRepMappings, setManualRepMappings] = useState<Record<string, string>>({});
  // Duplicate detection state
  const [sameLocationDuplicates, setSameLocationDuplicates] = useState<SameLocationDuplicate[]>([]);
  const [crossLocationDuplicates, setCrossLocationDuplicates] = useState<CrossLocationDuplicate[]>([]);
  const [cleanContactsForImport, setCleanContactsForImport] = useState<ContactImportData[]>([]);

  // Determine if import should be blocked
  const isImportBlocked = headerStatus.status === 'missing' || validRowStats.percentage < 5;
  const blockReason = headerStatus.status === 'missing' 
    ? headerStatus.message 
    : validRowStats.percentage < 5 
      ? `Only ${validRowStats.validCount} of ${validRowStats.totalCount} rows have recognizable contact data. Please check your CSV format.`
      : '';

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Fetch profiles for rep matching preview - filter by location if set
    let loadedProfiles: ProfileMatch[] = [];
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('tenant_id')
          .eq('id', user.id)
          .single();

        if (profile?.tenant_id) {
          // If importing to a specific location, only get reps assigned to that location
          if (currentLocationId) {
            const { data: locationAssignments } = await supabase
              .from('user_location_assignments')
              .select('user_id')
              .eq('location_id', currentLocationId);
            
            const assignedUserIds = (locationAssignments || []).map(a => a.user_id);
            
            if (assignedUserIds.length > 0) {
              const { data: locationProfiles } = await supabase
                .from('profiles')
                .select('id, first_name, last_name, email')
                .eq('tenant_id', profile.tenant_id)
                .in('id', assignedUserIds);
              loadedProfiles = locationProfiles || [];
            }
          } else {
            // No location filter - get all tenant profiles
            const { data: allProfiles } = await supabase
              .from('profiles')
              .select('id, first_name, last_name, email')
              .eq('tenant_id', profile.tenant_id);
            loadedProfiles = allProfiles || [];
          }
          setProfilesForPreview(loadedProfiles);
        }
      }
    } catch (err) {
      console.error('Failed to load profiles for preview:', err);
    }

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const rawData = results.data as Record<string, any>[];
        
        // Detect header status (missing headers = _1, _2, etc.)
        if (results.meta.fields) {
          const headerCheck = detectHeaderStatus(results.meta.fields);
          setHeaderStatus({ status: headerCheck.status, message: headerCheck.message });
          
          const { mapped, metadata, duplicates, unmatched } = detectMappedColumns(results.meta.fields);
          setColumnMappings(mapped);
          setMetadataColumns(metadata);
          setDuplicateColumns(duplicates);
          setUnmatchedColumns(unmatched);
          setColumnsToNotes([]); // Reset on new file
          setManualRepMappings({}); // Reset manual rep mappings on new file
        }
        
        // Store raw data for notes extraction during import
        setRawCsvData(rawData);
        
        // Normalize all rows using smart mapping
        const normalizedData = rawData.map(row => normalizeRow(row));
        
        // Filter for importable rows (have name + contact info)
        const importableRows = normalizedData.filter(isRowImportable);
        
        // Check how many rows have valid data
        const validStats = countValidRows(normalizedData);
        setValidRowStats(validStats);
        
        // Analyze WHY rows are being skipped
        const skipStats = analyzeSkippedRows(normalizedData);
        setSkipAnalysis(skipStats);
        
        // Calculate rep match stats for preview using loadedProfiles (local variable, not state)
        const unmatchedReps = new Set<string>();
        let matchedCount = 0;
        for (const row of importableRows) {
          if (row.sales_rep_name) {
            const matched = matchSalesRepToProfile(row.sales_rep_name, loadedProfiles);
            if (matched) {
              matchedCount++;
            } else {
              unmatchedReps.add(row.sales_rep_name);
            }
          }
        }
        setRepMatchStats({ matched: matchedCount, unmatched: [...unmatchedReps] });
        
        // Check for duplicates (same-location + cross-location) BEFORE showing preview
        if (currentLocationId) {
          try {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
              const { data: userProfile } = await supabase
                .from('profiles')
                .select('tenant_id')
                .eq('id', user.id)
                .single();
              
              if (userProfile?.tenant_id) {
                const { sameLocationDuplicates: sameDups, crossLocationDuplicates: crossDups, clean } = await checkForDuplicates(
                  importableRows,
                  userProfile.tenant_id,
                  currentLocationId
                );
                setSameLocationDuplicates(sameDups);
                setCrossLocationDuplicates(crossDups);
                setCleanContactsForImport(clean);
                setTotalRows(clean.length);
                setPreview(clean.slice(0, 5));
                return;
              }
            }
          } catch (err) {
            console.error('Failed to check for duplicates:', err);
          }
        }
        
        // No location or duplicate check failed - use all rows
        setSameLocationDuplicates([]);
        setCrossLocationDuplicates([]);
        setCleanContactsForImport(importableRows);
        
        setTotalRows(importableRows.length);
        setPreview(importableRows.slice(0, 5));
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

          // Fetch profiles for sales rep matching - filter by location if set
          setImportProgress('Loading sales reps...');
          let profilesForMatching: ProfileMatch[] = [];
          
          if (currentLocationId) {
            // Get reps assigned to this location
            const { data: locationAssignments } = await supabase
              .from('user_location_assignments')
              .select('user_id')
              .eq('location_id', currentLocationId);
            
            const assignedUserIds = (locationAssignments || []).map(a => a.user_id);
            
            if (assignedUserIds.length > 0) {
              const { data: locationProfiles } = await supabase
                .from('profiles')
                .select('id, first_name, last_name, email')
                .eq('tenant_id', profile.tenant_id)
                .in('id', assignedUserIds);
              profilesForMatching = locationProfiles || [];
            }
          } else {
            // No location filter - get all tenant profiles
            const { data: allProfiles } = await supabase
              .from('profiles')
              .select('id, first_name, last_name, email')
              .eq('tenant_id', profile.tenant_id);
            profilesForMatching = allProfiles || [];
          }

          const rawData = results.data as Record<string, any>[];
          const normalizedData = rawData.map(row => normalizeRow(row));
          
          // Filter for importable rows only (have name + contact info)
          let importableRows = normalizedData.filter(isRowImportable);
          
          // Re-run duplicate check at import time to catch any contacts added between preview and import
          if (currentLocationId) {
            const { clean } = await checkForDuplicates(
              importableRows,
              profile.tenant_id,
              currentLocationId
            );
            importableRows = clean;
          }
          
          // Track unmatched sales reps
          const unmatchedReps = new Set<string>();
          
          // Build a helper function to create notes from unmapped columns
          const buildNotesFromUnmappedColumns = (rawRow: Record<string, any>, existingNotes: string | undefined): string | null => {
            if (columnsToNotes.length === 0) return existingNotes || null;
            
            const additionalNotes: string[] = [];
            for (const col of columnsToNotes) {
              const value = rawRow[col];
              if (value && String(value).trim()) {
                additionalNotes.push(`${col}: ${String(value).trim()}`);
              }
            }
            
            if (additionalNotes.length === 0) return existingNotes || null;
            
            const unmappedSection = `--- Imported Data ---\n${additionalNotes.join('\n')}`;
            return existingNotes ? `${existingNotes}\n\n${unmappedSection}` : unmappedSection;
          };
          
          // Store original row data for pipeline entry creation
          const contactsWithOriginal = importableRows.map((row, idx) => {
            // Match sales rep name to profile ID - check manual mappings first, then auto-match
            const repName = row.sales_rep_name || '';
            const manualMapping = manualRepMappings[repName];
            const assignedTo = (manualMapping && manualMapping !== '__none__') 
              ? manualMapping 
              : matchSalesRepToProfile(repName, profilesForMatching);
            
            // Track if we couldn't match a sales rep (and no manual mapping exists)
            if (row.sales_rep_name && !assignedTo) {
              unmatchedReps.add(row.sales_rep_name);
            }
            
            // Auto-set "Homeowner" if no name provided (address-only contacts)
            const hasName = (row.first_name && row.first_name.trim() !== '') || 
                            (row.last_name && row.last_name.trim() !== '');
            
            // Get the corresponding raw row for unmapped column extraction
            const rawRow = rawData[idx] || {};
            const notesWithUnmapped = buildNotesFromUnmappedColumns(rawRow, row.notes);
            
            return {
              contact: {
                first_name: hasName ? (row.first_name || 'Unknown') : 'Homeowner',
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
                notes: notesWithUnmapped,
                tenant_id: profile.tenant_id,
                location_id: currentLocationId || null,
                type: 'homeowner' as const,
                is_deleted: false,
                assigned_to: assignedTo,
                qualification_status: row.qualification_status || null,
              },
              originalRow: row,
              assignedTo,
            };
          });

          // Batch insert with smaller batches for large imports to prevent timeout
          // Use smaller batches for large imports to avoid statement timeout
          const batchSize = contactsWithOriginal.length > 500 ? 25 : contactsWithOriginal.length > 100 ? 50 : 100;
          let successCount = 0;
          let failedCount = 0;
          let pipelineEntriesCreated = 0;

          for (let i = 0; i < contactsWithOriginal.length; i += batchSize) {
            const batchNumber = Math.floor(i / batchSize) + 1;
            const percentage = Math.round(((i + batchSize) / contactsWithOriginal.length) * 100);
            setImportProgress(`Importing ${Math.min(i + batchSize, contactsWithOriginal.length)} of ${contactsWithOriginal.length} (${Math.min(percentage, 100)}%)`);
            
            const batchItems = contactsWithOriginal.slice(i, i + batchSize);
            const contactBatch = batchItems.map(item => item.contact);
            
            try {
              const { data: insertedContacts, error } = await supabase
                .from('contacts')
                .insert(contactBatch)
                .select('id'); // Only select id to reduce response size

              if (error) {
                console.error(`Batch ${batchNumber} failed:`, error);
                failedCount += contactBatch.length;
                // Continue with next batch instead of throwing - more resilient
                continue;
              }
              
              successCount += insertedContacts?.length || 0;
              
              // Create pipeline entries for imported contacts with estimated values
              if (insertedContacts && insertedContacts.length > 0) {
                const pipelineEntries = insertedContacts.map((contact, idx) => {
                  const originalRow = batchItems[idx]?.originalRow;
                  const assignedTo = batchItems[idx]?.assignedTo;
                  const estimatedValue = parseEstimatedValue(originalRow?.estimated_value);
                  
                  return {
                    tenant_id: profile.tenant_id,
                    contact_id: contact.id,
                    location_id: currentLocationId || null,
                    status: 'lead',
                    assigned_to: assignedTo || null,
                    estimated_value: estimatedValue,
                  };
                });
                
                const { data: createdPipelines, error: pipelineError } = await supabase
                  .from('pipeline_entries')
                  .insert(pipelineEntries)
                  .select('id');
                  
                if (pipelineError) {
                  console.error(`Pipeline entries batch ${batchNumber} failed:`, pipelineError);
                } else {
                  pipelineEntriesCreated += createdPipelines?.length || 0;
                }
              }
            } catch (batchError) {
              console.error(`Batch ${batchNumber} threw error:`, batchError);
              failedCount += contactBatch.length;
              // Continue instead of throwing
              continue;
            }
            
            // Add delay between batches for large imports to prevent overwhelming the DB
            if (contactsWithOriginal.length > 100 && i + batchSize < contactsWithOriginal.length) {
              await new Promise(resolve => setTimeout(resolve, 150));
            }
          }
          
          // Check if import had failures
          if (failedCount > 0 && successCount === 0) {
            throw new Error(`All ${failedCount} contacts failed to import. Please try with a smaller file.`);
          }

          // Show success message with details
          if (failedCount > 0) {
            toast.warning(`Imported ${successCount} contacts. ${failedCount} contacts failed - try importing those separately.`);
          } else {
            toast.success(`Imported ${successCount} contacts successfully`);
          }
          
          
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
          setMetadataColumns([]);
          setDuplicateColumns([]);
          setColumnsToNotes([]);
          setRawCsvData([]);
          setImportProgress('');
          setHeaderStatus({ status: 'ok', message: '' });
          setValidRowStats({ validCount: 0, totalCount: 0, percentage: 0 });
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
    const csv = "first_name,last_name,email,phone,secondary_email,secondary_phone,company_name,address_street,address_city,address_state,address_zip,lead_source,tags,sales_rep\nJohn,Doe,john@example.com,555-123-4567,john.backup@example.com,555-999-8888,Acme Corp,123 Main St,Miami,FL,33101,website,\"roofing,residential\",John Smith\nJane,Smith,jane@example.com,555-987-6543,,,,456 Oak Ave,Tampa,FL,33602,referral,commercial,Jane Doe";
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
    setMetadataColumns([]);
    setDuplicateColumns([]);
    setColumnsToNotes([]);
    setRawCsvData([]);
    setHeaderStatus({ status: 'ok', message: '' });
    setValidRowStats({ validCount: 0, totalCount: 0, percentage: 0 });
    setSkipAnalysis({ missingName: 0, missingContact: 0, missingBoth: 0, importable: 0 });
    setProfilesForPreview([]);
    setRepMatchStats({ matched: 0, unmatched: [] });
    setManualRepMappings({});
    setSameLocationDuplicates([]);
    setCrossLocationDuplicates([]);
    setCleanContactsForImport([]);
  };

  // Get rep match status for preview row - now considers manual mappings
  const getRepMatchStatus = (repName: string | undefined): 'matched' | 'manual' | 'unmatched' | 'none' => {
    if (!repName) return 'none';
    // Check if manually mapped first
    if (manualRepMappings[repName]) return 'manual';
    const matched = matchSalesRepToProfile(repName, profilesForPreview);
    return matched ? 'matched' : 'unmatched';
  };

  // Compute effective rep match stats considering manual mappings
  const effectiveRepMatchStats = useMemo(() => {
    const stillUnmatched = repMatchStats.unmatched.filter(rep => !manualRepMappings[rep]);
    const manuallyMapped = repMatchStats.unmatched.filter(rep => manualRepMappings[rep]);
    const totalMatched = repMatchStats.matched + manuallyMapped.length;
    return {
      matched: totalMatched,
      manuallyMapped: manuallyMapped.length,
      unmatched: stillUnmatched
    };
  }, [repMatchStats, manualRepMappings]);

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
          <DialogTitle className="flex items-center gap-2">
            Import Contacts
            {currentLocation ? (
              <Badge variant="secondary" className="ml-2 font-normal">
                <MapPin className="h-3 w-3 mr-1" />
                {currentLocation.name}
              </Badge>
            ) : (
              <Badge variant="outline" className="ml-2 font-normal text-amber-600 border-amber-300">
                <AlertCircle className="h-3 w-3 mr-1" />
                All Locations
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Upload a CSV file to import multiple contacts at once.
            {currentLocation ? (
              <span className="block mt-1 text-primary font-medium">
                Contacts will be imported to: {currentLocation.name}
              </span>
            ) : (
              <span className="block mt-1 text-amber-600 font-medium">
                ⚠️ No location selected. Contacts will be imported without a location assignment.
              </span>
            )}
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

          {/* Missing Headers Error */}
          {isImportBlocked && preview.length > 0 && (
            <div className="p-4 bg-destructive/10 border border-destructive/30 rounded-lg">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <div className="space-y-2">
                  <p className="text-sm font-medium text-destructive">Cannot Import - Invalid CSV Format</p>
                  <p className="text-sm text-destructive/80">{blockReason}</p>
                  <div className="text-sm text-muted-foreground">
                    <p className="font-medium mb-1">How to fix:</p>
                    <ol className="list-decimal list-inside space-y-1 text-xs">
                      <li>Ensure your CSV has a header row with column names like "first_name", "email", "phone", etc.</li>
                      <li>Download our template for the correct format</li>
                      <li>Re-export your data with headers included</li>
                    </ol>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Column Mapping Display */}
          {columnMappings.length > 0 && !isImportBlocked && (
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

          {/* Same-Location Duplicate Warning */}
          {sameLocationDuplicates.length > 0 && (
            <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <UserX className="h-5 w-5 text-destructive" />
                <span className="text-sm font-medium text-destructive">
                  {sameLocationDuplicates.length} duplicate(s) already in {currentLocation?.name || 'this location'}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mb-2">
                These contacts already exist in this location and will be skipped:
              </p>
              <ul className="text-sm text-muted-foreground space-y-1 max-h-32 overflow-y-auto">
                {sameLocationDuplicates.slice(0, 5).map((dup, i) => (
                  <li key={i} className="flex items-center gap-1">
                    <span>{dup.importRow.first_name} {dup.importRow.last_name}</span>
                    <span className="text-xs">— matched by {dup.matchedBy}: {dup.existingValue}</span>
                  </li>
                ))}
                {sameLocationDuplicates.length > 5 && (
                  <li className="text-xs italic">...and {sameLocationDuplicates.length - 5} more</li>
                )}
              </ul>
            </div>
          )}

          {/* Cross-Location Duplicate Warning */}
          {crossLocationDuplicates.length > 0 && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle className="h-5 w-5 text-amber-500" />
                <span className="text-sm font-medium text-amber-500">
                  {crossLocationDuplicates.length} contact(s) already exist in another location
                </span>
              </div>
              <p className="text-sm text-muted-foreground mb-2">
                These contacts have matching phone numbers in other locations and will be skipped:
              </p>
              <ul className="text-sm text-muted-foreground space-y-1 max-h-32 overflow-y-auto">
                {crossLocationDuplicates.slice(0, 5).map((dup, i) => (
                  <li key={i} className="flex items-center gap-1">
                    <span>{dup.importRow.first_name} {dup.importRow.last_name}</span>
                    <span className="text-xs">({dup.importRow.phone})</span>
                    <span className="text-xs">→ exists in</span>
                    <strong className="text-xs">{dup.existingContact.location_name}</strong>
                  </li>
                ))}
                {crossLocationDuplicates.length > 5 && (
                  <li className="text-xs italic">...and {crossLocationDuplicates.length - 5} more</li>
                )}
              </ul>
            </div>
          )}

          {/* Auto-Ignored Columns Summary (metadata + duplicates) */}
          {(metadataColumns.length > 0 || duplicateColumns.length > 0) && (
            <div className="p-3 bg-muted/50 border border-border rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">
                  ✓ {metadataColumns.length + duplicateColumns.length} columns auto-skipped
                  <span className="font-normal ml-1">(metadata & duplicates)</span>
                </span>
              </div>
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  View skipped columns
                </summary>
                <div className="mt-2 space-y-2">
                  {duplicateColumns.length > 0 && (
                    <div>
                      <span className="text-muted-foreground">Duplicates of mapped data:</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {duplicateColumns.map((col, i) => (
                          <span key={i} className="px-1.5 py-0.5 bg-background rounded border text-muted-foreground">
                            {col}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {metadataColumns.length > 0 && (
                    <div>
                      <span className="text-muted-foreground">Metadata columns:</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {metadataColumns.map((col, i) => (
                          <span key={i} className="px-1.5 py-0.5 bg-background rounded border text-muted-foreground">
                            {col}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </details>
            </div>
          )}

          {/* Truly Unmatched Columns - with Skip/Add to Notes option */}
          {unmatchedColumns.length > 0 && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
              <div className="flex items-center gap-2 mb-3">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <span className="text-sm font-medium text-amber-700">
                  {unmatchedColumns.length} columns not auto-mapped:
                </span>
              </div>
              <div className="space-y-2">
                {unmatchedColumns.map((col, i) => (
                  <div 
                    key={i} 
                    className="flex items-center justify-between bg-background rounded border px-3 py-2"
                  >
                    <span className="text-sm font-medium">{col}</span>
                    <div className="flex gap-4 text-sm">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name={`col-action-${i}`}
                          checked={!columnsToNotes.includes(col)}
                          onChange={() => setColumnsToNotes(prev => prev.filter(c => c !== col))}
                          className="h-3.5 w-3.5"
                        />
                        <span className="text-muted-foreground">Skip</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name={`col-action-${i}`}
                          checked={columnsToNotes.includes(col)}
                          onChange={() => setColumnsToNotes(prev => [...prev, col])}
                          className="h-3.5 w-3.5"
                        />
                        <span className="text-foreground">Add to Notes</span>
                      </label>
                    </div>
                  </div>
                ))}
              </div>
              {columnsToNotes.length > 0 && (
                <p className="text-xs text-muted-foreground mt-2">
                  {columnsToNotes.length} column{columnsToNotes.length > 1 ? 's' : ''} will be added to contact notes
                </p>
              )}
            </div>
          )}

          {/* Rep Assignment Summary */}
          {preview.length > 0 && (repMatchStats.matched > 0 || repMatchStats.unmatched.length > 0) && (
            <div className={`p-3 rounded-lg border ${effectiveRepMatchStats.unmatched.length > 0 ? 'bg-amber-500/10 border-amber-500/30' : 'bg-green-500/10 border-green-500/30'}`}>
              <div className="flex items-center gap-2 mb-2">
                {effectiveRepMatchStats.unmatched.length > 0 ? (
                  <UserX className="h-4 w-4 text-amber-600" />
                ) : (
                  <UserCheck className="h-4 w-4 text-green-600" />
                )}
                <span className={`text-sm font-medium ${effectiveRepMatchStats.unmatched.length > 0 ? 'text-amber-700' : 'text-green-700'}`}>
                  Rep Assignment: {effectiveRepMatchStats.matched} contacts will be assigned
                  {effectiveRepMatchStats.manuallyMapped > 0 && (
                    <span className="text-blue-600 ml-1">({effectiveRepMatchStats.manuallyMapped} manually mapped)</span>
                  )}
                  {effectiveRepMatchStats.unmatched.length > 0 && `, ${effectiveRepMatchStats.unmatched.length} reps not found`}
                </span>
              </div>
              
              {/* Manual Rep Mapping UI */}
              {repMatchStats.unmatched.length > 0 && (
                <div className="space-y-3 mt-3">
                  <p className="text-xs font-medium text-foreground">Assign unmatched reps to existing team members:</p>
                  <div className="space-y-2">
                    {repMatchStats.unmatched.map((unmatchedRep) => (
                      <div key={unmatchedRep} className="flex items-center gap-3 bg-background/50 p-2 rounded border">
                        <div className="flex items-center gap-2 min-w-[140px]">
                          {manualRepMappings[unmatchedRep] ? (
                            <UserPlus className="h-4 w-4 text-blue-500" />
                          ) : (
                            <UserX className="h-4 w-4 text-amber-500" />
                          )}
                          <span className="text-sm font-medium truncate" title={unmatchedRep}>
                            {unmatchedRep}
                          </span>
                        </div>
                        <span className="text-muted-foreground text-sm">→</span>
                        <Select
                          value={manualRepMappings[unmatchedRep] || '__none__'}
                          onValueChange={(value) => {
                            setManualRepMappings(prev => {
                              if (value === '__none__') {
                                const { [unmatchedRep]: removed, ...rest } = prev;
                                return rest;
                              }
                              return { ...prev, [unmatchedRep]: value };
                            });
                          }}
                        >
                          <SelectTrigger className="w-[200px] h-8 text-sm">
                            <SelectValue placeholder="Select a rep..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">
                              <span className="text-muted-foreground">No assignment</span>
                            </SelectItem>
                            {profilesForPreview.map(profile => (
                              <SelectItem key={profile.id} value={profile.id}>
                                {profile.first_name} {profile.last_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                  {effectiveRepMatchStats.unmatched.length > 0 && (
                    <p className="text-xs text-amber-600">
                      {effectiveRepMatchStats.unmatched.length} rep{effectiveRepMatchStats.unmatched.length > 1 ? 's' : ''} will be imported without assignment.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {preview.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                Preview ({totalRows} importable rows
                {validRowStats.totalCount > totalRows && (
                  <span className="text-muted-foreground font-normal">
                    , {validRowStats.totalCount - totalRows} skipped
                  </span>
                )}
                ):
              </p>
              
              {/* Skip Analysis - show WHY rows are skipped */}
              {validRowStats.totalCount > totalRows && (skipAnalysis.missingName > 0 || skipAnalysis.missingContact > 0 || skipAnalysis.missingBoth > 0) && (
                <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                  <span className="font-medium">Skipped rows breakdown:</span>
                  <ul className="mt-1 space-y-0.5">
                    {skipAnalysis.missingBoth > 0 && (
                      <li>• {skipAnalysis.missingBoth} rows have no data (empty)</li>
                    )}
                    {skipAnalysis.missingContact > 0 && (
                      <li>• {skipAnalysis.missingContact} rows have name but no contact info (email/phone/address)</li>
                    )}
                  </ul>
                </div>
              )}
              
              <div className="border rounded-lg overflow-hidden overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="px-3 py-2 text-left whitespace-nowrap">First Name</th>
                      <th className="px-3 py-2 text-left whitespace-nowrap">Last Name</th>
                      <th className="px-3 py-2 text-left whitespace-nowrap">Phone</th>
                      <th className="px-3 py-2 text-left whitespace-nowrap">City</th>
                      <th className="px-3 py-2 text-left whitespace-nowrap">Status</th>
                      <th className="px-3 py-2 text-left whitespace-nowrap">Estimated</th>
                      <th className="px-3 py-2 text-left whitespace-nowrap">Assigned Rep</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => {
                      const repStatus = getRepMatchStatus(row.sales_rep_name);
                      return (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-2">{row.first_name || <span className="text-muted-foreground italic">Homeowner</span>}</td>
                          <td className="px-3 py-2">{row.last_name || '-'}</td>
                          <td className="px-3 py-2">{row.phone || '-'}</td>
                          <td className="px-3 py-2">{row.address_city || '-'}</td>
                          <td className="px-3 py-2">
                            {row.qualification_status ? (
                              <Badge variant="outline" className="text-xs">
                                {row.qualification_status.replace(/_/g, ' ')}
                              </Badge>
                            ) : '-'}
                          </td>
                          <td className="px-3 py-2">
                            {row.estimated_value ? (
                              <span className="text-green-600 font-medium">
                                ${parseEstimatedValue(row.estimated_value)?.toLocaleString() || row.estimated_value}
                              </span>
                            ) : '-'}
                          </td>
                          <td className="px-3 py-2">
                            {(() => {
                              // Get the actual assigned profile ID
                              const repName = row.sales_rep_name || '';
                              const manualMapping = manualRepMappings[repName];
                              const autoMatchedId = repName ? matchSalesRepToProfile(repName, profilesForPreview) : null;
                              const assignedProfileId = (manualMapping && manualMapping !== '__none__') 
                                ? manualMapping 
                                : autoMatchedId;
                              
                              // Find the profile to display
                              const assignedProfile = assignedProfileId 
                                ? profilesForPreview.find(p => p.id === assignedProfileId) 
                                : null;
                              
                              if (assignedProfile) {
                                const isManual = repStatus === 'manual';
                                return (
                                  <span className="flex items-center gap-1">
                                    {isManual ? (
                                      <UserPlus className="h-3.5 w-3.5 text-blue-500" />
                                    ) : (
                                      <UserCheck className="h-3.5 w-3.5 text-green-600" />
                                    )}
                                    <span className="text-foreground">
                                      {assignedProfile.first_name} {assignedProfile.last_name?.charAt(0) || ''}.
                                    </span>
                                  </span>
                                );
                              } else if (row.sales_rep_name) {
                                // Has a rep name but couldn't match
                                return (
                                  <span className="flex items-center gap-1">
                                    <UserX className="h-3.5 w-3.5 text-amber-500" />
                                    <span className="text-muted-foreground">{row.sales_rep_name}</span>
                                  </span>
                                );
                              } else {
                                return <span className="text-muted-foreground">-</span>;
                              }
                            })()}
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
            <Button 
              onClick={handleImport} 
              disabled={importing || preview.length === 0 || isImportBlocked}
              title={isImportBlocked ? blockReason : undefined}
            >
              {importing ? (importProgress || "Importing...") : `Import ${totalRows} Contacts`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
