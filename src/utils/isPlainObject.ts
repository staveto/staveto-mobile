/** Plain object (not null, not array). Safe for `Object.entries` on unknown user/API data. */
export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
