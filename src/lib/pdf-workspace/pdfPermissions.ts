import { getRoleLevel } from '@/lib/roleUtils';

export type PdfWorkspaceAction = 
  | 'upload'
  | 'annotate'
  | 'smart_tags'
  | 'ai_rewrite'
  | 'save_draft'
  | 'finalize'
  | 'delete_version'
  | 'view';

/**
 * Check if a role can perform a given PDF workspace action.
 */
export function canPerformPdfAction(role: string, action: PdfWorkspaceAction): boolean {
  const level = getRoleLevel(role);

  switch (action) {
    case 'view':
      return level <= 7; // project_manager and above
    case 'upload':
    case 'annotate':
    case 'smart_tags':
    case 'save_draft':
      return level <= 6; // sales_manager and above
    case 'ai_rewrite':
    case 'finalize':
      return level <= 6;
    case 'delete_version':
      return level <= 4; // office_admin and above
    default:
      return false;
  }
}
