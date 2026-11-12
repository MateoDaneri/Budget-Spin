/**
 * Deterministic merchant key for automatic categorisation of imported movements.
 *
 * Purchases at the same merchant often differ only in a trailing branch/store
 * number, a terminal/reference id, or a location word placed after such an id
 * (e.g. "MERCADO DE PRUEBA 9" vs "MERCADO DE PRUEBA 12", or
 * "COMERCIO DE PRUEBA*TEST*00 ABCDE"). The key removes exactly those trailing
 * parts and nothing else, so two descriptions share a key only when their
 * leading words are identical. No fuzzy matching, no place-name lists.
 *
 * Steps:
 *  1. Cap the input (descriptions come from e-mail, i.e. untrusted), NFKC,
 *     lower-case.
 *  2. Split into word tokens (letters, combining marks, digits). Punctuation,
 *     "*" separators and whitespace runs only delimit tokens.
 *  3. If there are at least 3 tokens and the last one has no digit while the one
 *     before it has a digit, drop that last token: a single word after an id is
 *     structurally a location suffix ("... 00 ABCDE").
 *  4. Drop trailing tokens that contain a digit (store numbers, refs, ids).
 *  5. Too generic (fewer than 3 characters or no letter) -> null: no
 *     merchant-level lookup for this description.
 *
 * All patterns are single character classes (linear time).
 */
const MAX_INPUT_LENGTH = 256;
const TOKEN = /[\p{L}\p{M}\p{N}]+/gu;
const HAS_DIGIT = /\p{N}/u;
const HAS_LETTER = /\p{L}/u;

export function merchantKey(description: string): string | null {
  const text = description
    .slice(0, MAX_INPUT_LENGTH)
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFKC")
    .slice(0, MAX_INPUT_LENGTH);
  const tokens: string[] = text.match(TOKEN) ?? [];
  const last = tokens.at(-1);
  const beforeLast = tokens.at(-2);
  if (tokens.length >= 3 && last !== undefined && beforeLast !== undefined && !HAS_DIGIT.test(last) && HAS_DIGIT.test(beforeLast)) {
    tokens.pop();
  }
  while (tokens.length > 0 && HAS_DIGIT.test(tokens[tokens.length - 1])) tokens.pop();
  const key = tokens.join(" ");
  if (key.length < 3 || !HAS_LETTER.test(key)) return null;
  return key;
}
