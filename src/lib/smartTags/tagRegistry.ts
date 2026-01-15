/**
 * Smart Tags Registry
 * Complete catalog of available smart tags organized by category
 */

export interface TagDefinition {
  key: string;
  label: string;
  description: string;
  category: string;
  dataPath: string; // Path in context object (e.g., 'company.name', 'contact.first_name')
  defaultFormat?: string; // Default pipe to apply
  defaultValue?: string; // Fallback if null
  computed?: boolean; // If true, requires special handling
}

export interface TagCategory {
  id: string;
  label: string;
  icon: string;
  color: string;
}

// Tag categories
export const tagCategories: TagCategory[] = [
  { id: 'company', label: 'Company', icon: 'Building2', color: 'bg-blue-500' },
  { id: 'user', label: 'User (Rep)', icon: 'User', color: 'bg-purple-500' },
  { id: 'contact', label: 'Contact', icon: 'UserCircle', color: 'bg-green-500' },
  { id: 'lead', label: 'Lead', icon: 'Target', color: 'bg-orange-500' },
  { id: 'job', label: 'Job / Property', icon: 'Home', color: 'bg-teal-500' },
  { id: 'measurements', label: 'Measurements', icon: 'Ruler', color: 'bg-indigo-500' },
  { id: 'estimate', label: 'Estimate', icon: 'FileText', color: 'bg-amber-500' },
  { id: 'packet', label: 'Packet', icon: 'Package', color: 'bg-pink-500' },
  { id: 'signature', label: 'Signature', icon: 'PenTool', color: 'bg-red-500' },
];

