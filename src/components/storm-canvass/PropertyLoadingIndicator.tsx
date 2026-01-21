import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, CheckCircle2, Home } from 'lucide-react';

interface PropertyLoadingIndicatorProps {
  isLoading: boolean;
  loadedCount: number | null;
}

export default function PropertyLoadingIndicator({
  isLoading,
  loadedCount,
}: PropertyLoadingIndicatorProps) {
  const [showSuccess, setShowSuccess] = useState(false);
  const [displayCount, setDisplayCount] = useState<number | null>(null);

  // Handle success state with auto-hide
  useEffect(() => {
    if (!isLoading && loadedCount !== null && loadedCount > 0) {
      setDisplayCount(loadedCount);
      setShowSuccess(true);
      const timer = setTimeout(() => {
        setShowSuccess(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isLoading, loadedCount]);

  // Hide when loading starts again
  useEffect(() => {
    if (isLoading) {
      setShowSuccess(false);
    }
  }, [isLoading]);

  return (
    <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
      <AnimatePresence mode="wait">
        {isLoading && (
          <motion.div
            key="loading"
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-background/90 backdrop-blur-md border border-border shadow-lg"
          >
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-sm font-medium text-foreground">Loading homes...</span>
          </motion.div>
        )}

        {!isLoading && showSuccess && displayCount !== null && (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9, y: -5 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-background/90 backdrop-blur-md border border-success/30 shadow-lg"
          >
            <CheckCircle2 className="h-4 w-4 text-success" />
            <Home className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">{displayCount} properties</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
