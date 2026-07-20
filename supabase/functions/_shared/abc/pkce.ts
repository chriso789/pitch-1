// PKCE (Proof Key for Code Exchange) helpers used by the ABC OAuth flow.
// Extracted verbatim from both handlers so behaviour is identical.

/** URL-safe base64 without padding. */
export function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

/** Generate a fresh PKCE verifier + SHA-256 challenge pair. */
export async function pkce(): Promise<PkcePair> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return { verifier, challenge: b64url(digest) };
}
