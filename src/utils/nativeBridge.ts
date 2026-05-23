/**
 * nativeBridge — thin alias surface over `src/lib/native/bridge.ts`.
 *
 * Exposes the exact function names used across canvass/property panels.
 * Every call is safe in a plain browser; the underlying bridge falls back
 * to web equivalents (geolocation, file input, maps URL, localStorage,
 * Notification API, navigator.vibrate, navigator.share).
 */
import nativeBridge, { type BridgeResult } from "@/lib/native/bridge";
import { isNativeApp } from "@/lib/native/appMode";

export type HapticType = "light" | "medium" | "heavy" | "success" | "error";

export const isPitchNativeApp = (): boolean => isNativeApp();

export const openNativeCamera = (
  payload?: { quality?: number },
): Promise<BridgeResult<{ dataUrl: string }>> => nativeBridge.openCamera(payload);

export const requestNativeLocation = (): Promise<
  BridgeResult<{ lat: number; lng: number; accuracy: number }>
> => nativeBridge.getLocation();

export const openNativeMaps = (
  lat: number,
  lng: number,
  label?: string,
): Promise<BridgeResult<null>> => nativeBridge.openAppleMaps(lat, lng, label);

export const storeNativeToken = (
  token: string,
  key = "auth",
): Promise<BridgeResult<null>> => nativeBridge.storeToken(key, token);

export const requestPushPermission = (): Promise<
  BridgeResult<{ granted: boolean; deviceToken?: string }>
> => nativeBridge.requestPushPermission();

export const haptic = (type: HapticType = "light"): Promise<BridgeResult<null>> =>
  nativeBridge.haptic(type);

export { nativeBridge };
export default {
  isPitchNativeApp,
  openNativeCamera,
  requestNativeLocation,
  openNativeMaps,
  storeNativeToken,
  requestPushPermission,
  haptic,
};
