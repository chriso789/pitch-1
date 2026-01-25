import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, CheckCircle2, Home } from 'lucide-react';
import { useDeviceLayout } from '@/hooks/useDeviceLayout';

interface PropertyLoadingIndicatorProps {
  state: 'idle' | 'loading' | 'success';
  loadedCount: number | null;
}

export default function PropertyLoadingIndicator({
  state,
  loadedCount,
}: PropertyLoadingIndicatorProps) {
  const showIndicator = state !== 'idle';
  const layout = useDeviceLayout();

  return (
    <div 
      className="absolute left-1/2 -translate-x-1/2 z-40 pointer-events-none"
      style={{ bottom: layout.loadingIndicatorBottom }}
    >
      <AnimatePresence mode="wait">
        {showIndicator && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ 
              duration: 0.3, 
              ease: [0.4, 0, 0.2, 1],
            }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-background/90 backdrop-blur-md border border-border shadow-lg"
            style={{ willChange: 'transform, opacity' }}
          >
            <AnimatePresence mode="wait">
              {state === 'loading' ? (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="flex items-center gap-2"
                >
                  <Loader2 className="h-4 w-4 animate-spin text-primary" style={{ willChange: 'transform' }} />
                  <span className="text-sm font-medium text-foreground">Loading homes...</span>
                </motion.div>
              ) : (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                  className="flex items-center gap-2"
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.1, type: 'spring', stiffness: 400, damping: 15 }}
                  >
                    <CheckCircle2 className="h-4 w-4 text-success" />
                  </motion.div>
                  <Home className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">{loadedCount} properties</span>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
