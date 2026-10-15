/** Record types a scan can be attached to, and how each one is linked on the documents row. */
export type ScanRecordType = 'pipeline_entry' | 'contact' | 'job' | 'project' | 'commercial_project' | 'permit' | 'contract' | 'smart_doc';

export const SCAN_CATEGORIES = [
  { value: 'contract', label: 'Contract' },
  { value: 'estimate', label: 'Proposal / Estimate' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'permit', label: 'Permit' },
  { value: 'invoice_material', label: 'Material Invoice' },
  { value: 'change_order', label: 'Change Order' },
  { value: 'other', label: 'Other' },
] as const;

export type RecordFilter =
  | { kind: 'column'; column: 'pipeline_entry_id' | 'contact_id' | 'project_id'; value: string }
  | { kind: 'metadata'; value: Record<string, string> };

/** How saved scans for a record are found. Must match the link fields written by the scanner. */
export function recordDocumentFilter(type: ScanRecordType, id: string): RecordFilter {
  switch (type) {
    case 'pipeline_entry': return { kind: 'column', column: 'pipeline_entry_id', value: id };
    case 'contact': return { kind: 'column', column: 'contact_id', value: id };
    case 'project': return { kind: 'column', column: 'project_id', value: id };
    case 'commercial_project': return { kind: 'metadata', value: { commercial_project_id: id } };
    default: return { kind: 'metadata', value: { record_type: type, record_id: id } };
  }
}

/** Link columns the scanner writes on the documents row. */
export function recordLinkColumns(type: ScanRecordType, recordId: string | undefined, pipelineEntryId: string | undefined) {
  return {
    pipeline_entry_id: type === 'pipeline_entry' ? (recordId ?? pipelineEntryId ?? null) : (pipelineEntryId || null),
    contact_id: type === 'contact' ? recordId ?? null : null,
    project_id: type === 'project' ? recordId ?? null : null,
  };
}
