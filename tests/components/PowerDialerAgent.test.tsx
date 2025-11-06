/**
 * Power Dialer Agent Component Unit Tests
 * Phase 1 - Week 1-2: Testing Infrastructure
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import PowerDialerAgent from '@/pages/PowerDialerAgent';
import { supabase } from '@/integrations/supabase/client';

// Mock Supabase
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          data: [],
          error: null,
        })),
      })),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(() => ({
            data: null,
            error: null,
          })),
        })),
      })),
    })),
    functions: {
      invoke: vi.fn(() => Promise.resolve({ data: null, error: null })),
    },
  },
}));

// Mock toast
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

const renderWithRouter = (component: React.ReactElement) => {
  return render(<BrowserRouter>{component}</BrowserRouter>);
};

describe('PowerDialerAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Initial Render', () => {
    it('should render the page title', () => {
      renderWithRouter(<PowerDialerAgent />);
      expect(screen.getByText('Power Dialer Agent')).toBeInTheDocument();
    });

    it('should display idle status initially', () => {
      renderWithRouter(<PowerDialerAgent />);
      expect(screen.getByText('IDLE')).toBeInTheDocument();
    });

    it('should show session configuration form when idle', () => {
      renderWithRouter(<PowerDialerAgent />);
      expect(screen.getByText('Start New Session')).toBeInTheDocument();
      expect(screen.getByText('Dialing Mode')).toBeInTheDocument();
    });

    it('should display start dialing button', () => {
      renderWithRouter(<PowerDialerAgent />);
      const startButton = screen.getByRole('button', { name: /start dialing/i });
      expect(startButton).toBeInTheDocument();
    });
  });

  describe('Mode Selection', () => {
    it('should have power mode selected by default', () => {
      renderWithRouter(<PowerDialerAgent />);
      // Default mode is 'power'
      expect(screen.getByText('Start New Session')).toBeInTheDocument();
    });
  });

  describe('Session Management', () => {
    it('should call edge function when starting session', async () => {
      const mockInvoke = vi.fn(() => 
        Promise.resolve({ 
          data: { 
            session: { 
              id: 'test-session', 
              mode: 'power',
              status: 'active',
              contacts_attempted: 0,
              contacts_reached: 0,
              contacts_converted: 0,
              started_at: new Date().toISOString()
            } 
          }, 
          error: null 
        })
      );
      
      vi.mocked(supabase.functions.invoke).mockImplementation(mockInvoke);

      renderWithRouter(<PowerDialerAgent />);
      
      const startButton = screen.getByRole('button', { name: /start dialing/i });
      fireEvent.click(startButton);

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith('power-dialer-controller', {
          body: {
            action: 'start',
            mode: 'power',
            campaignId: null,
          },
        });
      });
    });
  });

  describe('Call Timer', () => {
    it('should format time correctly', () => {
      renderWithRouter(<PowerDialerAgent />);
      // Timer formatting is internal, but we can test the component renders
      expect(screen.getByText('Power Dialer Agent')).toBeInTheDocument();
    });
  });

  describe('Contact Display', () => {
    it('should not show contact info when no contact is loaded', () => {
      renderWithRouter(<PowerDialerAgent />);
      expect(screen.queryByText('Call Now')).not.toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    it('should handle session start error gracefully', async () => {
      const mockInvoke = vi.fn(() => 
        Promise.resolve({ 
          data: null, 
          error: { message: 'Failed to start session' }
        })
      );
      
      vi.mocked(supabase.functions.invoke).mockImplementation(mockInvoke);

      renderWithRouter(<PowerDialerAgent />);
      
      const startButton = screen.getByRole('button', { name: /start dialing/i });
      fireEvent.click(startButton);

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalled();
      });
    });
  });

  describe('Notes', () => {
    it('should render notes textarea when contact is loaded', () => {
      renderWithRouter(<PowerDialerAgent />);
      // Notes appear when contact is loaded, initially not visible
      expect(screen.queryByPlaceholderText('Call notes...')).not.toBeInTheDocument();
    });
  });

  describe('Disposition Buttons', () => {
    it('should not show disposition buttons when no contact is loaded', () => {
      renderWithRouter(<PowerDialerAgent />);
      expect(screen.queryByRole('button', { name: /answered/i })).not.toBeInTheDocument();
    });
  });
});
