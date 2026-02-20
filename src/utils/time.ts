/**
 * time — date/time helper utilities.
 *
 * Provides week boundary calculations used for rolling weekly token-usage
 * windows. The week is ISO-8601-aligned (Monday = day 1).
 */

/**
 * Returns the Unix timestamp (ms) of the most recent Monday at 00:00:00 local time.
 *
 * Used to determine whether a stored weekly-usage figure is still current or
 * should be reset at the start of a new week.
 *
 * @returns Unix timestamp (ms) of Monday 00:00:00 in the local timezone.
 *
 * @example
 * const weekStart = getWeekStart(); // e.g. 1708300800000
 */
export function getWeekStart(): number {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now.getFullYear(), now.getMonth(), diff, 0, 0, 0, 0);
  return monday.getTime();
}
