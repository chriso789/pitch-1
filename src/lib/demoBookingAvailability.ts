export function offeredMeetingSlots(times: string[], now = Date.now()): string[] {
  if (!times.length) throw new Error('Choose at least one meeting time.');
  const dates = times.map(t => new Date(t));
  if (dates.some(d => !Number.isFinite(d.getTime()) || d.getTime() <= now)) {
    throw new Error('Choose a future date and time for every meeting.');
  }
  return [...new Set(dates.map(d => d.toISOString()))].sort();
}