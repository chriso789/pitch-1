/**
 * App-mode detection for the iOS WebView wrapper.
 *
 * `isNativeApp()` returns true when running inside the PitchCRM iOS shell
 * (UA contains "PitchCRMApp") or when the Swift side has injected
 * `window.PitchNative` via WKScriptMessageHandler.
 *
 * Use `isAppFieldMode()` as the semantic flag for tightening field UI
 * (compact spacing, sticky actions, safe-area padding).
 */
import { useEffect, useState } from "react";

export const isNativeApp = (): boolean => {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return (
    /PitchCRMApp/i.test(navigator.userAgent) ||
    !!(window as any).PitchNative ||
    !!(window as any).webkit?.messageHandlers?.pitchNative
  );
};

export const isAppFieldMode = (): boolean => isNativeApp();

export function useIsAppFieldMode(): boolean {
  const [v, setV] = useState<boolean>(() => isAppFieldMode());
  useEffect(() => {
    setV(isAppFieldMode());
  }, []);
  return v;
}
