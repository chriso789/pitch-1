/**
 * useFieldMobileMode — single source of truth for "Field Mode" UI gating.
 *
 * Field Mode = viewport < 768px OR running inside the PitchCRM iOS WebView.
 * Use this only to flip layout (sticky headers, dense mobile sheets, safe-area
 * padding, larger touch targets). Never use it to change business logic.
 */
import { useIsMobile } from "@/hooks/use-mobile";
import { useIsAppFieldMode } from "@/lib/native/appMode";

export interface FieldMobileMode {
  isMobileViewport: boolean;
  isNativeApp: boolean;
  isFieldMobileMode: boolean;
}

export function useFieldMobileMode(): FieldMobileMode {
  const isMobileViewport = useIsMobile();
  const isNativeApp = useIsAppFieldMode();
  return {
    isMobileViewport,
    isNativeApp,
    isFieldMobileMode: isMobileViewport || isNativeApp,
  };
}

export default useFieldMobileMode;
