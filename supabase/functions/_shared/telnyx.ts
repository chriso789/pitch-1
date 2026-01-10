// ============================================
// TELNYX API UTILITIES
// ============================================

import { ENV } from './env.ts';

export interface TelnyxResponse<T = unknown> {
  data: T;
  meta?: {
    page_number?: number;
    page_size?: number;
    total_pages?: number;
    total_results?: number;
  };
}

export interface TelnyxError {
  errors: Array<{
    code: string;
    title: string;
    detail: string;
    source?: {
      pointer?: string;
      parameter?: string;
    };
    meta?: Record<string, unknown>;
  }>;
}

/**
 * Make authenticated request to Telnyx API
 */
export async function telnyxFetch<T = unknown>(
  path: string,
  init: RequestInit = {}
): Promise<TelnyxResponse<T>> {
  const url = path.startsWith('http') ? path : `https://api.telnyx.com${path}`;
  
  console.log(`[Telnyx] ${init.method || 'GET'} ${path}`);
  
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ENV.TELNYX_API_KEY}`,
      ...(init.headers ?? {}),
    },
  });

  const text = await res.text();
  let json: TelnyxResponse<T> | TelnyxError | null = null;
  
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    console.error('[Telnyx] Failed to parse response:', text.substring(0, 500));
  }

  if (!res.ok) {
    const errorJson = json as TelnyxError | null;
    const errorDetail = errorJson?.errors?.[0]?.detail 
      || errorJson?.errors?.[0]?.title 
      || text.substring(0, 200);
    console.error('[Telnyx] API error:', res.status, errorDetail);
    throw new Error(`Telnyx API error ${res.status}: ${errorDetail}`);
  }
  
  console.log(`[Telnyx] Success: ${res.status}`);
  return json as TelnyxResponse<T>;
}

/**
 * Send SMS via Telnyx
 */
export interface TelnyxSendMessageParams {
  from: string;
  to: string;
  text: string;
  media_urls?: string[];
  messaging_profile_id?: string;
}

export interface TelnyxMessageResponse {
  id: string;
  record_type: string;
  direction: string;
  messaging_profile_id: string;
  to: Array<{
    phone_number: string;
    status: string;
    carrier?: string;
  }>;
  from: {
    phone_number: string;
    carrier?: string;
  };
  text: string;
  media?: Array<{
    url: string;
    content_type?: string;
    size?: number;
  }>;
  webhook_url?: string;
  webhook_failover_url?: string;
  encoding: string;
  parts: number;
  tags?: string[];
  cost?: {
    amount: string;
    currency: string;
  };
  received_at?: string;
  sent_at?: string;
  completed_at?: string;
  valid_until?: string;
  errors?: Array<{
    code: string;
    title: string;
    detail?: string;
  }>;
}

export async function sendTelnyxMessage(params: TelnyxSendMessageParams): Promise<TelnyxMessageResponse> {
  const body: Record<string, unknown> = {
    from: params.from,
    to: params.to,
    text: params.text,
  };
  
  if (params.media_urls?.length) {
    body.media_urls = params.media_urls;
  }
  
  if (params.messaging_profile_id) {
    body.messaging_profile_id = params.messaging_profile_id;
  } else if (ENV.TELNYX_SMS_PROFILE_ID) {
    body.messaging_profile_id = ENV.TELNYX_SMS_PROFILE_ID;
  }

  const response = await telnyxFetch<TelnyxMessageResponse>('/v2/messages', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  
  return response.data;
}

/**
 * Initiate outbound call via Telnyx Call Control
 */
export interface TelnyxDialParams {
  connection_id: string;
  from: string;
  to: string;
  client_state?: string;
  record?: 'record-from-answer' | 'record-from-answer-dual' | 'record-from-answer-mono';
  answering_machine_detection?: 'disabled' | 'detect' | 'detect_beep' | 'premium';
  webhook_url?: string;
}

export interface TelnyxCallResponse {
  call_control_id: string;
  call_leg_id: string;
  call_session_id: string;
  is_alive: boolean;
  record_type: string;
}

export async function initiateCall(params: TelnyxDialParams): Promise<TelnyxCallResponse> {
  const body: Record<string, unknown> = {
    connection_id: params.connection_id,
    from: params.from,
    to: params.to,
  };
  
  if (params.client_state) {
    body.client_state = params.client_state;
  }
  
  if (params.record) {
    body.record = params.record;
  }
  
  if (params.answering_machine_detection && params.answering_machine_detection !== 'disabled') {
    body.answering_machine_detection = params.answering_machine_detection;
  }
  
  if (params.webhook_url) {
    body.webhook_url = params.webhook_url;
  }

  const response = await telnyxFetch<TelnyxCallResponse>('/v2/calls', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  
  return response.data;
}
