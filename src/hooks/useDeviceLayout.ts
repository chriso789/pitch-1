import { useState, useEffect, useCallback } from 'react';
import { 
  getDeviceCategory, 
  getDeviceType, 
  hasHomeIndicator, 
  hasNotch,
  DeviceCategory 
} from '@/utils/mobileDetection';

export interface DeviceLayoutConfig {
  // Device info
  deviceCategory: DeviceCategory;
  deviceType: 'mobile' | 'tablet' | 'desktop';
  isPhone: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  
  // Safe area padding
  topPadding: number;
  bottomPadding: number;
  
  // Touch targets (minimum sizes)
  touchTargetSize: number;
  fabSize: number;
  
  // Panel configurations
  panelHeight: string;
  panelWidth: string;
  useSidePanel: boolean;
  
  // FAB positioning
  fabPosition: {
    bottom: number;
    right: number;
  };
  
  // Stats overlay
  statsGridCols: number;
  statsIconSize: number;
  statsPosition: {
    top: number;
    left: number;
  };
  
  // Map controls
  mapControlsPosition: 'top-left' | 'top-right';
  
  // Loading indicator
  loadingIndicatorBottom: number;
  
  // Orientation
  isLandscape: boolean;
}

const DEFAULT_LAYOUT: DeviceLayoutConfig = {
  deviceCategory: 'desktop',
  deviceType: 'desktop',
  isPhone: false,
  isTablet: false,
  isDesktop: true,
  topPadding: 0,
  bottomPadding: 0,
  touchTargetSize: 44,
  fabSize: 56,
  panelHeight: '50vh',
  panelWidth: '400px',
  useSidePanel: true,
  fabPosition: { bottom: 24, right: 16 },
  statsGridCols: 4,
  statsIconSize: 40,
  statsPosition: { top: 16, left: 16 },
  mapControlsPosition: 'top-right',
  loadingIndicatorBottom: 112,
  isLandscape: true,
};

function calculateLayout(): DeviceLayoutConfig {
  const deviceCategory = getDeviceCategory();
  const deviceType = getDeviceType();
  const isLandscape = window.innerWidth > window.innerHeight;
  
  const isPhone = deviceCategory === 'iphone' || deviceCategory === 'android-phone';
  const isTablet = deviceCategory === 'ipad' || deviceCategory === 'android-tablet';
  const isDesktop = deviceCategory === 'desktop';
  
  // Calculate safe area padding
  let topPadding = 0;
  let bottomPadding = 0;
  
  if (hasNotch()) {
    topPadding = isLandscape ? 0 : 44; // Notch area
  }
  
  if (hasHomeIndicator()) {
    bottomPadding = 34; // Home indicator area
  }
  
  // Android navigation bar handling
  if (deviceCategory === 'android-phone' || deviceCategory === 'android-tablet') {
    bottomPadding = 48; // Standard Android nav bar
  }
  
  // Base configurations by device type
  if (isPhone) {
    return {
      deviceCategory,
      deviceType,
      isPhone: true,
      isTablet: false,
      isDesktop: false,
      topPadding,
      bottomPadding,
      touchTargetSize: 44,
      fabSize: 56,
      panelHeight: '85vh',
      panelWidth: '100%',
      useSidePanel: false, // Full-width bottom sheets on phones
      fabPosition: { 
        bottom: 96 + bottomPadding, 
        right: 16 
      },
      statsGridCols: 2,
      statsIconSize: 32,
      statsPosition: { top: 16 + topPadding, left: 16 },
      mapControlsPosition: 'top-left',
      loadingIndicatorBottom: 112 + bottomPadding,
      isLandscape,
    };
  }
  
  if (isTablet) {
    return {
      deviceCategory,
      deviceType,
      isPhone: false,
      isTablet: true,
      isDesktop: false,
      topPadding,
      bottomPadding,
      touchTargetSize: 48,
      fabSize: 64,
      panelHeight: '100%',
      panelWidth: deviceCategory === 'ipad' ? '50%' : '60%',
      useSidePanel: true, // Side panels on tablets
      fabPosition: { 
        bottom: 24 + bottomPadding, 
        right: 24 
      },
      statsGridCols: 4,
      statsIconSize: 40,
      statsPosition: { top: 16, left: 16 },
      mapControlsPosition: 'top-right',
      loadingIndicatorBottom: 32 + bottomPadding,
      isLandscape,
    };
  }
  
  // Desktop
  return DEFAULT_LAYOUT;
}

export function useDeviceLayout(): DeviceLayoutConfig {
  const [layout, setLayout] = useState<DeviceLayoutConfig>(() => {
    if (typeof window === 'undefined') return DEFAULT_LAYOUT;
    return calculateLayout();
  });
  
  const updateLayout = useCallback(() => {
    setLayout(calculateLayout());
  }, []);
  
  useEffect(() => {
    // Update on resize and orientation change
    window.addEventListener('resize', updateLayout);
    window.addEventListener('orientationchange', updateLayout);
    
    // Initial calculation
    updateLayout();
    
    return () => {
      window.removeEventListener('resize', updateLayout);
      window.removeEventListener('orientationchange', updateLayout);
    };
  }, [updateLayout]);
  
  return layout;
}

// CSS variable injection for safe areas
export function injectSafeAreaVariables(): void {
  if (typeof document === 'undefined') return;
  
  const style = document.createElement('style');
  style.textContent = `
    :root {
      --sat: env(safe-area-inset-top, 0px);
      --sab: env(safe-area-inset-bottom, 0px);
      --sal: env(safe-area-inset-left, 0px);
      --sar: env(safe-area-inset-right, 0px);
    }
  `;
  document.head.appendChild(style);
}
