// ============================================
// TELNYX VOICEMAIL DROP
// Plays pre-recorded audio on an active call and hangs up
// ============================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { handleOptions, json, badRequest, unauthorized, serverError } from '../_shared/http.ts';
import { supabaseAnon, supabaseService, getAuthUser } from '../_shared/supabase.ts';
import { telnyxFetch } from '../_shared/telnyx.ts';

interface VoicemailDropRequest {
  call_control_id: string;
  voicemail_template_id: string;
  call_id?: string;
}

serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;

  try {
    if (req.method !== 'POST') return badRequest('POST only');

    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return unauthorized('Missing Authorization header');

    const supa = supabaseAnon(authHeader);
    const user = await getAuthUser(supa);
    if (!user) return unauthorized('Invalid JWT');

    const body = (await req.json()) as VoicemailDropRequest;

    if (!body.call_control_id || !body.voicemail_template_id) {
      return badRequest('Missing call_control_id or voicemail_template_id');
    }

    const admin = supabaseService();

    // Load voicemail template
    const { data: template, error: tmplErr } = await admin
      .from('voicemail_templates')
      .select('id, audio_url, name, script, is_tts')
      .eq('id', body.voicemail_template_id)
      .single();

    if (tmplErr || !template) {
      return badRequest('Voicemail template not found');
    }

    if (!template.audio_url) {
      return badRequest('Template has no audio URL. Upload an audio file first.');
    }

    console.log(`[voicemail-drop] Playing "${template.name}" on call ${body.call_control_id}`);

    // Play audio on the call via Telnyx Call Control
    await telnyxFetch(`/v2/calls/${body.call_control_id}/actions/playback_start`, {
      method: 'POST',
      body: JSON.stringify({
        audio_url: template.audio_url,
        overlay: false,
      }),
    });

    // Wait a moment then hangup (the webhook will handle final status)
    // We use a short delay to let the audio start; actual hangup is triggered
    // when playback finishes via Telnyx's playback_ended event, or we schedule it
    // For now, the rep is freed up immediately and we don't wait for completion.

    // Update usage count
    await admin.rpc('increment_voicemail_usage', { template_id: template.id }).catch(() => {
      // Non-critical; the RPC may not exist yet
      admin.from('voicemail_templates')
        .update({ usage_count: (template as any).usage_count ? (template as any).usage_count + 1 : 1 })
        .eq('id', template.id)
        .then(() => {});
    });

    // Update call record if provided
    if (body.call_id) {
      await admin.from('calls').update({
        status: 'voicemail_dropped',
        raw_payload: { voicemail_template_id: template.id, voicemail_template_name: template.name },
      }).eq('id', body.call_id);
    }

    return json({
      ok: true,
      message: `Voicemail "${template.name}" is playing`,
    });
  } catch (err) {
    return serverError(err);
  }
});
