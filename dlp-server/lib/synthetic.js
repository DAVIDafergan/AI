// מחולל נתונים סינתטיים ריאליסטיים – מחליף PII אמיתי ב"פייק" שנראה אמיתי
// המטרה: ה-AI לא יבחין שבוצעה הגנה

// ── עזרים כלליים ──
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randDigits(n) {
  return Array.from({ length: n }, () => randInt(0, 9)).join("");
}
function randItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── טלפון נייד ישראלי ──
const MOBILE_PREFIXES = ["050", "051", "052", "053", "054", "055", "056", "058"];
export function generatePhone() {
  const prefix = randItem(MOBILE_PREFIXES);
  return `${prefix}-${randDigits(3)}-${randDigits(4)}`;
}

// ── טלפון נייח ישראלי ──
const AREA_CODES = ["02", "03", "04", "08", "09"];
export function generateLandline() {
  const area = randItem(AREA_CODES);
  return `${area}-${randDigits(3)}-${randDigits(4)}`;
}

// ── תעודת זהות ישראלית (9 ספרות, מתחיל ב-3) ──
export function generateIsraeliId() {
  // אלגוריתם Luhn משונה לת"ז ישראלית
  const digits = [3, ...Array.from({ length: 7 }, () => randInt(0, 9))];
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    let v = digits[i] * (i % 2 === 0 ? 1 : 2);
    if (v > 9) v -= 9;
    sum += v;
  }
  const check = (10 - (sum % 10)) % 10;
  digits.push(check);
  return digits.join("");
}

// ── כתובת אימייל ──
const EMAIL_DOMAINS = ["gmail.com", "yahoo.com", "outlook.com", "walla.co.il", "bezeq.net"];
export function generateEmail() {
  return `user_${randDigits(3)}@${randItem(EMAIL_DOMAINS)}`;
}

// ── כרטיס אשראי (Luhn valid, Visa) ──
export function generateCreditCard() {
  const prefix = [4, ...Array.from({ length: 14 }, () => randInt(0, 9))];
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let v = prefix[i] * (i % 2 === 0 ? 2 : 1);
    if (v > 9) v -= 9;
    sum += v;
  }
  const check = (10 - (sum % 10)) % 10;
  prefix.push(check);
  const n = prefix.join("");
  return `${n.slice(0, 4)} ${n.slice(4, 8)} ${n.slice(8, 12)} ${n.slice(12, 16)}`;
}

// ── IBAN ישראלי ──
export function generateIBAN() {
  const bank = randDigits(4);
  const branch = randDigits(4);
  const account = randDigits(13);
  return `IL${randDigits(2)} ${bank} ${branch} ${account.slice(0, 4)} ${account.slice(4, 8)} ${account.slice(8)}`;
}

// ── כתובת IP פרטית ──
export function generateIP() {
  const type = randInt(0, 1);
  if (type === 0) return `192.168.${randInt(0, 255)}.${randInt(1, 254)}`;
  return `10.${randInt(0, 255)}.${randInt(0, 255)}.${randInt(1, 254)}`;
}

// ── שם עברי ריאליסטי ──
const MALE_FIRST = ["דוד", "יוסף", "משה", "אברהם", "יצחק", "יעקב", "אלי", "רון", "גיל", "אורי", "נתן", "עידו", "תומר", "שי", "אמיר"];
const FEMALE_FIRST = ["שרה", "רחל", "מרים", "לאה", "דינה", "רות", "נועה", "מיה", "שירה", "אורית", "ליאת", "טל", "מור", "ענת", "אביגיל"];
const LAST_NAMES = ["כהן", "לוי", "מזרחי", "פרץ", "ביטון", "אברהם", "פרידמן", "שפירא", "רוזנברג", "גולדברג", "שטיין", "בן-דוד", "אוחיון", "סבג", "בנימין"];

export function generateName(gender) {
  const first = gender === "female"
    ? randItem(FEMALE_FIRST)
    : gender === "male"
    ? randItem(MALE_FIRST)
    : randItem([...MALE_FIRST, ...FEMALE_FIRST]);
  return `${first} ${randItem(LAST_NAMES)}`;
}

