// ── מנוע ה-Redaction המרכזי ──

/**
 * מבצע redaction על טקסט לפי תבניות ומילות מפתח.
 *
 * @param {string} text         - הטקסט המקורי
 * @param {Array}  patterns     - מערך תבניות מ-patterns.js
 * @param {Array}  keywords     - מערך מילות מפתח מ-patterns.js
 * @returns {{ redactedText: string, replacements: Array, mapping: Object }}
 */
export function redact(text, patterns, keywords) {
  let redactedText = text;
  const replacements = [];
  const mapping = {};
  const counters = {};
  // Set לעקוב אחרי ערכים מקוריים שכבר עובדו (מניעת כפילויות)
  const processedOriginals = new Set();

  // ── שלב 1: זיהוי לפי תבניות Regex ──
  patterns.forEach(({ id, regex, label, validate }) => {
    // יצירת עותק חדש של ה-regex כדי לאפס את lastIndex
    const re = new RegExp(regex.source, regex.flags);
    const matches = [...text.matchAll(re)];

    matches.forEach(match => {
      const original = match[0];

      // אם קיימת פונקציית אימות, בודקים את התוצאה לפניה
      if (validate && !validate(original)) return;

      // מניעת כפילויות – אם כבר עובד הטקסט הזה, דילוג
      if (processedOriginals.has(original)) return;

      if (!counters[id]) counters[id] = 1;
      const placeholder = `[${id}_${counters[id]++}]`;

      // החלפה בטקסט המצונזר (החלפה ראשונה בלבד לכל מופע ייחודי)
      redactedText = redactedText.split(original).join(placeholder);
      replacements.push({ original, placeholder, label, category: id });
      mapping[placeholder] = original;
      processedOriginals.add(original);
    });
  });

  // ── שלב 2: זיהוי לפי מילות מפתח ──
  keywords.forEach(({ keyword, category, label }) => {
    const re = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const matches = [...text.matchAll(re)];

    matches.forEach(match => {
      const original = match[0];

      // מניעת כפילויות
      if (processedOriginals.has(original)) return;

      if (!counters[category]) counters[category] = 1;
      const placeholder = `[${category}_${counters[category]++}]`;

      redactedText = redactedText.split(original).join(placeholder);
      replacements.push({ original, placeholder, label, category });
      mapping[placeholder] = original;
      processedOriginals.add(original);
    });
  });

  return { redactedText, replacements, mapping };
}
