// Provider-agnostic transactional email interface.
// Invoice + portal layers depend ONLY on these types — never on Resend response
// objects. Adding a second adapter (e.g. Postmark) must not require touching
// invoice-email-send or resend-invoice-webhook.

export type NormalizedEmailStatus =
  | "queued"
  | "accepted"
  | "sent"
  | "delivered"
  | "delayed"
  | "bounced"
  | "complained"
  | "failed";

export type ProviderFailureClass =
  | "transient" // safe to retry (429, 5xx, network timeout)
  | "permanent" // do NOT retry (invalid recipient, unverified sender, hard bounce, complaint)
  | "unknown";

export interface SendInvoiceEmailInput {
  to: string;
  fromEmail: string;
  fromName?: string | null;
  replyTo?: string | null;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
  tags?: { name: string; value: string }[];
}

export interface SendResult {
  ok: boolean;
  providerMessageId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  failureClass?: ProviderFailureClass;
  httpStatus?: number;
}

export interface NormalizedEmailEvent {
  providerEventId: string;
  providerMessageId: string | null;
  status: NormalizedEmailStatus;
  occurredAt: string; // ISO
  recipient?: string | null;
  reason?: string | null; // safe human-readable, never raw payload
}

export interface WebhookVerification {
  valid: boolean;
  reason?: string;
}

export interface TransactionalEmailProvider {
  readonly id: "resend";
  sendInvoiceEmail(input: SendInvoiceEmailInput): Promise<SendResult>;
  verifyWebhook(headers: Headers, rawBody: string): WebhookVerification;
  normalizeWebhookEvent(rawJson: unknown): NormalizedEmailEvent | null;
  classifyProviderFailure(httpStatus: number, body: unknown): ProviderFailureClass;
  getProviderMessageId(rawJson: unknown): string | null;
}
