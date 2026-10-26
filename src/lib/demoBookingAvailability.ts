export function offeredMeetingSlots(times: string[], now = Date.now()): string[] {
  if (!times.length) throw new Error('Choose at least one meeting time.');
  const dates = times.map(t => new Date(t));
  if (dates.some(d => !Number.isFinite(d.getTime()) || d.getTime() <= now)) {
    throw new Error('Choose a future date and time for every meeting.');
  }
  return [...new Set(dates.map(d => d.toISOString()))].sort();
}

export type AvailabilityWindow = {
  from?: Date;
  to?: Date;
  startTime: string;
  endTime: string;
};

export function meetingSlotsFromRanges(windows: AvailabilityWindow[], now = Date.now()): string[] {
  if (!windows.length) throw new Error('Choose at least one availability range.');
  const slots = new Set<string>();
  const minutes = (time: string) => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Choose a valid start and end time.');
    const [hours, mins] = time.split(':').map(Number);
    return hours * 60 + mins;
  };
  for (const window of windows) {
    const { from, to } = window;
    if (!from || !to || !Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
      throw new Error('Choose a start and end date for every range.');
    }
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    const last = new Date(to.getFullYear(), to.getMonth(), to.getDate());
    if (last < day) throw new Error('End date must be on or after start date.');
    const start = minutes(window.startTime);
    const end = minutes(window.endTime);
    if (end - start < 30) throw new Error('Each daily window must allow at least one 30-minute meeting.');
    let days = 0;
    for (; day <= last; day.setDate(day.getDate() + 1)) {
      if (++days > 500) throw new Error('Choose a shorter date range.');
      for (let minute = start; minute + 30 <= end; minute += 30) {
        const instant = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minute / 60), minute % 60);
        // Skip nonexistent local times during the daylight-saving spring transition.
        if (instant.getHours() !== Math.floor(minute / 60) || instant.getMinutes() !== minute % 60) continue;
        if (instant.getTime() <= now) continue;
        const finish = new Date(instant.getTime() + 30 * 60_000);
        if (finish.getDate() !== day.getDate() || finish.getHours() * 60 + finish.getMinutes() > end) continue;
        slots.add(instant.toISOString());
        if (slots.size > 500) throw new Error('Availability exceeds 500 meeting times. Choose a shorter range or time window.');
      }
    }
  }
  if (!slots.size) throw new Error('Choose a range with future meeting times.');
  return [...slots].sort();
}