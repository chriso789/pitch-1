import { useState, useEffect } from 'react';
import { LocationSwitchingOverlay } from './LocationSwitchingOverlay';

const SWITCHING_KEY = 'location-switching';

interface SwitchingData {
  locationName: string | null;
  timestamp: number;
}

export const GlobalLocationHandler = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [locationName, setLocationName] = useState<string | null>(null);

  useEffect(() => {
    const switchingData = localStorage.getItem(SWITCHING_KEY);
    if (switchingData) {
      try {
        const data: SwitchingData = JSON.parse(switchingData);
        // Only show overlay if switch started within last 10 seconds
        if (Date.now() - data.timestamp < 10000) {
          setLocationName(data.locationName);
          setIsLoading(true);
          
          // Fade out after a short delay
          setTimeout(() => {
            setIsLoading(false);
            localStorage.removeItem(SWITCHING_KEY);
          }, 800);
        } else {
          localStorage.removeItem(SWITCHING_KEY);
        }
      } catch {
        localStorage.removeItem(SWITCHING_KEY);
      }
    }
  }, []);

  return <LocationSwitchingOverlay isVisible={isLoading} locationName={locationName} />;
};

// Helper function to set the switching flag before redirect
export const setLocationSwitchingFlag = (locationName: string | null) => {
  const data: SwitchingData = {
    locationName,
    timestamp: Date.now()
  };
  localStorage.setItem(SWITCHING_KEY, JSON.stringify(data));
};

// Helper to clear the flag if needed
export const clearLocationSwitchingFlag = () => {
  localStorage.removeItem(SWITCHING_KEY);
};
