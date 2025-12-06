import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import {
  createServiceClient,
  hashToken,
  logAuditEvent,
  createNotification,
  successResponse,
  errorResponse,
  handleCors,
  getClientInfo,
} from '../_shared/utils.ts';

// ============================================================================
// RECORD VIEW EVENT - Track document views and notify owners
// ============================================================================

interface RecordViewEventRequest {
  token: string;
  viewer_email?: string;
  viewer_name?: string;
  duration_seconds?: number;
  session_id?: string;
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

    // Parse input
    const body: RecordViewEventRequest = await req.json();
    
    if (!body.token || body.token.length < 10) {
      return errorResponse('VALIDATION_ERROR', 'Invalid or missing token', 400);
    }

    // Hash token and lookup share link
    const tokenHash = await hashToken(body.token);

    const { data: shareLink, error: linkError } = await supabase
      .from('share_links')
      .select('*')
      .eq('token_hash', tokenHash)
      .is('revoked_at', null)
      .single();

    if (linkError || !shareLink) {
      console.error('Share link lookup error:', linkError);
      return errorResponse('NOT_FOUND', 'Invalid or revoked link', 404);
    }

    // Check expiration
    if (shareLink.expires_at && new Date(shareLink.expires_at) < new Date()) {
      return errorResponse('EXPIRED', 'This link has expired', 410);
    }

    // Check max views
    if (shareLink.max_views && shareLink.view_count >= shareLink.max_views) {
      return errorResponse('MAX_VIEWS_REACHED', 'Maximum views reached for this link', 403);
    }

    // Record view event
    const { data: viewEvent, error: viewError } = await supabase
      .from('view_events')
      .insert({
        tenant_id: shareLink.tenant_id,
        share_link_id: shareLink.id,
        target_type: shareLink.target_type,
        target_id: shareLink.target_id,
        viewer_email: body.viewer_email,
        viewer_name: body.viewer_name,
        ip_address: ip,
        user_agent: userAgent,
        session_id: body.session_id,
        duration_seconds: body.duration_seconds,
      })
      .select('id, viewed_at')
      .single();

    if (viewError) {
      console.error('Failed to record view event:', viewError);
      return errorResponse('DATABASE_ERROR', 'Failed to record view', 500);
    }

    // Update share link view count
    await supabase
      .from('share_links')
      .update({
        view_count: shareLink.view_count + 1,
        last_accessed_at: new Date().toISOString(),
      })
      .eq('id', shareLink.id);

    // Get document/envelope owner to notify them
    let ownerId: string | null = null;
    let targetTitle = 'Document';

    if (shareLink.target_type === 'signature_envelope') {
      const { data: envelope } = await supabase
        .from('signature_envelopes')
        .select('created_by, title')
        .eq('id', shareLink.target_id)
        .single();
      ownerId = envelope?.created_by;
      targetTitle = envelope?.title || 'Signature Envelope';
    } else if (shareLink.target_type === 'smart_doc_instance') {
      const { data: instance } = await supabase
        .from('smart_doc_instances')
        .select('title')
        .eq('id', shareLink.target_id)
        .single();
      targetTitle = instance?.title || 'Smart Document';
      // Get owner from share link creator
      ownerId = shareLink.created_by;
    } else {
      ownerId = shareLink.created_by;
    }

    // Send notification to document owner
    if (ownerId) {
      const viewerDisplay = body.viewer_name || body.viewer_email || 'Someone';
      
      await createNotification(supabase, {
        tenant_id: shareLink.tenant_id,
        user_id: ownerId,
        type: 'view_event',
        title: 'Document Viewed',
        message: `${viewerDisplay} viewed "${targetTitle}"`,
        action_url: `/${shareLink.target_type}s/${shareLink.target_id}`,
        metadata: {
          share_link_id: shareLink.id,
          view_event_id: viewEvent.id,
          viewer_email: body.viewer_email,
          viewer_name: body.viewer_name,
          viewed_at: viewEvent.viewed_at,
        },
      });
    }

    // Log audit event
    await logAuditEvent(supabase, {
      tenant_id: shareLink.tenant_id,
      actor_type: 'external',
      action: 'document.viewed',
      target_type: shareLink.target_type,
      target_id: shareLink.target_id,
      ip_address: ip,
      user_agent: userAgent,
      metadata: {
        share_link_id: shareLink.id,
        viewer_email: body.viewer_email,
        view_event_id: viewEvent.id,
      },
    });

    console.log(`View event recorded: ${viewEvent.id} for ${shareLink.target_type}/${shareLink.target_id}`);

    return successResponse({
      view_event: {
        id: viewEvent.id,
        viewed_at: viewEvent.viewed_at,
      },
      target: {
        type: shareLink.target_type,
        id: shareLink.target_id,
        permissions: shareLink.permissions,
      },
    }, 201);

  } catch (error) {
    console.error('Unexpected error:', error);
    return errorResponse('INTERNAL_ERROR', 'Internal server error', 500);
  }
});