// ── כתובת ישראלית ──
const STREETS = ["רחוב הרצל", "שדרות בן גוריון", "רחוב ויצמן", "רחוב ירושלים", "שדרות רוטשילד", "רחוב דיזנגוף", "רחוב אלנבי", "רחוב אחד העם"];
const CITIES = ["תל אביב", "ירושלים", "חיפה", "באר שבע", "ראשון לציון", "פתח תקווה", "נתניה", "אשדוד"];
export function generateAddress() {
  return `${randItem(STREETS)} ${randInt(1, 150)}, ${randItem(CITIES)}`;
}

// ── תאריך לידה ──
export function generateDate() {
  const d = String(randInt(1, 28)).padStart(2, "0");
  const m = String(randInt(1, 12)).padStart(2, "0");
  const y = randInt(1960, 2000);
  return `${d}/${m}/${y}`;
}

// ── מספר לוחית רישוי ──
export function generateLicensePlate() {
  return `${randDigits(3)}-${randDigits(2)}-${randDigits(3)}`;
}

// ── סיסמה מוסתרת ──
export function generatePassword() {
  return "•".repeat(randInt(8, 12));
}

// ── מפתח API פיקטיבי ──
export function generateAPIKey() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const part = (n) => Array.from({ length: n }, () => chars[randInt(0, chars.length - 1)]).join("");
  return `sk-${part(20)}`;
}

// ── מפתח AWS פיקטיבי ──
const AWS_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
export function generateAWSKey() {
  return `AKIA${Array.from({ length: 16 }, () => AWS_CHARS[randInt(0, AWS_CHARS.length - 1)]).join("")}`;
}

// ── החלפת מילת מפתח ──
const KEYWORD_REPLACEMENTS = {
  "פרויקט סודי": ["פרויקט אלפא", "פרויקט ביתא", "פרויקט גמא", "פרויקט דלתא"],
  "דוח כספי": ["סיכום רבעוני", "דוח פנימי", "סיכום תפעולי"],
  "תוכנית אסטרטגית": ["תכנון שנתי", "תכנית פיתוח", "מסמך עבודה"],
  "מידע סודי": ["מידע פנימי", "מסמך עבודה", "נתוני מחקר"],
  "סיסמה": ["קוד גישה", "אמצעי אימות"],
};

export function generateKeywordReplacement(keyword) {
  const lower = keyword.toLowerCase();
  for (const [key, replacements] of Object.entries(KEYWORD_REPLACEMENTS)) {
    if (lower.includes(key.toLowerCase())) return randItem(replacements);
  }
  // ברירת מחדל: מילה גנרית
  return `[מידע פנימי]`;
}

// ── פונקציה מרכזית: ייצור ערך סינתטי לפי קטגוריה ──
export function generateSynthetic(category, originalValue, cache) {
  // אחידות: אם אותו ערך מקורי הופיע כבר, השתמש באותו סינתטי
  if (cache && cache.has(originalValue)) {
    return cache.get(originalValue);
  }

  let synthetic;
  switch (category) {
    case "PHONE":      synthetic = generatePhone(); break;
    case "LANDLINE":   synthetic = generateLandline(); break;
    case "ID":         synthetic = generateIsraeliId(); break;
    case "EMAIL":      synthetic = generateEmail(); break;
    case "CREDIT_CARD":synthetic = generateCreditCard(); break;
    case "IBAN":       synthetic = generateIBAN(); break;
    case "IP_ADDRESS": synthetic = generateIP(); break;
    case "PASSPORT":   synthetic = generateIsraeliId().slice(0, 8); break;
    case "VEHICLE":    synthetic = generateLicensePlate(); break;
    case "BIRTHDATE":  synthetic = generateDate(); break;
    case "AWS_KEY":    synthetic = generateAWSKey(); break;
    case "OPENAI_KEY": synthetic = generateAPIKey(); break;
    case "GENERIC_SECRET": synthetic = generateAPIKey(); break;
    case "ADDRESS":    synthetic = generateAddress(); break;
    case "FULL_NAME":  synthetic = generateName(); break;
    case "PASSWORD":   synthetic = generatePassword(); break;
    case "BANK_ACCOUNT": synthetic = `${randDigits(3)}-${randDigits(3)}-${randDigits(7)}`; break;
    case "API_SECRET": synthetic = generateAPIKey(); break;
    default:
      synthetic = generateKeywordReplacement(originalValue);
  }

  if (cache) cache.set(originalValue, synthetic);
  return synthetic;
}
