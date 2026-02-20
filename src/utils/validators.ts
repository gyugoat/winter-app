import type { Session } from '../types';

/**
 * Validates that `data` is a well-formed `Session[]`.
 *
 * Called after reading sessions from the Tauri Store to guard against corrupt
 * or missing persisted state. Checks both the array shape and required scalar
 * fields on each session object.
 *
 * @param data - Unknown value read from persistent storage.
 * @returns `true` if `data` is a `Session[]` with all required fields present.
 */
export function isValidSessions(data: unknown): data is Session[] {
  if (!Array.isArray(data)) return false;
  return data.every(
    (s) =>
      typeof s === 'object' &&
      s !== null &&
      typeof (s as Session).id === 'string' &&
      typeof (s as Session).name === 'string' &&
      Array.isArray((s as Session).messages) &&
      typeof (s as Session).createdAt === 'number'
  );
}
