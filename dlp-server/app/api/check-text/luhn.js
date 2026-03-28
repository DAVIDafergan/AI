// ── אלגוריתם לון (Luhn) לאימות כרטיסי אשראי ──

/**
 * מאמת מספר כרטיס אשראי באמצעות אלגוריתם לון
 * @param {string} input - מחרוזת המכילה את המספר (עם או בלי רווחים/מקפים)
 * @returns {boolean} - true אם המספר תקין לפי לון
 */
export function isValidLuhn(input) {
  // הסרת כל תו שאינו ספרה
  const digits = input.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let shouldDouble = false;

  // עיבוד הספרות מימין לשמאל
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits[i], 10);

    if (shouldDouble) {
      digit *= 2;
      // אם התוצאה גדולה מ-9, מחסירים 9
      if (digit > 9) digit -= 9;
    }

    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

// ── אימות תעודת זהות ישראלית ──

/**
 * מאמת תעודת זהות ישראלית לפי אלגוריתם המשקולות [1,2,1,2,1,2,1,2,1]
 * @param {string} input - מחרוזת של 9 ספרות
 * @returns {boolean} - true אם תעודת הזהות תקינה
 */
export function isValidIsraeliID(input) {
  const digits = input.replace(/\D/g, "");
  if (digits.length !== 9) return false;

  const weights = [1, 2, 1, 2, 1, 2, 1, 2, 1];
  let sum = 0;

  for (let i = 0; i < 9; i++) {
    let val = parseInt(digits[i], 10) * weights[i];
    // אם המכפלה גדולה מ-9, מחברים את ספרותיה
    if (val > 9) val = Math.floor(val / 10) + (val % 10);
    sum += val;
  }

  return sum % 10 === 0;
}
