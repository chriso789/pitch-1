/**
 * Mobile detection utilities for PITCH CRM
 * Enhanced with specific device targeting for adaptive UI layouts
 */

export const isIOS = (): boolean => {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
};

export const isiOSSafari = (): boolean => {
  return isIOS() && /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS/.test(navigator.userAgent);
};

export const isAndroid = (): boolean => {
  return /Android/.test(navigator.userAgent);
};

// Specific device detection
export const isIPad = (): boolean => {
  // Check for iPad in user agent or iPad on iOS 13+ (reports as MacIntel with touch)
  return /iPad/.test(navigator.userAgent) || 
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
};

export const isIPhone = (): boolean => {
  return /iPhone/.test(navigator.userAgent) && !(window as any).MSStream;
};

export const isAndroidPhone = (): boolean => {
  return isAndroid() && window.innerWidth < 768;
};

export const isAndroidTablet = (): boolean => {
  return isAndroid() && window.innerWidth >= 768;
};

export const isMobileDevice = (): boolean => {
  return isIOS() || isAndroid() || /webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

export const isTouchDevice = (): boolean => {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
};

export const supportsInlinePDF = (): boolean => {
  // iOS Safari has poor inline PDF support
  if (isiOSSafari()) return false;
  
  // Most desktop browsers and Android Chrome support inline PDFs
  return !isMobileDevice() || isAndroid();
};

export type DeviceCategory = 'iphone' | 'ipad' | 'android-phone' | 'android-tablet' | 'desktop';

export const getDeviceCategory = (): DeviceCategory => {
  if (isIPhone()) return 'iphone';
  if (isIPad()) return 'ipad';
  if (isAndroidPhone()) return 'android-phone';
  if (isAndroidTablet()) return 'android-tablet';
  return 'desktop';
};

export const getDeviceType = (): 'mobile' | 'tablet' | 'desktop' => {
  const width = window.innerWidth;
  if (isIPhone() || isAndroidPhone()) return 'mobile';
  if (isIPad() || isAndroidTablet()) return 'tablet';
  if (width < 768) return 'mobile';
  if (width < 1024) return 'tablet';
  return 'desktop';
};

// Safe area detection for notch/home indicator handling
export const getSafeAreaInsets = (): { top: number; bottom: number; left: number; right: number } => {
  const style = getComputedStyle(document.documentElement);
  return {
    top: parseInt(style.getPropertyValue('--sat') || '0', 10) || 0,
    bottom: parseInt(style.getPropertyValue('--sab') || '0', 10) || 0,
    left: parseInt(style.getPropertyValue('--sal') || '0', 10) || 0,
    right: parseInt(style.getPropertyValue('--sar') || '0', 10) || 0,
  };
};

// Check if device has a notch (iPhone X and later)
export const hasNotch = (): boolean => {
  if (!isIPhone()) return false;
  // iPhone X and later have screen height >= 812
  const screenHeight = Math.max(window.screen.height, window.screen.width);
  return screenHeight >= 812;
};

// Check if device has home indicator (no physical home button)
export const hasHomeIndicator = (): boolean => {
  return hasNotch() || (isIPad() && navigator.maxTouchPoints > 1);
};
