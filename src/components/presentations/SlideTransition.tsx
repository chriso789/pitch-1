import { motion, AnimatePresence } from "framer-motion";
import { ReactNode } from "react";

interface SlideTransitionProps {
  children: ReactNode;
  slideId: string;
  transitionType?: "fade" | "slide" | "zoom";
}

export const SlideTransition = ({ children, slideId, transitionType = "fade" }: SlideTransitionProps) => {
  const variants = {
    fade: {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
    },
    slide: {
      initial: { x: 300, opacity: 0 },
      animate: { x: 0, opacity: 1 },
      exit: { x: -300, opacity: 0 },
    },
    zoom: {
      initial: { scale: 0.8, opacity: 0 },
      animate: { scale: 1, opacity: 1 },
      exit: { scale: 1.2, opacity: 0 },
    },
  };

  const transition = {
    duration: 0.3,
    ease: [0.4, 0, 0.2, 1] as [number, number, number, number],
  };

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={slideId}
        initial={variants[transitionType].initial}
        animate={variants[transitionType].animate}
        exit={variants[transitionType].exit}
        transition={transition}
        className="w-full h-full"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
};
