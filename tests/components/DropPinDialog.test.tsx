import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DropPinDialog from '../../src/components/storm-canvass/DropPinDialog';
const mocks = vi.hoisted(() => ({ edgeApi: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/edgeApi', () => ({ edgeApi: mocks.edgeApi }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));
describe('Drop Pin saving', () => {
  beforeEach(() => vi.clearAllMocks());
  it('saves into the selected company and refreshes after committed property confirmation', async () => {
    mocks.edgeApi.mockResolvedValue({ data: { success: true, property: { id: 'saved-pin' } }, error: null });
    const onSuccess = vi.fn(); const onOpenChange = vi.fn();
    render(<DropPinDialog open onOpenChange={onOpenChange} lat={28.538336} lng={-81.379234} tenantId="selected-company" onSuccess={onSuccess} />);
    fireEvent.click(screen.getByRole('button', { name: 'Drop Pin' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    expect(mocks.edgeApi).toHaveBeenCalledWith('canvass-api', '/pin/drop', { lat: 28.538336, lng: -81.379234, run_enrichment: true }, { headers: { 'x-pitch-tenant': 'selected-company' } });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
  it('keeps the pin available to retry without a committed property', async () => {
    mocks.edgeApi.mockResolvedValue({ data: { success: true }, error: null });
    const onSuccess = vi.fn(); const onOpenChange = vi.fn();
    render(<DropPinDialog open onOpenChange={onOpenChange} lat={28.538336} lng={-81.379234} tenantId="selected-company" onSuccess={onSuccess} />);
    fireEvent.click(screen.getByRole('button', { name: 'Drop Pin' }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledOnce());
    expect(onSuccess).not.toHaveBeenCalled(); expect(onOpenChange).not.toHaveBeenCalled(); expect(mocks.success).not.toHaveBeenCalled();
  });
});
