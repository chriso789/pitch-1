import React, { createContext, useContext, ReactNode } from 'react';
import { useLRUImageCache } from '@/hooks/useLRUImageCache';

interface ImageCacheContextType {
  getImage: (url: string) => any | null;
  setImage: (url: string, image: any) => void;
  clearCache: () => void;
  removeImage: (url: string) => void;
  getCacheStats: () => any;
}

const ImageCacheContext = createContext<ImageCacheContextType | undefined>(undefined);

export function ImageCacheProvider({ children }: { children: ReactNode }) {
  const imageCache = useLRUImageCache({ maxSize: 10 });

  return (
    <ImageCacheContext.Provider value={imageCache}>
      {children}
    </ImageCacheContext.Provider>
  );
}

export function useImageCache() {
  const context = useContext(ImageCacheContext);
  if (!context) {
    throw new Error('useImageCache must be used within ImageCacheProvider');
  }
  return context;
}
