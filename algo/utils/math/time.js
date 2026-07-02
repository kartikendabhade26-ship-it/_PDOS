/**
 * algo/utils/math/time.js
 * EST conversion helpers.
 */

const dstTransitionsCache = new Map(); // year -> { startEpoch, endEpoch }

function getESTOffset(unixTs) {
  const date = new Date(unixTs * 1000);
  const year = date.getUTCFullYear();
  
  let transition = dstTransitionsCache.get(year);
  if (!transition) {
    // March DST starts: second Sunday in March at 2:00 AM EST (7:00 UTC)
    let marchSundayCount = 0;
    let marchDstDate = 1;
    for (let d = 1; d <= 14; d++) {
      const dayOfWeek = new Date(Date.UTC(year, 2, d, 7, 0, 0)).getUTCDay();
      if (dayOfWeek === 0) {
        marchSundayCount++;
        if (marchSundayCount === 2) {
          marchDstDate = d;
          break;
        }
      }
    }
    const startEpoch = Date.UTC(year, 2, marchDstDate, 7, 0, 0) / 1000;

    // November DST ends: first Sunday in November at 2:00 AM EDT (6:00 UTC)
    let novDstDate = 1;
    for (let d = 1; d <= 7; d++) {
      const dayOfWeek = new Date(Date.UTC(year, 10, d, 6, 0, 0)).getUTCDay();
      if (dayOfWeek === 0) {
        novDstDate = d;
        break;
      }
    }
    const endEpoch = Date.UTC(year, 10, novDstDate, 6, 0, 0) / 1000;
    
    transition = { startEpoch, endEpoch };
    dstTransitionsCache.set(year, transition);
  }

  // EDT is between startEpoch and endEpoch
  if (unixTs >= transition.startEpoch && unixTs < transition.endEpoch) {
    return -4 * 3600; // EDT (UTC-4)
  }
  return -5 * 3600; // EST (UTC-5)
}

function getESTDateTime(unixTs) {
  const offset = getESTOffset(unixTs);
  const d = new Date((unixTs + offset) * 1000);
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  const day = d.getUTCDate();
  const month = d.getUTCMonth() + 1;
  const year = d.getUTCFullYear();
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { hour, minute, dateStr, year, month, day, offset };
}

module.exports = {
  getESTOffset,
  getESTDateTime
};
