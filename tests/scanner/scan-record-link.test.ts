import { describe, it, expect } from 'vitest';
import { recordDocumentFilter, recordLinkColumns } from '@/lib/scan-records/recordLink';

describe('scan record linking', () => {
  it('links contacts, projects and leads by their own column only', () => {
    expect(recordLinkColumns('contact', 'c1', undefined)).toEqual({ pipeline_entry_id: null, contact_id: 'c1', project_id: null });
    expect(recordLinkColumns('project', 'p1', undefined)).toEqual({ pipeline_entry_id: null, contact_id: null, project_id: 'p1' });
    expect(recordLinkColumns('pipeline_entry', undefined, 'l1')).toEqual({ pipeline_entry_id: 'l1', contact_id: null, project_id: null });
  });
  it('jobs never write the projects foreign key', () => {
    expect(recordLinkColumns('job', 'j1', undefined).project_id).toBeNull();
  });
  it('lookup filters match what the scanner writes', () => {
    expect(recordDocumentFilter('contact', 'c1')).toEqual({ kind: 'column', column: 'contact_id', value: 'c1' });
    expect(recordDocumentFilter('commercial_project', 'x')).toEqual({ kind: 'metadata', value: { commercial_project_id: 'x' } });
    expect(recordDocumentFilter('job', 'j1')).toEqual({ kind: 'metadata', value: { record_type: 'job', record_id: 'j1' } });
  });
});
