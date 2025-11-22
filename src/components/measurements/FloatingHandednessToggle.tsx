import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface FloatingHandednessToggleProps {
  onPositionChange: (position: 'left' | 'right') => void;
}

export function FloatingHandednessToggle({ onPositionChange }: FloatingHandednessToggleProps) {
  const [position, setPosition] = useState<'left' | 'right'>(() => {
    const stored = localStorage.getItem('toolbar-position');
    return (stored === 'left' || stored === 'right') ? stored : 'left';
  });

  useEffect(() => {
    localStorage.setItem('toolbar-position', position);
    onPositionChange(position);
  }, [position, onPositionChange]);

  const togglePosition = () => {
    setPosition(prev => prev === 'left' ? 'right' : 'left');
  };

  return (
    <Button
      size="icon"
      variant="outline"
      onClick={togglePosition}
      className={`fixed top-20 ${position === 'left' ? 'right-4' : 'left-4'} z-50 h-12 w-12 rounded-full shadow-lg bg-background border-2`}
      title="Switch toolbar position"
    >
      {position === 'left' ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
    </Button>
  );
}
