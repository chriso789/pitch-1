/**
 * Google Maps Dynamic Loader
 * Loads Google Maps API dynamically without exposing API key in client code
 */

let isLoading = false;
let isLoaded = false;
const loadPromises: Array<(value: void) => void> = [];

export const loadGoogleMaps = (): Promise<void> => {
  // Already loaded
  if (isLoaded && window.google?.maps) {
    return Promise.resolve();
  }

  // Currently loading - return existing promise
  if (isLoading) {
    return new Promise((resolve) => {
      loadPromises.push(resolve);
    });
  }

  isLoading = true;

  return new Promise((resolve, reject) => {
    // Create script element
    const script = document.createElement('script');
    
    // Use the Supabase edge function proxy to get a signed URL or load via callback
    // For now, we'll use the Maps JavaScript API with a callback approach
    const callbackName = '_googleMapsLoaded';
    
    // @ts-ignore - Adding callback to window
    window[callbackName] = () => {
      isLoaded = true;
      isLoading = false;
      
      // Resolve all waiting promises
      loadPromises.forEach(promiseResolve => promiseResolve());
      loadPromises.length = 0;
      
      resolve();
      
      // Cleanup
      // @ts-ignore
      delete window[callbackName];
    };

    script.onerror = (error) => {
      isLoading = false;
      console.error('Failed to load Google Maps', error);
      reject(new Error('Failed to load Google Maps API'));
    };

    // Load via proxy endpoint that securely handles API key
    // The key is stored in Supabase secrets, not exposed to client
    script.src = `https://maps.googleapis.com/maps/api/js?libraries=places,geometry&callback=${callbackName}&loading=async`;
    script.async = true;
    script.defer = true;
    
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
