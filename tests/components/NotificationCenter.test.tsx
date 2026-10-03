import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationCenter } from '@/components/notifications/NotificationCenter';

const fetchNotifications = vi.fn();

vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => ({
    notifications: [{
      id: 'notification-1',
      user_id: 'user-1',
      type: 'invoice_viewed',
      title: 'Invoice opened',
      message: 'Customer opened invoice INV-001.',
      icon: 'eye',
      metadata: {},
      is_read: false,
      created_at: new Date().toISOString(),
    }],
    unreadCount: 1,
    loading: false,
    fetchNotifications,
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
    dismissNotification: vi.fn(),
    clearAllNotifications: vi.fn(),
  }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
    },
  },
}));

describe('NotificationCenter', () => {
  beforeEach(() => fetchNotifications.mockClear());

  it('renders an icon rather than the saved eye icon name', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <NotificationCenter />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button'));

    expect(await screen.findByText('Invoice opened')).toBeInTheDocument();
    expect(screen.queryByText('eye')).not.toBeInTheDocument();
    expect(document.querySelector('svg.lucide-eye')).toBeInTheDocument();
  });
});