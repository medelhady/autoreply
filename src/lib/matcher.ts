/**
 * Which rule a customer's message triggers.
 *
 * Ported from Deyara's campaigns.ts, with one change for a menu-style bot: a number such as "1" or
 * "2" is a valid trigger. Numbers match only when they are the whole message, because "2" inside
 * "I want 2 rooms" is not a menu choice. Words keep Deyara's rules: loose spelling, whole words only,
 * one typo forgiven on words of four letters or more, and the longest matching keyword wins.
 *
 * Pure and dependency-free.
 */

/** Short words catch everything, so a word trigger needs at least this many characters. */
export const minimumWordLength = 3;

/**
 * Written the way people actually type: no diacritics, أ/إ/آ all read as ا, ة as ه, ى as ي.
 * Arabic-Indic digits (٠-٩) are read as ordinary digits, since a phone keyboard may produce either.
 */
export function normalizeText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[أإآ]/g, "ا")
    .replace(/[ة]/g, "ه")
    .replace(/[ى]/g, "ي")
    .replace(/[ـًٌٍَُِّْ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const digitsOnly = /^\d+$/;

/** The keywords box as typed (commas, Arabic commas or one per line), read into a clean list. */
export function parseKeywords(raw: string) {
  const seen = new Set<string>();

  for (const part of raw.split(/[,،\n]/)) {
    const keyword = normalizeText(part);

    if (digitsOnly.test(keyword) || keyword.length >= minimumWordLength) {
      seen.add(keyword);
    }
  }

  return Array.from(seen);
}

function editDistance(first: string, second: string) {
  const rows = Array.from({ length: first.length + 1 }, () => Array<number>(second.length + 1).fill(0));

  for (let row = 0; row <= first.length; row += 1) rows[row][0] = row;
  for (let column = 0; column <= second.length; column += 1) rows[0][column] = column;

  for (let row = 1; row <= first.length; row += 1) {
    for (let column = 1; column <= second.length; column += 1) {
      const cost = first[row - 1] === second[column - 1] ? 0 : 1;

      rows[row][column] = Math.min(rows[row - 1][column] + 1, rows[row][column - 1] + 1, rows[row - 1][column - 1] + cost);
    }
  }

  return rows[first.length][second.length];
}

function keywordMatches(words: string[], text: string, keyword: string) {
  // A number is a menu choice: it counts only as the entire message.
  if (digitsOnly.test(keyword)) {
    return text === keyword;
  }

  if (keyword.includes(" ")) {
    return text.includes(keyword);
  }

  return words.some((word) => word === keyword || (keyword.length >= 4 && editDistance(word, keyword) <= 1));
}

/** The rule a message triggers, or nothing. The longest matching keyword wins. */
export function matchRule<T extends { keywords: string[]; active: boolean }>(body: string, rules: T[]): T | undefined {
  const text = normalizeText(body);

  if (!text) {
    return undefined;
  }

  const words = text.split(" ");
  const matches: Array<{ rule: T; length: number }> = [];

  for (const rule of rules) {
    if (!rule.active) {
      continue;
    }

    for (const keyword of rule.keywords) {
      if (keywordMatches(words, text, keyword)) {
        matches.push({ rule, length: keyword.length });
      }
    }
  }

  return matches.sort((first, second) => second.length - first.length)[0]?.rule;
}
