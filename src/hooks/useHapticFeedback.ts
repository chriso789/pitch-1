import { useCallback } from 'react';

export type HapticPattern = 'light' | 'medium' | 'heavy' | 'success' | 'error';

const HAPTIC_PATTERNS: Record<HapticPattern, number | number[]> = {
  light: 10,
  medium: 20,
  heavy: 40,
  success: [10, 50, 10],
  error: [20, 100, 20, 100, 20],
};

export function useHapticFeedback() {
  const isSupported = typeof navigator !== 'undefined' && 'vibrate' in navigator;

  const vibrate = useCallback((pattern: HapticPattern = 'light') => {
    if (!isSupported) return false;

    try {
      const vibratePattern = HAPTIC_PATTERNS[pattern];
      return navigator.vibrate(vibratePattern);
    } catch (error) {
      console.warn('Haptic feedback failed:', error);
      return false;
    }
  }, [isSupported]);

  const cancel = useCallback(() => {
    if (!isSupported) return;
    navigator.vibrate(0);
  }, [isSupported]);

  return {
    vibrate,
    cancel,
    isSupported,
  };
}
