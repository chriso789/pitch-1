import React from 'react';
import { Navigate } from 'react-router-dom';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { useHasTrainingAccess } from '@/hooks/useHasTrainingAccess';

/**
 * Image Trainer route guard. Access is verified server-side through the
 * `has_training_access` database function — never from client storage.
 * Database RLS on the trainer tables remains the real enforcement.
 */
const TrainingGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { data: allowed, isLoading } = useHasTrainingAccess('reviewer');

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }
  if (!allowed) return <Navigate to="/photo-intelligence" replace />;
  return <>{children}</>;
};

export const TrainingRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ProtectedRoute>
    <TrainingGuard>{children}</TrainingGuard>
  </ProtectedRoute>
);
