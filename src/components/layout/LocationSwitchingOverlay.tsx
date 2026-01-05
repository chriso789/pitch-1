import { MapPin, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface LocationSwitchingOverlayProps {
  isVisible: boolean;
  locationName?: string | null;
}

export const LocationSwitchingOverlay = ({ isVisible, locationName }: LocationSwitchingOverlayProps) => {
  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2, delay: 0.05 }}
            className="flex flex-col items-center gap-4 text-center"
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-primary/10">
              <MapPin className="h-8 w-8 text-primary" />
            </div>
            
            <div className="space-y-2">
              <h2 className="text-lg font-semibold text-foreground">
                {locationName ? `Switching to ${locationName}` : 'Viewing all locations...'}
              </h2>
              <p className="text-sm text-muted-foreground">
                Please wait while we load your workspace
              </p>
            </div>
            
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
