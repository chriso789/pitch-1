import { resendAdapter } from "./resend-adapter.ts";
import type { TransactionalEmailProvider } from "./types.ts";

export function getEmailProvider(providerId: string): TransactionalEmailProvider {
  switch (providerId) {
    case "resend":
      return resendAdapter;
    default:
      throw new Error(`Unsupported email provider: ${providerId}`);
  }
}

export * from "./types.ts";
