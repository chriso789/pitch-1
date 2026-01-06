/**
 * Google Maps Dynamic Loader
 * Loads Google Maps API dynamically with API key from edge function
 */

let isLoading = false;
let isLoaded = false;
let loadedApiKey: string | null = null;
const loadPromises: Array<{ resolve: (value: void) => void; reject: (error: Error) => void }>[] = [];

export const loadGoogleMaps = (apiKey: string): Promise<void> => {
  // Already loaded with same key
  if (isLoaded && window.google?.maps && loadedApiKey === apiKey) {
    return Promise.resolve();
  }

  // Currently loading - return existing promise
  if (isLoading) {
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        if (isLoaded && window.google?.maps) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
      
      // Timeout after 30 seconds
      setTimeout(() => {
        clearInterval(checkInterval);
        if (!isLoaded) {
          reject(new Error('Google Maps loading timeout'));
        }
      }, 30000);
    });
  }

  isLoading = true;

  return new Promise((resolve, reject) => {
    const callbackName = '_googleMapsLoaded';
    
    // @ts-ignore - Adding callback to window
    window[callbackName] = () => {
      isLoaded = true;
      isLoading = false;
      loadedApiKey = apiKey;
      
      resolve();
      
      // Cleanup
      // @ts-ignore
      delete window[callbackName];
    };

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,geometry&callback=${callbackName}`;
    script.async = true;
    script.defer = true;
    
    script.onerror = (error) => {
      isLoading = false;
      console.error('Failed to load Google Maps', error);
      reject(new Error('Failed to load Google Maps API'));
    };
    
    document.head.appendChild(script);
  });
};

/**
 * Check if Google Maps is loaded
 */
export const isGoogleMapsLoaded = (): boolean => {
  return isLoaded && !!window.google?.maps;
};

/**
 * Get Google Maps or throw error
 */
export const getGoogleMaps = (): typeof window.google.maps | null => {
  if (!isGoogleMapsLoaded()) {
    return null;
  }
  return window.google?.maps || null;
};
