/**
 * Checking a week of opening hours before it is saved (the database checks
 * again in admin_save_location_hours). "24:00" closes at midnight.
 */
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Problems keyed "day.<0-6>" (0 = Sunday). Ranges may touch but not overlap. */
export function hoursProblem(ranges: { dayOfWeek: number; opensAt: string; closesAt: string }[]): Record<string, string> {
  const errors: Record<string, string> = {};
  const toMinutes = (t: string) => (t === "24:00" ? 1440 : Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)));
  for (let day = 0; day < 7; day += 1) {
    const list = ranges.filter((r) => r.dayOfWeek === day);
    if (list.length > 6) errors[`day.${day}`] = "Up to 6 ranges a day.";
    for (const r of list) {
      if (!TIME.test(r.opensAt) || !(TIME.test(r.closesAt) || r.closesAt === "24:00")) errors[`day.${day}`] = "Pick an opening and a closing time.";
      else if (toMinutes(r.closesAt) <= toMinutes(r.opensAt)) errors[`day.${day}`] = "Each range must close after it opens (use “midnight” for 12 AM).";
    }
    const sorted = [...list].sort((a, b) => toMinutes(a.opensAt) - toMinutes(b.opensAt));
    for (let i = 1; i < sorted.length; i += 1) {
      if (toMinutes(sorted[i].opensAt) < toMinutes(sorted[i - 1].closesAt)) errors[`day.${day}`] = "Two ranges overlap.";
    }
  }
  return errors;
}

