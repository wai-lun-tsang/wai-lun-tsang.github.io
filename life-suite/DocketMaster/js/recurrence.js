/* DocketMaster — recurrence eligibility logic
   Shared by local recurring task series AND by the FRITH goal-sync eligibility
   check, since FRITH goals use the same three modes (weekday / everyN / dates).
*/

function daysBetween(dateStrA, dateStrB) {
  const a = new Date(dateStrA + "T00:00:00Z");
  const b = new Date(dateStrB + "T00:00:00Z");
  return Math.round((b - a) / 86400000);
}

function weekdayOf(dateStr) {
  return new Date(dateStr + "T00:00:00Z").getUTCDay(); // 0 = Sunday
}

/**
 * rule shape (matches both DocketMaster taskSeries and FRITH goals):
 * {
 *   mode: "weekday" | "everyN" | "dates",
 *   weekday, intervalWeeks,     // mode: weekday
 *   intervalDays,               // mode: everyN
 *   dates: ["YYYY-MM-DD", ...], // mode: dates
 *   startDate, endDate          // required for weekday/everyN, absent for dates
 * }
 */
function isEligibleOnDate(rule, dateStr) {
  if (!rule) return false;

  if (rule.mode === "dates") {
    return Array.isArray(rule.dates) && rule.dates.includes(dateStr);
  }

  if (rule.startDate && dateStr < rule.startDate) return false;
  if (rule.endDate && dateStr > rule.endDate) return false;

  if (rule.mode === "weekday") {
    if (weekdayOf(dateStr) !== rule.weekday) return false;
    const weeksSinceStart = Math.floor(daysBetween(rule.startDate, dateStr) / 7);
    const interval = rule.intervalWeeks || 1;
    return weeksSinceStart % interval === 0;
  }

  if (rule.mode === "everyN") {
    const diff = daysBetween(rule.startDate, dateStr);
    const interval = rule.intervalDays || 1;
    return diff >= 0 && diff % interval === 0;
  }

  return false;
}

/** Returns all eligible dates for a rule within [fromDate, toDate] inclusive. */
function eligibleDatesInRange(rule, fromDate, toDate) {
  const out = [];
  let d = new Date(fromDate + "T00:00:00Z");
  const end = new Date(toDate + "T00:00:00Z");
  while (d <= end) {
    const ds = d.toISOString().slice(0, 10);
    if (isEligibleOnDate(rule, ds)) out.push(ds);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

window.Recurrence = { isEligibleOnDate, eligibleDatesInRange, daysBetween, weekdayOf };
