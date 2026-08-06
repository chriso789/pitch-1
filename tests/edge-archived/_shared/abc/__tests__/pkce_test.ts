import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { b64url, pkce } from "../pkce.ts";

Deno.test("b64url produces URL-safe base64 without padding", () => {
  const encoded = b64url(new TextEncoder().encode("abc?>"));
  // Must contain no +, /, or = padding.
  assertEquals(encoded.includes("+"), false);
  assertEquals(encoded.includes("/"), false);
  assertEquals(encoded.includes("="), false);
});

Deno.test("b64url handles empty input", () => {
  assertEquals(b64url(new Uint8Array()), "");
});

Deno.test("pkce returns a fresh verifier/challenge pair each call", async () => {
  const a = await pkce();
  const b = await pkce();
  // Verifier is 32 random bytes → 43 base64url chars.
  assertEquals(a.verifier.length, 43);
  assertEquals(a.challenge.length, 43);
  assertNotEquals(a.verifier, b.verifier);
  assertNotEquals(a.challenge, b.challenge);
  assert(!a.verifier.includes("="));
  assert(!a.challenge.includes("="));
});

Deno.test("pkce challenge is SHA-256(verifier) — deterministic given verifier", async () => {
  const { verifier, challenge } = await pkce();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  assertEquals(b64url(digest), challenge);
});