// Complete tag registry
export const tagRegistry: TagDefinition[] = [
  // ==================== COMPANY TAGS ====================
  { key: 'company.name', label: 'Company Name', description: 'Business name', category: 'company', dataPath: 'company.name' },
  { key: 'company.dba', label: 'DBA Name', description: 'Doing Business As name', category: 'company', dataPath: 'company.dba' },
  { key: 'company.license', label: 'License Number', description: 'Contractor license', category: 'company', dataPath: 'company.license_number' },
  { key: 'company.phone', label: 'Phone', description: 'Main phone number', category: 'company', dataPath: 'company.phone', defaultFormat: 'phone' },
  { key: 'company.email', label: 'Email', description: 'Main email', category: 'company', dataPath: 'company.email' },
  { key: 'company.website', label: 'Website', description: 'Company website', category: 'company', dataPath: 'company.website' },
  { key: 'company.address_line1', label: 'Address Line 1', description: 'Street address', category: 'company', dataPath: 'company.address_line1' },
  { key: 'company.address_city', label: 'City', description: 'City', category: 'company', dataPath: 'company.address_city' },
  { key: 'company.address_state', label: 'State', description: 'State', category: 'company', dataPath: 'company.address_state' },
  { key: 'company.address_zip', label: 'ZIP Code', description: 'Postal code', category: 'company', dataPath: 'company.address_zip' },
  { key: 'company.full_address', label: 'Full Address', description: 'Complete address', category: 'company', dataPath: 'company.full_address', computed: true },
  { key: 'company.logo_url', label: 'Logo URL', description: 'Logo image URL', category: 'company', dataPath: 'company.logo_url' },
  { key: 'company.brand.primary', label: 'Primary Color', description: 'Brand primary color', category: 'company', dataPath: 'company.primary_color' },
  { key: 'company.brand.secondary', label: 'Secondary Color', description: 'Brand secondary color', category: 'company', dataPath: 'company.secondary_color' },
  { key: 'company.footer_disclaimer', label: 'Footer Disclaimer', description: 'Legal disclaimer text', category: 'company', dataPath: 'company.footer_disclaimer' },
  { key: 'company.warranty_blurb', label: 'Warranty Info', description: 'Warranty description', category: 'company', dataPath: 'company.warranty_blurb' },
  { key: 'company.financing_blurb', label: 'Financing Info', description: 'Financing description', category: 'company', dataPath: 'company.financing_blurb' },

  // ==================== USER (REP) TAGS ====================
  { key: 'user.name', label: 'Rep Name', description: 'Sales rep full name', category: 'user', dataPath: 'user.full_name' },
  { key: 'user.first_name', label: 'Rep First Name', description: 'Sales rep first name', category: 'user', dataPath: 'user.first_name' },
  { key: 'user.last_name', label: 'Rep Last Name', description: 'Sales rep last name', category: 'user', dataPath: 'user.last_name' },
  { key: 'user.email', label: 'Rep Email', description: 'Sales rep email', category: 'user', dataPath: 'user.email' },
  { key: 'user.phone', label: 'Rep Phone', description: 'Sales rep phone', category: 'user', dataPath: 'user.phone', defaultFormat: 'phone' },
  { key: 'user.title', label: 'Rep Title', description: 'Job title', category: 'user', dataPath: 'user.title' },
  { key: 'user.signature_name', label: 'Signature Name', description: 'Name for signature', category: 'user', dataPath: 'user.signature_name' },

  // ==================== CONTACT TAGS ====================
  { key: 'contact.first_name', label: 'First Name', description: 'Contact first name', category: 'contact', dataPath: 'contact.first_name' },
  { key: 'contact.last_name', label: 'Last Name', description: 'Contact last name', category: 'contact', dataPath: 'contact.last_name' },
  { key: 'contact.name', label: 'Full Name', description: 'Contact full name', category: 'contact', dataPath: 'contact.full_name', computed: true },
  { key: 'contact.phone', label: 'Phone', description: 'Contact phone', category: 'contact', dataPath: 'contact.phone', defaultFormat: 'phone' },
  { key: 'contact.email', label: 'Email', description: 'Contact email', category: 'contact', dataPath: 'contact.email' },
  { key: 'contact.address', label: 'Street Address', description: 'Contact street address', category: 'contact', dataPath: 'contact.address' },
  { key: 'contact.city', label: 'City', description: 'Contact city', category: 'contact', dataPath: 'contact.city' },
  { key: 'contact.state', label: 'State', description: 'Contact state', category: 'contact', dataPath: 'contact.state' },
  { key: 'contact.zip', label: 'ZIP Code', description: 'Contact ZIP code', category: 'contact', dataPath: 'contact.zip' },
  { key: 'contact.full_address', label: 'Full Address', description: 'Complete contact address', category: 'contact', dataPath: 'contact.full_address', computed: true },
  { key: 'contact.mailing_address', label: 'Mailing Address', description: 'Full mailing address', category: 'contact', dataPath: 'contact.mailing_address', computed: true },
  { key: 'contact.preferred_contact_method', label: 'Preferred Contact', description: 'How they prefer to be contacted', category: 'contact', dataPath: 'contact.preferred_contact_method' },

  // ==================== LEAD TAGS ====================
  { key: 'lead.id', label: 'Lead ID', description: 'Lead identifier', category: 'lead', dataPath: 'lead.id' },
  { key: 'lead.source', label: 'Lead Source', description: 'Where lead came from', category: 'lead', dataPath: 'lead.source' },
  { key: 'lead.created_at', label: 'Lead Created', description: 'When lead was created', category: 'lead', dataPath: 'lead.created_at', defaultFormat: 'date' },
  { key: 'lead.status', label: 'Lead Status', description: 'Current status', category: 'lead', dataPath: 'lead.status' },
  { key: 'lead.notes', label: 'Lead Notes', description: 'Notes on lead', category: 'lead', dataPath: 'lead.notes' },

  // ==================== JOB / PROPERTY TAGS ====================
  { key: 'job.id', label: 'Job ID', description: 'Job identifier', category: 'job', dataPath: 'job.id' },
  { key: 'job.address_line1', label: 'Street Address', description: 'Property street address', category: 'job', dataPath: 'job.address_line1' },
  { key: 'job.address_city', label: 'City', description: 'Property city', category: 'job', dataPath: 'job.address_city' },
  { key: 'job.address_state', label: 'State', description: 'Property state', category: 'job', dataPath: 'job.address_state' },
  { key: 'job.address_zip', label: 'ZIP Code', description: 'Property ZIP', category: 'job', dataPath: 'job.address_zip' },
  { key: 'job.address_full', label: 'Full Address', description: 'Complete property address', category: 'job', dataPath: 'job.address_full', computed: true },
  { key: 'job.created_at', label: 'Job Created', description: 'When job was created', category: 'job', dataPath: 'job.created_at', defaultFormat: 'date' },
  { key: 'job.claim_number', label: 'Claim Number', description: 'Insurance claim number', category: 'job', dataPath: 'job.claim_number' },
  { key: 'job.policy_number', label: 'Policy Number', description: 'Insurance policy number', category: 'job', dataPath: 'job.policy_number' },
  { key: 'job.insurance_carrier', label: 'Insurance Carrier', description: 'Insurance company name', category: 'job', dataPath: 'job.insurance_carrier' },
  { key: 'job.adjuster_name', label: 'Adjuster Name', description: 'Insurance adjuster name', category: 'job', dataPath: 'job.adjuster_name' },
  { key: 'job.adjuster_phone', label: 'Adjuster Phone', description: 'Adjuster phone number', category: 'job', dataPath: 'job.adjuster_phone', defaultFormat: 'phone' },
  { key: 'job.adjuster_email', label: 'Adjuster Email', description: 'Adjuster email', category: 'job', dataPath: 'job.adjuster_email' },
  { key: 'job.loss_date', label: 'Loss Date', description: 'Date of loss', category: 'job', dataPath: 'job.loss_date', defaultFormat: 'date' },
  { key: 'property.type', label: 'Property Type', description: 'Type of property', category: 'job', dataPath: 'property.type' },
  { key: 'property.year_built', label: 'Year Built', description: 'Year property was built', category: 'job', dataPath: 'property.year_built' },
  { key: 'property.roof_type', label: 'Roof Type', description: 'Type of roof', category: 'job', dataPath: 'property.roof_type' },

  // ==================== MEASUREMENTS TAGS ====================
  { key: 'measurements.count', label: 'Measurement Count', description: 'Number of measurement reports', category: 'measurements', dataPath: 'measurements.count' },
  { key: 'measurements[0].vendor', label: 'Vendor', description: 'Measurement vendor (Roofr, EagleView)', category: 'measurements', dataPath: 'measurements.0.vendor' },
  { key: 'measurements[0].report_date', label: 'Report Date', description: 'Date of measurement report', category: 'measurements', dataPath: 'measurements.0.report_date', defaultFormat: 'date' },
  { key: 'measurements[0].squares', label: 'Squares', description: 'Roof area in squares', category: 'measurements', dataPath: 'measurements.0.squares' },
  { key: 'measurements[0].pitch_avg', label: 'Average Pitch', description: 'Average roof pitch', category: 'measurements', dataPath: 'measurements.0.pitch_avg' },
  { key: 'measurements[0].ridge_length', label: 'Ridge Length', description: 'Total ridge length', category: 'measurements', dataPath: 'measurements.0.ridge_length' },
  { key: 'measurements[0].valley_length', label: 'Valley Length', description: 'Total valley length', category: 'measurements', dataPath: 'measurements.0.valley_length' },
  { key: 'measurements[0].eave_length', label: 'Eave Length', description: 'Total eave length', category: 'measurements', dataPath: 'measurements.0.eave_length' },
  { key: 'measurements[0].rake_length', label: 'Rake Length', description: 'Total rake length', category: 'measurements', dataPath: 'measurements.0.rake_length' },
  { key: 'measurements[0].pdf_filename', label: 'PDF Filename', description: 'Measurement PDF filename', category: 'measurements', dataPath: 'measurements.0.pdf_filename' },

  // ==================== ESTIMATE TAGS ====================
  { key: 'estimate.id', label: 'Estimate ID', description: 'Estimate identifier', category: 'estimate', dataPath: 'estimate.id' },
  { key: 'estimate.name', label: 'Estimate Name', description: 'Estimate name/label', category: 'estimate', dataPath: 'estimate.name' },
  { key: 'estimate.created_at', label: 'Created Date', description: 'When estimate was created', category: 'estimate', dataPath: 'estimate.created_at', defaultFormat: 'date' },
  { key: 'estimate.subtotal', label: 'Subtotal', description: 'Estimate subtotal', category: 'estimate', dataPath: 'estimate.subtotal', defaultFormat: 'money' },
  { key: 'estimate.tax', label: 'Tax', description: 'Tax amount', category: 'estimate', dataPath: 'estimate.tax', defaultFormat: 'money' },
  { key: 'estimate.total', label: 'Total', description: 'Estimate total', category: 'estimate', dataPath: 'estimate.total', defaultFormat: 'money' },
  { key: 'estimate.deposit', label: 'Deposit', description: 'Required deposit', category: 'estimate', dataPath: 'estimate.deposit', defaultFormat: 'money' },
  { key: 'estimate.balance_due', label: 'Balance Due', description: 'Remaining balance', category: 'estimate', dataPath: 'estimate.balance_due', defaultFormat: 'money', computed: true },
  { key: 'estimate.payment_terms', label: 'Payment Terms', description: 'Payment terms', category: 'estimate', dataPath: 'estimate.payment_terms' },
  { key: 'estimate.notes', label: 'Notes', description: 'Estimate notes', category: 'estimate', dataPath: 'estimate.notes' },
  { key: 'estimate.items_count', label: 'Line Items Count', description: 'Number of line items', category: 'estimate', dataPath: 'estimate.items_count', computed: true },
  { key: 'estimates.count', label: 'Estimates Count', description: 'Number of estimates', category: 'estimate', dataPath: 'estimates.count' },

  // ==================== PACKET TAGS ====================
  { key: 'packet.title', label: 'Packet Title', description: 'Report packet title', category: 'packet', dataPath: 'packet.title' },
  { key: 'packet.created_at', label: 'Created Date', description: 'When packet was created', category: 'packet', dataPath: 'packet.created_at', defaultFormat: 'date' },
  { key: 'packet.render_version', label: 'Version', description: 'Packet version number', category: 'packet', dataPath: 'packet.render_version' },
  { key: 'packet.expires_at', label: 'Expires At', description: 'Expiration date', category: 'packet', dataPath: 'packet.expires_at', defaultFormat: 'date' },
  { key: 'packet.viewer_link', label: 'Viewer Link', description: 'Public viewer URL', category: 'packet', dataPath: 'packet.viewer_link' },
  { key: 'packet.pdf_download_link', label: 'Download Link', description: 'PDF download URL', category: 'packet', dataPath: 'packet.pdf_download_link' },

  // ==================== SIGNATURE TAGS ====================
  { key: 'signature.required', label: 'Signature Required', description: 'Whether signature is required', category: 'signature', dataPath: 'signature.required' },
  { key: 'signature.instructions', label: 'Instructions', description: 'Signature instructions', category: 'signature', dataPath: 'signature.instructions' },
  { key: 'signature.signed_at', label: 'Signed At', description: 'When signature was captured', category: 'signature', dataPath: 'signature.signed_at', defaultFormat: 'date' },
  { key: 'signature.signer_name', label: 'Signer Name', description: 'Name of signer', category: 'signature', dataPath: 'signature.signer_name' },
  { key: 'signature.signer_email', label: 'Signer Email', description: 'Email of signer', category: 'signature', dataPath: 'signature.signer_email' },
  { key: 'signature.audit.ip', label: 'Signer IP', description: 'IP address at signing', category: 'signature', dataPath: 'signature.audit.ip' },
  { key: 'signature.audit.user_agent', label: 'Signer Device', description: 'Device/browser info', category: 'signature', dataPath: 'signature.audit.user_agent' },
];

