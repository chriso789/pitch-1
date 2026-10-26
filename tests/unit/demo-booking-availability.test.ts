import { describe, it, expect } from 'vitest';
import { offeredMeetingSlots, meetingSlotsFromRanges } from '@/lib/demoBookingAvailability';

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

describe('Calendar availability ranges', () => {
  const now = new Date(2026, 9, 26, 8).getTime();
  const window = { from: new Date(2026, 9, 27), to: new Date(2026, 9, 29), startTime: '09:00', endTime: '11:00' };
  it('offers every complete half-hour meeting on all three selected dates', () => {
    const slots = meetingSlotsFromRanges([window], now);
    expect(slots).toHaveLength(12);
    expect(slots[0]).toBe(new Date(2026, 9, 27, 9).toISOString());
    expect(slots[11]).toBe(new Date(2026, 9, 29, 10, 30).toISOString());
  });
  it('never lets a meeting extend beyond the daily end time', () => {
    expect(meetingSlotsFromRanges([{ ...window, to: window.from, endTime: '09:45' }], now))
      .toEqual([new Date(2026, 9, 27, 9).toISOString()]);
  });
  it('merges overlapping date ranges without duplicate appointments', () => {
    expect(meetingSlotsFromRanges([window, window], now)).toHaveLength(12);
  });
  it('rejects missing dates and reversed date or time windows', () => {
    expect(() => meetingSlotsFromRanges([{ ...window, to: undefined }], now)).toThrow();
    expect(() => meetingSlotsFromRanges([{ ...window, to: new Date(2026, 9, 26) }], now)).toThrow();
    expect(() => meetingSlotsFromRanges([{ ...window, endTime: '08:00' }], now)).toThrow();
  });
  it('excludes elapsed times rather than rejecting the whole range', () => {
    expect(meetingSlotsFromRanges([{ ...window, to: window.from }], new Date(2026, 9, 27, 9, 30).getTime()))
      .toEqual([new Date(2026, 9, 27, 10).toISOString(), new Date(2026, 9, 27, 10, 30).toISOString()]);
  });
  it('enforces the existing 500-slot invitation limit', () => {
    expect(() => meetingSlotsFromRanges([{ ...window, to: new Date(2026, 11, 1), endTime: '17:00' }], now)).toThrow('500');
  });
  it('preserves daily local hours across daylight-saving changes', () => {
    const slots = meetingSlotsFromRanges([{ from: new Date(2026, 9, 31), to: new Date(2026, 10, 2), startTime: '09:00', endTime: '09:30' }], now);
    expect(slots).toHaveLength(3);
    expect(slots.map(slot => new Date(slot).getHours())).toEqual([9, 9, 9]);
    expect(slots[2]).toBe(new Date(2026, 10, 2, 9).toISOString());
  });
});