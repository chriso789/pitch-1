// ============================================
// SHARED WEBHOOK SIGNATURE VERIFICATION HELPERS
// Fail-closed verification for public provider callbacks.
// ============================================

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}

const enc = new TextEncoder();

function timingSafeEqual(a: string, b: string): boolean {
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  // Always compare a fixed number of bytes to avoid short-circuiting on length.
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToBytes(b64: string): Uint8Array {
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function hmacSha256(keyBytes: Uint8Array, message: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as unknown as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return await crypto.subtle.sign("HMAC", key, enc.encode(message) as unknown as BufferSource);
}

/**
 * Verify an HMAC-SHA256 signature over the raw request body.
 * Accepts either hex or base64 encoded signatures, optionally prefixed (e.g. "sha256=").
 * Throws WebhookVerificationError when the secret is missing or the signature does not match.
 */
export async function verifyHmacSha256OrThrow(opts: {
  rawBody: string;
  secret: string | undefined;
  signatureHeaders: (string | null)[];
  secretName: string;
}): Promise<void> {
  const { rawBody, secret, signatureHeaders, secretName } = opts;

  if (!secret) {
    throw new WebhookVerificationError(
      `${secretName} is not configured; refusing to trust unverified webhook`,
    );
  }

  const provided = signatureHeaders
    .filter((h): h is string => typeof h === "string" && h.trim().length > 0)
    .map((h) => h.trim().replace(/^sha256=/i, ""));

  if (provided.length === 0) {
    throw new WebhookVerificationError("Missing webhook signature header");
  }

  const mac = await hmacSha256(enc.encode(secret), rawBody);
  const expectedHex = toHex(mac);
  const expectedB64 = toBase64(mac);

  const ok = provided.some((sig) => timingSafeEqual(sig, expectedHex) || timingSafeEqual(sig, expectedB64));
  if (!ok) throw new WebhookVerificationError("Invalid webhook signature");
}

/**
 * Verify a plain shared-secret header (used for internally-configured providers
 * that do not sign payloads, e.g. self-hosted Asterisk bridges).
 */
export function verifySharedSecretOrThrow(opts: {
  req: Request;
  secret: string | undefined;
  secretName: string;
  headerNames?: string[];
}): void {
  const { req, secret, secretName } = opts;
  const headerNames = opts.headerNames ?? ["x-webhook-secret", "x-internal-worker-secret"];

  if (!secret) {
    throw new WebhookVerificationError(
      `${secretName} is not configured; refusing to trust unverified webhook`,
    );
  }

  const provided = headerNames
    .map((n) => req.headers.get(n))
    .find((v) => typeof v === "string" && v.length > 0);

  if (!provided || !timingSafeEqual(provided, secret)) {
    throw new WebhookVerificationError("Invalid or missing webhook shared secret");
  }
}

/**
 * Verify a Svix-style signature (used by Resend webhooks).
 * Signed content is `${svix-id}.${svix-timestamp}.${rawBody}`; the header may
 * contain multiple space-separated `v1,<base64sig>` entries.
 */
export async function verifySvixOrThrow(opts: {
  req: Request;
  rawBody: string;
  secret: string | undefined;
  secretName: string;
  toleranceSeconds?: number;
}): Promise<void> {
  const { req, rawBody, secret, secretName } = opts;
  const tolerance = opts.toleranceSeconds ?? 300;

  if (!secret) {
    throw new WebhookVerificationError(
      `${secretName} is not configured; refusing to trust unverified webhook`,
    );
  }

  const id = req.headers.get("svix-id") ?? req.headers.get("webhook-id");
  const timestamp = req.headers.get("svix-timestamp") ?? req.headers.get("webhook-timestamp");
  const signatureHeader = req.headers.get("svix-signature") ?? req.headers.get("webhook-signature");

  if (!id || !timestamp || !signatureHeader) {
    throw new WebhookVerificationError("Missing svix signature headers");
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) throw new WebhookVerificationError("Invalid svix-timestamp");
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > tolerance) {
    throw new WebhookVerificationError("Svix timestamp outside tolerance window");
  }

  // Secret format: "whsec_<base64>" (raw base64 key) or a plain string.
  const rawSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let keyBytes: Uint8Array;
  try {
    keyBytes = b64ToBytes(rawSecret);
  } catch {
    keyBytes = enc.encode(rawSecret);
  }

  const mac = await hmacSha256(keyBytes, `${id}.${timestamp}.${rawBody}`);
  const expected = toBase64(mac);

  const provided = signatureHeader
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (part.includes(",") ? part.split(",")[1] : part));

  if (!provided.some((sig) => timingSafeEqual(sig, expected))) {
    throw new WebhookVerificationError("Invalid svix signature");
  }
}

export function unauthorizedResponse(headers: Record<string, string>, message = "unauthorized"): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status: 401,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

/**
 * Verify a Twilio X-Twilio-Signature (HMAC-SHA1 over url + sorted POST params).
 */
export async function verifyTwilioSignatureOrThrow(opts: {
  req: Request;
  params: Record<string, string>;
  authToken: string | undefined;
  url?: string;
}): Promise<void> {
  const { req, params, authToken } = opts;
  if (!authToken) {
    throw new WebhookVerificationError(
      "TWILIO_AUTH_TOKEN is not configured; refusing to trust unverified webhook",
    );
  }
  const provided = req.headers.get("x-twilio-signature");
  if (!provided) throw new WebhookVerificationError("Missing X-Twilio-Signature header");

  const url = opts.url ?? req.url;
  let data = url;
  for (const key of Object.keys(params).sort()) data += key + params[key];

  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(authToken) as unknown as BufferSource,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(data) as unknown as BufferSource);
  if (!timingSafeEqual(provided, toBase64(mac))) {
    throw new WebhookVerificationError("Invalid Twilio signature");
  }
}
