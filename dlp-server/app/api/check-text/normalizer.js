// ── כלי נירמול טקסט ──

/**
 * מסיר ניקוד עברי (טעמים ונקודות) מהטקסט
 * @param {string} text
 * @returns {string}
 */
export function removeHebrewDiacritics(text) {
  // טווח Unicode לניקוד עברי: U+0591–U+05C7
  return text.replace(/[\u0591-\u05C7]/g, "");
}

/**
 * מסיר תווים בלתי נראים (Zero Width, BOM וכדומה)
 * @param {string} text
 * @returns {string}
 */
export function removeInvisibleChars(text) {
  return text.replace(/[\u200B-\u200D\uFEFF\u00AD\u2028\u2029]/g, "");
}

/**
 * מנרמל רווחים מרובים לרווח בודד
 * @param {string} text
 * @returns {string}
 */
export function normalizeWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * נירמול מלא של טקסט: הסרת ניקוד, תווים בלתי נראים, ונירמול רווחים
 * @param {string} text
 * @returns {string}
 */
export function normalize(text) {
  return normalizeWhitespace(
    removeInvisibleChars(
      removeHebrewDiacritics(text)
    )
  ).toLowerCase();
}
