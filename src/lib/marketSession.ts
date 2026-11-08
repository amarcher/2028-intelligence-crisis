export interface MarketSession { date: string; open: string; close: string }
export function easternParts(now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minute: Number(get('hour')) * 60 + Number(get('minute')), weekday: get('weekday') };
}
const minutes = (time: string) => { const [h,m] = time.split(':').map(Number); return h * 60 + m; };
export function inSession(now: Date, session: MarketSession | null): boolean {
  const et = easternParts(now);
  return !!session && session.date === et.date && et.minute >= minutes(session.open) && et.minute < minutes(session.close);
}
export function scheduledTick(now: Date, session: MarketSession | null): 'premarket' | 'close' | 'weekly' | null {
  const et = easternParts(now);
  if (!session || session.date !== et.date) return null;
  if (et.weekday === 'Mon' && et.minute === 8 * 60) return 'weekly';
  if (et.minute === minutes(session.open) - 15) return 'premarket';
  if (et.minute === minutes(session.close) + 15) return 'close';
  return null;
}
export function easternDayStart(now: Date): string {
  const { date } = easternParts(now);
  // Determine the offset at local noon, then resolve midnight separately for DST transition days.
  const noon = new Date(`${date}T12:00:00Z`);
  const offset = 12 * 60 - easternParts(noon).minute;
  let midnight = new Date(Date.parse(`${date}T00:00:00Z`) + offset * 60_000);
  const localMinute = easternParts(midnight).minute;
  if (localMinute === 60) midnight = new Date(midnight.getTime() - 3_600_000);
  else if (localMinute === 23 * 60) midnight = new Date(midnight.getTime() + 3_600_000);
  return midnight.toISOString();
}
