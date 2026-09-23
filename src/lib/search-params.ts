/** Page `searchParams` as Next passes them: a value can repeat, so it may be an array. */
export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** The first value of a query parameter, or undefined. */
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
