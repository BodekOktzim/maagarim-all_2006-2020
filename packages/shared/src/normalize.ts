/**
 * Pure, dependency-free normalization + similarity utilities.
 * Used by: packages/search (fuzzy name/address search), packages/entity-resolution
 * (match scoring), packages/synthetic-generator (producing "messy" synthetic variants).
 */

/** Normalize a synthetic phone number to digits-only, dropping country code variants. */
export function normalizePhone(raw: string): string {
  let digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+972")) digits = "0" + digits.slice(4);
  else if (digits.startsWith("972")) digits = "0" + digits.slice(3);
  return digits.replace(/\D/g, "");
}

/** Normalize a name for comparison: lowercase, trim, collapse whitespace, strip trailing dot. */
export function normalizeName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/\s+/g, " ");
}

/** Normalize an address: lowercase, collapse "st./street", collapse whitespace. */
export function normalizeAddress(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\bst\.?\b/g, "street")
    .replace(/\.+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Classic Levenshtein edit distance. O(n*m), fine for name/address-length strings. */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** Similarity score in [0,1], 1 = identical, based on normalized Levenshtein distance. */
export function similarityScore(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return 1;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  const dist = levenshtein(na, nb);
  return Math.max(0, 1 - dist / maxLen);
}
