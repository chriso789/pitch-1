// ============================================================================
// SHARED TYPES FOR SMARTDOCS EDGE FUNCTIONS
// ============================================================================

export type EnvelopeStatus = 'draft' | 'sent' | 'delivered' | 'completed' | 'voided' | 'expired';
export type RecipientStatus = 'pending' | 'sent' | 'delivered' | 'viewed' | 'signed' | 'declined' | 'failed';
export type NotificationType = 'view_event' | 'signature_request' | 'document_completed' | 'envelope_sent' | 'reminder' | 'system';
export type ShareLinkPermission = 'view' | 'sign' | 'edit';
export type TargetType = 'document' | 'envelope' | 'template' | 'smart_doc_instance' | 'signature_envelope';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface AuditEventPayload {
  tenant_id: string;
  actor_user_id?: string;
  actor_type: 'user' | 'system' | 'external';
  action: string;
  target_type: string;
  target_id: string;
  changes?: Record<string, unknown>;
  ip_address?: string;
  user_agent?: string;
  metadata?: Record<string, unknown>;
}

export interface ShareLink {
  id: string;
  tenant_id: string;
  target_type: TargetType;
  target_id: string;
  token_hash: string;
  permissions: ShareLinkPermission;
  recipient_email?: string;
  recipient_id?: string;
  expires_at?: string;
  revoked_at?: string;
  max_views?: number;
  view_count: number;
  created_by: string;
  created_at: string;
  last_accessed_at?: string;
}

export interface ViewEvent {
  id: string;
  tenant_id: string;
  share_link_id: string;
  target_type: string;
  target_id: string;
  viewer_email?: string;
  viewer_name?: string;
  ip_address?: string;
  user_agent?: string;
  session_id?: string;
  viewed_at: string;
  duration_seconds?: number;
}

export interface SignatureEnvelope {
  id: string;
  tenant_id: string;
  title: string;
  status: EnvelopeStatus;
  created_by: string;
  sent_at?: string;
  completed_at?: string;
  final_pdf_url?: string;
}

export interface SignatureRecipient {
  id: string;
  envelope_id: string;
  name: string;
  email: string;
  status: RecipientStatus;
  access_token: string;
  routing_order: number;
  viewed_at?: string;
  signed_at?: string;
}
