/**
 * Device Fingerprinting Service
 * Generates a unique device fingerprint for trusted device recognition
 */

const FINGERPRINT_KEY = 'pitch_device_fingerprint';

interface DeviceInfo {
  userAgent: string;
  screenResolution: string;
  timezone: string;
  language: string;
  platform: string;
  colorDepth: number;
  pixelRatio: number;
  canvasFingerprint: string;
  webglVendor: string;
  webglRenderer: string;
}

/**
 * Generate a canvas fingerprint (unique to browser/GPU combination)
 */
function getCanvasFingerprint(): string {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'no-canvas';
    
    canvas.width = 200;
    canvas.height = 50;
    
    ctx.textBaseline = 'alphabetic';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('PITCH CRM', 2, 15);
    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
    ctx.fillText('fingerprint', 4, 45);
    
    return canvas.toDataURL().slice(-50);
  } catch {
    return 'canvas-error';
  }
}

/**
 * Get WebGL info for fingerprinting
 */
function getWebGLInfo(): { vendor: string; renderer: string } {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return { vendor: 'no-webgl', renderer: 'no-webgl' };
    
    const debugInfo = (gl as WebGLRenderingContext).getExtension('WEBGL_debug_renderer_info');
    if (!debugInfo) return { vendor: 'unknown', renderer: 'unknown' };
    
    return {
      vendor: (gl as WebGLRenderingContext).getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || 'unknown',
      renderer: (gl as WebGLRenderingContext).getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || 'unknown'
    };
  } catch {
    return { vendor: 'error', renderer: 'error' };
  }
}

/**
 * Collect device information for fingerprinting
 */
function collectDeviceInfo(): DeviceInfo {
  const webgl = getWebGLInfo();
  
  return {
    userAgent: navigator.userAgent,
    screenResolution: `${screen.width}x${screen.height}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: navigator.language,
    platform: navigator.platform,
    colorDepth: screen.colorDepth,
    pixelRatio: window.devicePixelRatio || 1,
    canvasFingerprint: getCanvasFingerprint(),
    webglVendor: webgl.vendor,
    webglRenderer: webgl.renderer
  };
}

/**
 * Generate a hash from device info
 */
async function hashString(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate device fingerprint
 */
export async function generateDeviceFingerprint(): Promise<string> {
  const info = collectDeviceInfo();
  const fingerprintData = JSON.stringify(info);
  const hash = await hashString(fingerprintData);
  return hash;
}

/**
 * Get or create device fingerprint (cached in localStorage)
 */
export async function getDeviceFingerprint(): Promise<string> {
  // Check localStorage first
  const cached = localStorage.getItem(FINGERPRINT_KEY);
  if (cached) return cached;
  
  // Generate new fingerprint
  const fingerprint = await generateDeviceFingerprint();
  localStorage.setItem(FINGERPRINT_KEY, fingerprint);
  return fingerprint;
}

/**
 * Get a friendly device name from user agent
 */
export function getDeviceName(): string {
  const ua = navigator.userAgent;
  
  // Detect OS
  let os = 'Unknown OS';
  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac')) os = 'macOS';
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
  
  // Detect Browser
  let browser = 'Unknown Browser';
  if (ua.includes('Chrome') && !ua.includes('Edg')) browser = 'Chrome';
  else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
  else if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Edg')) browser = 'Edge';
  
  return `${browser} on ${os}`;
}

/**
 * Clear stored fingerprint (useful for testing)
 */
export function clearDeviceFingerprint(): void {
  localStorage.removeItem(FINGERPRINT_KEY);
}
