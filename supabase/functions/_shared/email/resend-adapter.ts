// Resend adapter — the ONLY file allowed to know about Resend response shapes.
// Uses Svix signature scheme for webhook verification (Resend's default).

import type {
  NormalizedEmailEvent,
  NormalizedEmailStatus,
  ProviderFailureClass,
  SendInvoiceEmailInput,
  SendResult,
  TransactionalEmailProvider,
  WebhookVerification,
} from "./types.ts";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

function apiKey(): string {
  const k = Deno.env.get("RESEND_API_KEY");
  if (!k) throw new Error("RESEND_API_KEY is not configured");
  return k;
}

function webhookSecret(): string | null {
  return Deno.env.get("RESEND_WEBHOOK_SECRET") ?? null;
}

// Resend event.type -> normalized status
const STATUS_MAP: Record<string, NormalizedEmailStatus> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
};

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

// Svix signature format: v1,<base64>  (space-separated multiple sigs allowed).
// Signed payload = `${svix_id}.${svix_timestamp}.${rawBody}`, then HMAC-SHA256
// with the secret bytes (secret decoded from `whsec_<base64>` prefix).
async function verifySvix(
  headers: Headers,
  rawBody: string,
  secret: string,
): Promise<WebhookVerification> {
  const svixId = headers.get("svix-id") ?? headers.get("webhook-id");
  const svixTs = headers.get("svix-timestamp") ?? headers.get("webhook-timestamp");
  const svixSig = headers.get("svix-signature") ?? headers.get("webhook-signature");
  if (!svixId || !svixTs || !svixSig) {
    return { valid: false, reason: "missing_svix_headers" };
  }

  // Replay window: 5 minutes.
  const tsSec = Number(svixTs);
  if (!Number.isFinite(tsSec) || Math.abs(Date.now() / 1000 - tsSec) > 300) {
    return { valid: false, reason: "stale_timestamp" };
  }

  // Decode secret. Svix secrets are `whsec_<base64>`.
  const secretBody = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let secretBytes: Uint8Array;
  try {
    secretBytes = base64ToBytes(secretBody);
  } catch {
    return { valid: false, reason: "invalid_secret_format" };
  }

  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signedPayload = `${svixId}.${svixTs}.${rawBody}`;
  const sigBuf = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signedPayload),
  );
  const expected = bytesToBase64(new Uint8Array(sigBuf));

  const candidates = svixSig.split(" ")
    .map((p) => p.trim())
    .filter((p) => p.startsWith("v1,"))
    .map((p) => p.slice(3));

  for (const c of candidates) {
    if (c === expected) return { valid: true };
  }
  return { valid: false, reason: "signature_mismatch" };
}

export const resendAdapter: TransactionalEmailProvider = {
  id: "resend",

  async sendInvoiceEmail(input: SendInvoiceEmailInput): Promise<SendResult> {
    let httpStatus = 0;
    try {
      const from = input.fromName
        ? `${input.fromName.replace(/[<>]/g, "")} <${input.fromEmail}>`
        : input.fromEmail;
      const body: Record<string, unknown> = {
        from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
        headers: {
          "X-Entity-Ref-ID": input.idempotencyKey,
        },
      };
      if (input.replyTo) body.reply_to = input.replyTo;
      if (input.tags && input.tags.length) body.tags = input.tags;

      const res = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey()}`,
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
        },
        body: JSON.stringify(body),
      });
      httpStatus = res.status;
      const json = await res.json().catch(() => ({} as Record<string, unknown>));

      if (!res.ok) {
        return {
          ok: false,
          providerMessageId: null,
          errorCode: String((json as any)?.name ?? res.status),
          errorMessage: String((json as any)?.message ?? `HTTP ${res.status}`),
          failureClass: resendAdapter.classifyProviderFailure(res.status, json),
          httpStatus,
        };
      }
      const providerMessageId = String((json as any)?.id ?? "");
      return {
        ok: true,
        providerMessageId: providerMessageId || null,
        httpStatus,
      };
    } catch (err) {
      return {
        ok: false,
        providerMessageId: null,
        errorCode: "network_error",
        errorMessage: err instanceof Error ? err.message : String(err),
        failureClass: "transient",
        httpStatus,
      };
    }
  },

  verifyWebhook(headers, rawBody): WebhookVerification {
    const secret = webhookSecret();
    if (!secret) {
      return { valid: false, reason: "webhook_secret_not_configured" };
    }
    // Wrap sync signature with a synchronous shell — verifyWebhook is declared
    // sync in the interface, but crypto.subtle is async. We block by scheduling
    // via a shared promise queue is overkill; use Deno's async and require the
    // caller to await when needed. Adjust interface: return Promise via cast.
    // (Callers do `await provider.verifyWebhook(...)` — TS handles the union.)
    // deno-lint-ignore no-explicit-any
    return verifySvix(headers, rawBody, secret) as any;
  },

  normalizeWebhookEvent(raw): NormalizedEmailEvent | null {
    const r = raw as any;
    if (!r || typeof r !== "object") return null;
    const type = String(r.type ?? "");
    const status = STATUS_MAP[type];
    if (!status) return null;
    const providerEventId = String(
      r.id ?? r.event_id ?? `${type}:${r.data?.email_id ?? ""}:${r.created_at ?? ""}`,
    );
    const providerMessageId = r.data?.email_id ? String(r.data.email_id) : null;
    const recipient = Array.isArray(r.data?.to) ? String(r.data.to[0] ?? "") : null;
    let reason: string | null = null;
    if (status === "bounced") reason = r.data?.bounce?.message ?? "bounced";
    else if (status === "complained") reason = "complaint";
    else if (status === "failed") reason = r.data?.reason ?? r.data?.failed?.reason ?? "failed";
    else if (status === "delayed") reason = "delivery_delayed";
    return {
      providerEventId,
      providerMessageId,
      status,
      occurredAt: r.created_at ?? new Date().toISOString(),
      recipient,
      reason,
    };
  },

  classifyProviderFailure(httpStatus, body): ProviderFailureClass {
    if (httpStatus === 429) return "transient";
    if (httpStatus >= 500) return "transient";
    if (httpStatus >= 400 && httpStatus < 500) {
      const name = String((body as any)?.name ?? "").toLowerCase();
      if (name.includes("validation") || name.includes("invalid") || name.includes("not_found")) {
        return "permanent";
      }
      return "permanent";
    }
    return "unknown";
  },

  getProviderMessageId(raw): string | null {
    const r = raw as any;
    return r?.data?.email_id ? String(r.data.email_id) : null;
  },
};
