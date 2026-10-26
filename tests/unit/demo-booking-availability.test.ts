import { describe, it, expect } from 'vitest';
import { offeredMeetingSlots } from '@/lib/demoBookingAvailability';

describe('Demo booking availability', () => {
  const now = Date.parse('2026-10-26T21:47:00Z');
  it('requires an offered time', () => expect(() => offeredMeetingSlots([], now)).toThrow());
  it('rejects past and invalid times', () => {
    expect(() => offeredMeetingSlots(['2020-01-01T00:00:00Z'], now)).toThrow();
    expect(() => offeredMeetingSlots([''], now)).toThrow();
  });
  it('preserves chosen instants across timezone conversion', () => {
    expect(offeredMeetingSlots(['2026-10-27T10:00:00-04:00'], now)).toEqual(['2026-10-27T14:00:00.000Z']);
  });
  it('does not duplicate the same offered meeting', () => {
    expect(offeredMeetingSlots(['2026-10-27T14:00:00Z', '2026-10-27T10:00:00-04:00'], now)).toHaveLength(1);
  });
});