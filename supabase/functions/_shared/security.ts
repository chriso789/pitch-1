// ============================================
// TELNYX WEBHOOK SIGNATURE VERIFICATION
// Ed25519 signature verification for Telnyx webhooks
// ============================================

import { ENV } from './env.ts';

// Convert base64 -> Uint8Array
function b64ToBytes(b64: string): Uint8Array {
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function textToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

// Accept PEM or base64 or raw bytes encoded as base64
function extractPublicKeyBytes(pub: string): Uint8Array {
  const trimmed = pub.trim();

  // PEM format
  if (trimmed.includes('BEGIN PUBLIC KEY')) {
    const b64 = trimmed
      .replace(/-----BEGIN PUBLIC KEY-----/g, '')
      .replace(/-----END PUBLIC KEY-----/g, '')
      .replace(/\s+/g, '');
    return b64ToBytes(b64);
  }

  // If looks like base64, decode
  if (/^[A-Za-z0-9+/=]+\s*$/.test(trimmed) && trimmed.length > 40) {
    return b64ToBytes(trimmed.replace(/\s+/g, ''));
  }

  throw new Error('TELNYX_PUBLIC_KEY must be PEM or base64 DER');
}

/**
 * Verify Telnyx webhook signature (Ed25519).
 * Telnyx signs the string: `${timestamp}|${rawBody}` and sends base64 signature in header.
 * Headers: telnyx-timestamp (unix seconds), telnyx-signature-ed25519 (base64).
 * 
 * @param req - The incoming request
 * @param rawBody - The raw body string of the request
 * @throws Error if signature verification fails
 */
export async function verifyTelnyxSignatureOrThrow(req: Request, rawBody: string): Promise<void> {
  const publicKey = ENV.TELNYX_PUBLIC_KEY;
  
  // Skip verification if public key not configured (development mode)
  if (!publicKey) {
    console.warn('[Security] TELNYX_PUBLIC_KEY not configured - skipping signature verification');
    return;
  }

  const signatureB64 = req.headers.get('telnyx-signature-ed25519') ?? '';
  const timestampStr = req.headers.get('telnyx-timestamp') ?? '';

  if (!signatureB64 || !timestampStr) {
    throw new Error('Missing Telnyx signature headers');
  }

  const ts = Number(timestampStr);
  if (!Number.isFinite(ts)) throw new Error('Invalid telnyx-timestamp');

  // Replay protection: reject if too old/new
  const nowSeconds = Math.floor(Date.now() / 1000);
  const skew = Math.abs(nowSeconds - ts);
  if (skew > ENV.TELNYX_MAX_SKEW_SECONDS) {
    throw new Error(`Timestamp skew too large: ${skew}s (max ${ENV.TELNYX_MAX_SKEW_SECONDS}s)`);
  }

  const signedPayload = `${timestampStr}|${rawBody}`;
  const data = textToBytes(signedPayload);
  const sig = b64ToBytes(signatureB64);

  try {
    const pubKeyBytes = extractPublicKeyBytes(publicKey);

    // Import SPKI key for Ed25519 (DER from PEM)
    const key = await crypto.subtle.importKey(
      'spki',
      pubKeyBytes.buffer,
      { name: 'Ed25519' },
      false,
      ['verify'],
    );

    const ok = await crypto.subtle.verify({ name: 'Ed25519' }, key, sig, data);
    if (!ok) throw new Error('Telnyx signature verification failed');
    
    console.log('[Security] Telnyx signature verified successfully');
  } catch (err) {
    console.error('[Security] Signature verification error:', err);
    throw new Error(`Telnyx signature verification failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Optional verification - returns boolean instead of throwing
 */
export async function verifyTelnyxSignature(req: Request, rawBody: string): Promise<boolean> {
  try {
    await verifyTelnyxSignatureOrThrow(req, rawBody);
    return true;
  } catch {
    return false;
  }
}
