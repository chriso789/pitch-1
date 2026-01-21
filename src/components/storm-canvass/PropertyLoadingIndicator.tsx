import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, CheckCircle2, Home } from 'lucide-react';

interface PropertyLoadingIndicatorProps {
  state: 'idle' | 'loading' | 'success';
  loadedCount: number | null;
}

export default function PropertyLoadingIndicator({
  state,
  loadedCount,
}: PropertyLoadingIndicatorProps) {
  const showIndicator = state !== 'idle';

  return (
    <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
      <AnimatePresence>
        {showIndicator && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-background/90 backdrop-blur-md border border-border shadow-lg"
          >
            {state === 'loading' ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-primary" style={{ willChange: 'transform' }} />
                <span className="text-sm font-medium text-foreground">Loading homes...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 text-success" />
                <Home className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">{loadedCount} properties</span>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
