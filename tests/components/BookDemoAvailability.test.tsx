import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import BookDemo from '@/pages/BookDemo';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke } } }));
vi.mock('@/components/ui/calendar', () => ({ Calendar: ({ onSelect }: { onSelect: (date: Date) => void }) =>
  <button onClick={() => onSelect(new Date('2026-11-03T14:00:00Z'))}>Choose test date</button> }));
const slot = '2026-11-03T14:00:00.000Z';
const info = { id: 'invite-a', first_name: 'Test', email: 'test@example.test', confirmed_slot: null };
const available = (slots: string[]) => ({ data: { info, slots }, error: null });
const mount = () => render(<MemoryRouter initialEntries={['/book-demo/test-invitation-token']}>
  <Routes><Route path="/book-demo/:token" element={<BookDemo />} /></Routes>
</MemoryRouter>);
async function settle() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }
async function selectTime() {
  fireEvent.click(screen.getByText('Choose test date'));
  const buttons = screen.getAllByRole('button');
  const time = buttons.find(button => button.textContent?.match(/\d+:\d+ [AP]M/));
  if (!time) throw new Error('Meeting time not displayed');
  fireEvent.click(time);
}
describe('Shared booking availability', () => {
  beforeEach(() => { vi.useFakeTimers(); invoke.mockReset(); });
  afterEach(() => { vi.useRealTimers(); });
  it('removes a time booked through another invitation on the 15-second refresh and disables stale confirmation', async () => {
    invoke.mockResolvedValueOnce(available([slot])).mockResolvedValue(available([]));
    mount(); await settle(); await selectTime();
    expect(screen.getByRole('button', { name: 'Confirm Video Meeting' })).toBeEnabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.getByRole('button', { name: 'Confirm Video Meeting' })).toBeDisabled();
    expect(invoke).toHaveBeenCalledTimes(2);
  });
  it('refreshes available times when the recipient returns to the browser tab', async () => {
    invoke.mockResolvedValueOnce(available([slot])).mockResolvedValue(available([]));
    mount(); await settle(); await selectTime();
    fireEvent(window, new Event('focus')); await settle();
    expect(screen.getByRole('button', { name: 'Confirm Video Meeting' })).toBeDisabled();
  });
  it('a rejected simultaneous booking refreshes availability instead of allowing stale retries', async () => {
    invoke.mockImplementation(async (_name, options) => options.body.action === 'confirm'
      ? { data: null, error: new Error('Slot taken') } : available(invoke.mock.calls.length === 1 ? [slot] : []));
    mount(); await settle(); await selectTime();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Video Meeting' })); await settle();
    expect(invoke.mock.calls.map(call => call[1].body.action)).toEqual(['read', 'confirm', 'read']);
    expect(screen.getByRole('button', { name: 'Confirm Video Meeting' })).toBeDisabled();
  });
});