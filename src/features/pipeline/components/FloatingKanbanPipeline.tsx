import React, { useState, useEffect } from 'react';
import { FloatingPipelinePanel } from '@/components/messaging/FloatingPipelinePanel';
import KanbanPipeline from './KanbanPipeline';

interface FloatingKanbanPipelineProps {
  isOpen: boolean;
  onClose: () => void;
}

export const FloatingKanbanPipeline: React.FC<FloatingKanbanPipelineProps> = ({ isOpen, onClose }) => {
  const [isMinimized, setIsMinimized] = useState(false);

  // Load minimized state from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('pipeline-panel-minimized');
    if (saved) {
      setIsMinimized(saved === 'true');
    }
  }, []);

  return (
    <FloatingPipelinePanel
      title="Jobs Pipeline"
      isOpen={isOpen}
      onClose={onClose}
      onMinimize={() => setIsMinimized(!isMinimized)}
      isMinimized={isMinimized}
    >
      <KanbanPipeline />
    </FloatingPipelinePanel>
  );
};
