import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import {
  createServiceClient,
  hashToken,
  logAuditEvent,
  successResponse,
  errorResponse,
  handleCors,
  getClientInfo,
} from '../_shared/utils.ts';

// ============================================================================
// VALIDATE VIEW TOKEN - Exchange token for minimal safe document payload
// ============================================================================

interface ValidateTokenRequest {
  token: string;
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
    const body: ValidateTokenRequest = await req.json();
    
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

    // Fetch document/target data based on type
    let documentData: Record<string, unknown> = {
      id: shareLink.target_id,
      type: shareLink.target_type,
      permissions: shareLink.permissions || ['view'],
    };

    // Get target-specific data
    if (shareLink.target_type === 'signature_envelope') {
      const { data: envelope, error: envelopeError } = await supabase
        .from('signature_envelopes')
        .select(`
          id,
          title,
          status,
          created_at,
          generated_pdf_path,
          created_by,
          profiles:created_by(full_name)
        `)
        .eq('id', shareLink.target_id)
        .single();

      if (envelopeError || !envelope) {
        return errorResponse('NOT_FOUND', 'Document not found', 404);
      }

      // Get signed PDF URL if available
      let pdfUrl: string | undefined;
      if (envelope.generated_pdf_path) {
        const { data: signedUrl } = await supabase.storage
          .from('signature-documents')
          .createSignedUrl(envelope.generated_pdf_path, 3600); // 1 hour
        pdfUrl = signedUrl?.signedUrl;
      }

      documentData = {
        ...documentData,
        title: envelope.title,
        status: envelope.status,
        created_at: envelope.created_at,
        pdf_url: pdfUrl,
        owner_name: (envelope.profiles as any)?.full_name,
      };
    } else if (shareLink.target_type === 'smart_doc_instance') {
      const { data: instance, error: instanceError } = await supabase
        .from('smart_doc_instances')
        .select(`
          id,
          title,
          rendered_html,
          pdf_url,
          storage_path,
          created_at,
          smartdoc_templates(name)
        `)
        .eq('id', shareLink.target_id)
        .single();

      if (instanceError || !instance) {
        return errorResponse('NOT_FOUND', 'Document not found', 404);
      }

      // Get PDF URL
      let pdfUrl = instance.pdf_url;
      if (!pdfUrl && instance.storage_path) {
        const { data: signedUrl } = await supabase.storage
          .from('smart-docs')
          .createSignedUrl(instance.storage_path, 3600);
        pdfUrl = signedUrl?.signedUrl;
      }

      // Get creator name
      const { data: creator } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', shareLink.created_by)
        .single();

      documentData = {
        ...documentData,
        title: instance.title || (instance.smartdoc_templates as any)?.name || 'Document',
        created_at: instance.created_at,
        pdf_url: pdfUrl,
        html_content: instance.rendered_html,
        owner_name: creator?.full_name,
      };
    } else if (shareLink.target_type === 'estimate') {
      const { data: estimate, error: estimateError } = await supabase
        .from('estimates')
        .select(`
          id,
          estimate_number,
          status,
          pdf_path,
          created_at,
          created_by,
          profiles:created_by(full_name)
        `)
        .eq('id', shareLink.target_id)
        .single();

      if (estimateError || !estimate) {
        return errorResponse('NOT_FOUND', 'Document not found', 404);
      }

      let pdfUrl: string | undefined;
      if (estimate.pdf_path) {
        const { data: signedUrl } = await supabase.storage
          .from('estimates')
          .createSignedUrl(estimate.pdf_path, 3600);
        pdfUrl = signedUrl?.signedUrl;
      }

      documentData = {
        ...documentData,
        title: `Estimate #${estimate.estimate_number}`,
        status: estimate.status,
        created_at: estimate.created_at,
        pdf_url: pdfUrl,
        owner_name: (estimate.profiles as any)?.full_name,
      };
    } else if (shareLink.target_type === 'proposal') {
      const { data: proposal, error: proposalError } = await supabase
        .from('proposals')
        .select(`
          id,
          title,
          pdf_path,
          html_content,
          created_at,
          created_by,
          profiles:created_by(full_name)
        `)
        .eq('id', shareLink.target_id)
        .single();

      if (proposalError || !proposal) {
        return errorResponse('NOT_FOUND', 'Document not found', 404);
      }

      let pdfUrl: string | undefined;
      if (proposal.pdf_path) {
        const { data: signedUrl } = await supabase.storage
          .from('proposals')
          .createSignedUrl(proposal.pdf_path, 3600);
        pdfUrl = signedUrl?.signedUrl;
      }

      documentData = {
        ...documentData,
        title: proposal.title,
        created_at: proposal.created_at,
        pdf_url: pdfUrl,
        html_content: proposal.html_content,
        owner_name: (proposal.profiles as any)?.full_name,
      };
    }

    // Log access for audit trail
    await logAuditEvent(supabase, {
      tenant_id: shareLink.tenant_id,
      actor_type: 'external',
      action: 'document.token_validated',
      target_type: shareLink.target_type,
      target_id: shareLink.target_id,
      ip_address: ip,
      user_agent: userAgent,
    });

    console.log(`Token validated for ${shareLink.target_type}/${shareLink.target_id}`);

    return successResponse(documentData);

  } catch (error) {
    console.error('Unexpected error:', error);
    return errorResponse('INTERNAL_ERROR', 'Internal server error', 500);
  }
});