// Get tags by category
export function getTagsByCategory(categoryId: string): TagDefinition[] {
  return tagRegistry.filter(tag => tag.category === categoryId);
}

// Get all tags grouped by category
export function getTagsGroupedByCategory(): Record<string, TagDefinition[]> {
  return tagRegistry.reduce((acc, tag) => {
    if (!acc[tag.category]) {
      acc[tag.category] = [];
    }
    acc[tag.category].push(tag);
    return acc;
  }, {} as Record<string, TagDefinition[]>);
}

// Find a tag definition by key
export function getTagDefinition(key: string): TagDefinition | undefined {
  return tagRegistry.find(tag => tag.key === key);
}

// Check if a tag key is valid
export function isValidTag(key: string): boolean {
  // Check exact match
  if (tagRegistry.some(tag => tag.key === key)) return true;
  
  // Check array index patterns like measurements[1].vendor
  const arrayPattern = /^(\w+)\[\d+\]\.(\w+)$/;
  const match = key.match(arrayPattern);
  if (match) {
    const baseKey = `${match[1]}[0].${match[2]}`;
    return tagRegistry.some(tag => tag.key === baseKey);
  }
  
  return false;
}

// Search tags by keyword
export function searchTags(query: string): TagDefinition[] {
  const lowerQuery = query.toLowerCase();
  return tagRegistry.filter(tag =>
    tag.key.toLowerCase().includes(lowerQuery) ||
    tag.label.toLowerCase().includes(lowerQuery) ||
    tag.description.toLowerCase().includes(lowerQuery)
  );
}
