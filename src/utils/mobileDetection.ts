/**
 * Mobile detection utilities for PITCH CRM
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

export const getDeviceType = (): 'mobile' | 'tablet' | 'desktop' => {
  const width = window.innerWidth;
  if (width < 768) return 'mobile';
  if (width < 1024) return 'tablet';
  return 'desktop';
};
