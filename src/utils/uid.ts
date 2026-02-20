/**
 * uid — lightweight unique ID generator.
 *
 * Combines the current timestamp (base-36) with a short random suffix to
 * produce collision-resistant IDs suitable for session and message keys.
 * Not cryptographically secure — use only for local UI state identifiers.
 *
 * @returns A short alphanumeric string, e.g. "lf3kz8a2m7"
 *
 * @example
 * const id = uid(); // "lf3kz8a2m7"
 */
export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
