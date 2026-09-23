/**
 * Menu search matching.
 *
 * Folds case, accents and the Hawaiian ʻokina so "lilikoi" finds "Lilikoʻi"
 * and "frappe" finds "Frappé" -- customers type on phones without Hawaiian
 * keyboards.
 */
export function normalizeForSearch(text: string): string {
  return (
    text
      .normalize("NFD")
      // Combining marks: kahakō (macron) and other accents.
      .replace(/[̀-ͯ]/g, "")
      // ʻokina and the apostrophes people type in its place.
      .replace(/[ʻ‘’'`]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** True when every word of the query appears in the name or description. */
export function matchesSearch(query: string, fields: readonly (string | null | undefined)[]): boolean {
  const words = normalizeForSearch(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalizeForSearch(fields.filter(Boolean).join(" "));
  return words.every((word) => haystack.includes(word));
}
