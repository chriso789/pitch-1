/**
 * window.PitchNative — JS↔Swift bridge with web fallbacks.
 *
 * Every method posts to `window.webkit.messageHandlers.<channel>.postMessage`
 * and awaits a response keyed by a request id. The Swift side resolves the
 * pending promise by calling `window.__pitchNativeResolve(id, result)`.
 *
 * When the native channel is unavailable (running in a normal browser), each
 * method falls back to the best web equivalent so the same call sites work
 * everywhere.
 */

export type BridgeResult<T> = { ok: true; data: T } | { ok: false; error: string };

type HapticStyle = "light" | "medium" | "heavy" | "success" | "error";

export interface PitchNativeAPI {
  openCamera(opts?: { quality?: number }): Promise<BridgeResult<{ dataUrl: string }>>;
  getLocation(): Promise<BridgeResult<{ lat: number; lng: number; accuracy: number }>>;
  openAppleMaps(lat: number, lng: number, label?: string): Promise<BridgeResult<null>>;
  storeToken(key: string, value: string): Promise<BridgeResult<null>>;
  readToken(key: string): Promise<BridgeResult<{ value: string | null }>>;
  requestPushPermission(): Promise<BridgeResult<{ granted: boolean; deviceToken?: string }>>;
  haptic(style: HapticStyle): Promise<BridgeResult<null>>;
  share(payload: { title?: string; text?: string; url?: string }): Promise<BridgeResult<null>>;
}

// ---------- internal: native postMessage round-trip ----------

type Pending = { resolve: (r: BridgeResult<any>) => void };
const pending = new Map<string, Pending>();
let nextId = 0;

function ensureGlobalResolver() {
  if (typeof window === "undefined") return;
  if ((window as any).__pitchNativeResolve) return;
  (window as any).__pitchNativeResolve = (id: string, result: BridgeResult<any>) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    p.resolve(result);
  };
}

function hasChannel(name: string): boolean {
  if (typeof window === "undefined") return false;
  return !!(window as any).webkit?.messageHandlers?.[name];
}

function callNative<T>(channel: string, payload: Record<string, unknown>): Promise<BridgeResult<T>> {
  ensureGlobalResolver();
  return new Promise((resolve) => {
    const id = `pn_${Date.now()}_${nextId++}`;
    pending.set(id, { resolve: resolve as any });
    try {
      (window as any).webkit.messageHandlers[channel].postMessage({ id, ...payload });
    } catch (e: any) {
      pending.delete(id);
      resolve({ ok: false, error: e?.message ?? "native_invoke_failed" });
    }
    // Safety: 20s timeout
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        resolve({ ok: false, error: "native_timeout" });
      }
    }, 20_000);
  });
}

// ---------- web fallbacks ----------

function webOpenCamera(): Promise<BridgeResult<{ dataUrl: string }>> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      return resolve({ ok: false, error: "no_document" });
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    (input as any).capture = "environment";
    input.style.display = "none";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        document.body.removeChild(input);
        return resolve({ ok: false, error: "no_file" });
      }
      const reader = new FileReader();
      reader.onload = () => {
        document.body.removeChild(input);
        resolve({ ok: true, data: { dataUrl: String(reader.result) } });
      };
      reader.onerror = () => {
        document.body.removeChild(input);
        resolve({ ok: false, error: "read_failed" });
      };
      reader.readAsDataURL(file);
    };
    document.body.appendChild(input);
    input.click();
  });
}

function webGetLocation(): Promise<BridgeResult<{ lat: number; lng: number; accuracy: number }>> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      return resolve({ ok: false, error: "geolocation_unsupported" });
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          ok: true,
          data: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy },
        }),
      (err) => resolve({ ok: false, error: err.message }),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 5_000 },
    );
  });
}

function webOpenAppleMaps(lat: number, lng: number, label?: string): BridgeResult<null> {
  if (typeof window === "undefined") return { ok: false, error: "no_window" };
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const q = label ? `${encodeURIComponent(label)}@${lat},${lng}` : `${lat},${lng}`;
  const url = isIOS
    ? `maps://?daddr=${lat},${lng}&q=${q}`
    : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  window.location.href = url;
  return { ok: true, data: null };
}

async function webRequestPush(): Promise<BridgeResult<{ granted: boolean }>> {
  if (typeof Notification === "undefined") return { ok: false, error: "notifications_unsupported" };
  try {
    const perm = await Notification.requestPermission();
    return { ok: true, data: { granted: perm === "granted" } };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "request_failed" };
  }
}

function webHaptic(style: HapticStyle): BridgeResult<null> {
  if (typeof navigator === "undefined" || !navigator.vibrate) {
    return { ok: false, error: "vibrate_unsupported" };
  }
  const pat =
    style === "heavy" ? 40 : style === "medium" ? 20 : style === "success" ? [10, 50, 10] : style === "error" ? [20, 100, 20] : 10;
  navigator.vibrate(pat);
  return { ok: true, data: null };
}

async function webShare(payload: { title?: string; text?: string; url?: string }): Promise<BridgeResult<null>> {
  if (typeof navigator !== "undefined" && (navigator as any).share) {
    try {
      await (navigator as any).share(payload);
      return { ok: true, data: null };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? "share_failed" };
    }
  }
  if (payload.url && typeof window !== "undefined") {
    window.open(payload.url, "_blank", "noopener,noreferrer");
    return { ok: true, data: null };
  }
  return { ok: false, error: "share_unsupported" };
}

// ---------- public API ----------

export const nativeBridge: PitchNativeAPI = {
  openCamera: (opts) =>
    hasChannel("openCamera") ? callNative("openCamera", { ...(opts ?? {}) }) : webOpenCamera(),

  getLocation: () => (hasChannel("getLocation") ? callNative("getLocation", {}) : webGetLocation()),

  openAppleMaps: async (lat, lng, label) =>
    hasChannel("openAppleMaps")
      ? callNative("openAppleMaps", { lat, lng, label })
      : webOpenAppleMaps(lat, lng, label),

  storeToken: async (key, value) => {
    if (hasChannel("storeToken")) return callNative("storeToken", { key, value });
    try {
      localStorage.setItem(`pn_${key}`, value);
      return { ok: true, data: null };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? "store_failed" };
    }
  },

  readToken: async (key) => {
    if (hasChannel("readToken")) return callNative("readToken", { key });
    try {
      return { ok: true, data: { value: localStorage.getItem(`pn_${key}`) } };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? "read_failed" };
    }
  },

  requestPushPermission: () =>
    hasChannel("requestPushPermission")
      ? callNative("requestPushPermission", {})
      : webRequestPush().then((r) => (r.ok ? { ok: true as const, data: { granted: r.data.granted } } : r)),

  haptic: async (style) =>
    hasChannel("haptic") ? callNative("haptic", { style }) : webHaptic(style),

  share: (payload) => (hasChannel("share") ? callNative("share", payload) : webShare(payload)),
};

// Expose on window so legacy code and the Swift side can call uniformly.
if (typeof window !== "undefined") {
  (window as any).PitchNative = (window as any).PitchNative ?? nativeBridge;
  ensureGlobalResolver();
}

export default nativeBridge;
