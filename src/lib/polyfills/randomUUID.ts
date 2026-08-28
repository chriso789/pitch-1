/**
 * crypto.randomUUID polyfill.
 *
 * `crypto.randomUUID` is only exposed in secure contexts and is missing in
 * some browsers/WebViews (older Chrome, http:// origins, in-app browsers).
 * Several screens call it directly, which crashed the whole page via the
 * global error boundary. This installs an RFC-4122 v4 fallback at boot.
 */
type UUID = `${string}-${string}-${string}-${string}-${string}`;

function fallbackUUID(): UUID {
  const bytes = new Uint8Array(16);
  const c = globalThis.crypto;
  if (c?.getRandomValues) {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10

  const hex: string[] = [];
  for (let i = 0; i < 16; i++) hex.push(bytes[i].toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-") as UUID;
}

export function installRandomUUIDPolyfill(): void {
  const c = globalThis.crypto as Crypto | undefined;
  if (!c) {
    (globalThis as any).crypto = { randomUUID: fallbackUUID };
    return;
  }
  if (typeof (c as any).randomUUID !== "function") {
    try {
      Object.defineProperty(c, "randomUUID", {
        value: fallbackUUID,
        configurable: true,
        writable: true,
      });
    } catch {
      (globalThis as any).crypto = { ...c, randomUUID: fallbackUUID };
    }
  }
}
