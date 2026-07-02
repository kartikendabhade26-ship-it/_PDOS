const dstCache = new Map();
const offsetCache = new Map();
const estInfoCache = new Map();

function getOffsetSec(timestamp) {
  const dayKey = Math.floor(timestamp / 86400);
  let cached = offsetCache.get(dayKey);
  if (cached !== undefined) return cached;

  const date = new Date(timestamp * 1000);
  const year = date.getUTCFullYear();
  let dstBounds = dstCache.get(year);
  if (!dstBounds) {
    // DST starts on the second Sunday of March
    const march1 = new Date(Date.UTC(year, 2, 1));
    const dayOfMarch1 = march1.getUTCDay();
    const firstSundayOfMarch = 1 + (7 - dayOfMarch1) % 7;
    const secondSundayOfMarch = firstSundayOfMarch + 7;
    // DST starts at 07:00 UTC (2:00 AM EST)
    const dstStart = Date.UTC(year, 2, secondSundayOfMarch, 7, 0, 0) / 1000;

    // DST ends on the first Sunday of November
    const nov1 = new Date(Date.UTC(year, 10, 1));
    const dayOfNov1 = nov1.getUTCDay();
    const firstSundayOfNov = 1 + (7 - dayOfNov1) % 7;
    // DST ends at 06:00 UTC (2:00 AM EDT / 1:00 AM EST)
    const dstEnd = Date.UTC(year, 10, firstSundayOfNov, 6, 0, 0) / 1000;

    dstBounds = { dstStart, dstEnd };
    dstCache.set(year, dstBounds);
  }
  
  const offset = (timestamp >= dstBounds.dstStart && timestamp < dstBounds.dstEnd)
    ? -4 * 3600 // EDT
    : -5 * 3600; // EST

  offsetCache.set(dayKey, offset);
  return offset;
}

export function getESTInfo(timestamp) {
  let cached = estInfoCache.get(timestamp);
  if (cached) return cached;

  try {
    const offset = getOffsetSec(timestamp);
    const estTime = timestamp + offset;
    
    let secondsSinceMidnight = estTime % 86400;
    if (secondsSinceMidnight < 0) secondsSinceMidnight += 86400;
    
    const hour = Math.floor(secondsSinceMidnight / 3600);
    const minute = Math.floor((secondsSinceMidnight % 3600) / 60);
    
    const daysSinceEpoch = Math.floor(estTime / 86400);
    let day = (daysSinceEpoch + 4) % 7;
    if (day < 0) day += 7;

    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

    // Session definitions (in US Eastern time)
    // London Killzone: 2:00 AM - 5:00 AM
    // NY AM Killzone: 8:30 AM - 12:00 PM
    // NY PM Session: 1:30 PM - 4:00 PM
    let session = null;
    if (hour >= 2 && hour < 5) {
      session = 'london';
    } else if ((hour === 8 && minute >= 30) || (hour > 8 && hour < 12)) {
      session = 'ny-am';
    } else if ((hour === 13 && minute >= 30) || (hour > 13 && hour < 16)) {
      session = 'ny-pm';
    }

    const result = {
      hour,
      minute,
      day,
      timeStr,
      session,
      isMidnightOpen: hour === 0 && minute === 0,
      isNewsOpen: hour === 8 && minute === 30
    };
    estInfoCache.set(timestamp, result);
    return result;
  } catch (err) {
    const fallback = {
      hour: 0,
      minute: 0,
      day: 0,
      timeStr: "00:00",
      session: null,
      isMidnightOpen: false,
      isNewsOpen: false
    };
    estInfoCache.set(timestamp, fallback);
    return fallback;
  }
}
