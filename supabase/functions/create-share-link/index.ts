import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import {
  createServiceClient,
  generateSecureToken,
  hashToken,
  checkTenantPermission,
  logAuditEvent,
  successResponse,
  errorResponse,
  handleCors,
  getClientInfo,
  getUserFromAuth,
} from '../_shared/utils.ts';

// ============================================================================
// CREATE SHARE LINK - Generate trackable document sharing URLs
// ============================================================================

interface CreateShareLinkRequest {
  target_type: 'document' | 'envelope' | 'template' | 'smart_doc_instance' | 'signature_envelope';
  target_id: string;
  permissions: 'view' | 'sign' | 'edit';
  recipient_email?: string;
  recipient_id?: string;
  expires_at?: string;
  max_views?: number;
}

serve(async (req: Request) => {
  // Handle CORS
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Only POST requests allowed', 405);
  }

  try {
    const supabase = createServiceClient();
    const { ip, userAgent } = getClientInfo(req);

    // Authenticate user
    const user = await getUserFromAuth(supabase, req.headers.get('Authorization'));
    if (!user) {
      return errorResponse('UNAUTHORIZED', 'Invalid or missing authorization', 401);
    }

    // Parse and validate input
    const body: CreateShareLinkRequest = await req.json();
    
    if (!body.target_type || !body.target_id || !body.permissions) {
      return errorResponse('VALIDATION_ERROR', 'Missing required fields: target_type, target_id, permissions', 400);
    }

    const validTargetTypes = ['document', 'envelope', 'template', 'smart_doc_instance', 'signature_envelope'];
    if (!validTargetTypes.includes(body.target_type)) {
      return errorResponse('VALIDATION_ERROR', `Invalid target_type. Must be one of: ${validTargetTypes.join(', ')}`, 400);
    }

    const validPermissions = ['view', 'sign', 'edit'];
    if (!validPermissions.includes(body.permissions)) {
      return errorResponse('VALIDATION_ERROR', `Invalid permissions. Must be one of: ${validPermissions.join(', ')}`, 400);
    }

    // Get tenant_id from target - handle different table names
    let tableName = body.target_type + 's';
    if (body.target_type === 'signature_envelope') {
      tableName = 'signature_envelopes';
    } else if (body.target_type === 'smart_doc_instance') {
      tableName = 'smart_doc_instances';
    }

    const { data: target, error: targetError } = await supabase
      .from(tableName)
      .select('tenant_id, created_by')
      .eq('id', body.target_id)
      .single();

    if (targetError || !target) {
      console.error('Target lookup error:', targetError);
      return errorResponse('NOT_FOUND', 'Target not found', 404);
    }

    // Verify user has permission to this tenant
    const hasPermission = await checkTenantPermission(supabase, user.userId, target.tenant_id);
    if (!hasPermission) {
      return errorResponse('FORBIDDEN', 'You do not have access to this resource', 403);
    }

    // Generate secure token and hash it
    const plainToken = generateSecureToken(32);
    const tokenHash = await hashToken(plainToken);

    // Create share link record
    const { data: shareLink, error: insertError } = await supabase
      .from('share_links')
      .insert({
        tenant_id: target.tenant_id,
        target_type: body.target_type,
        target_id: body.target_id,
        token_hash: tokenHash,
        permissions: body.permissions,
        recipient_email: body.recipient_email,
        recipient_id: body.recipient_id,
        expires_at: body.expires_at,
        max_views: body.max_views,
        created_by: user.userId,
      })
      .select('id, expires_at, permissions, max_views, created_at')
      .single();

    if (insertError) {
      console.error('Insert error:', insertError);
      return errorResponse('DATABASE_ERROR', 'Failed to create share link', 500);
    }

    // Log audit event
    await logAuditEvent(supabase, {
      tenant_id: target.tenant_id,
      actor_user_id: user.userId,
      actor_type: 'user',
      action: 'share_link.created',
      target_type: body.target_type,
      target_id: body.target_id,
      ip_address: ip,
      user_agent: userAgent,
      metadata: {
        share_link_id: shareLink.id,
        permissions: body.permissions,
        recipient_email: body.recipient_email,
      },
    });

    // Build share URL
    const baseUrl = Deno.env.get('FRONTEND_URL') || 'https://pitch-crm.ai';
    const shareUrl = body.permissions === 'sign'
      ? `${baseUrl}/sign/${plainToken}`
      : `${baseUrl}/view/${plainToken}`;

    console.log(`Share link created: ${shareLink.id} for ${body.target_type}/${body.target_id}`);

    return successResponse({
      share_link: {
        id: shareLink.id,
        url: shareUrl,
        token: plainToken, // Return plain token ONLY once
        expires_at: shareLink.expires_at,
        permissions: shareLink.permissions,
        max_views: shareLink.max_views,
      },
    }, 201);

  } catch (error) {
    console.error('Unexpected error:', error);
    return errorResponse('INTERNAL_ERROR', 'Internal server error', 500);
  }
});
