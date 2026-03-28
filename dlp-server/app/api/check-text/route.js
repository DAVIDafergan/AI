import { NextResponse } from "next/server";

// ── הגדרות תבניות PII (מידע מזהה אישי) ──
const PATTERNS = [
  { id: "ID", regex: /\b\d{9}\b/g, label: "תעודת זהות" },
  { id: "CREDIT_CARD", regex: /\b(?:\d[ -]*?){13,16}\b/g, label: "כרטיס אשראי" },
  { id: "EMAIL", regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, label: "אימייל" },
  { id: "PHONE", regex: /\b05\d[- ]?\d{7}\b/g, label: "טלפון נייד" }
];

const KEYWORDS = [
  { keyword: "פרויקט סודי", category: "PROJECT", label: "פרויקט" },
  { keyword: "דוח כספי", category: "FINANCE", label: "דוח" },
  { keyword: "תוכנית אסטרטגית", category: "STRATEGY", label: "תוכנית" }
];

function normalize(text) {
  return text.replace(/[\u0591-\u05C7]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

export async function POST(request) {
  try {
    const { text } = await request.json();
    let redactedText = text;
    const replacements = [];
    const mapping = {};
    const counters = {};

    // 1. זיהוי לפי תבניות (Regex)
    PATTERNS.forEach(({ id, regex, label }) => {
      const matches = [...text.matchAll(regex)];
      matches.forEach(match => {
        const original = match[0];
        if (!counters[id]) counters[id] = 1;
        const placeholder = `[${id}_${counters[id]++}]`;
        
        redactedText = redactedText.replace(original, placeholder);
        replacements.push({ original, placeholder, label, category: id });
        mapping[placeholder] = original;
      });
    });

    // 2. זיהוי לפי מילות מפתח (Keywords)
    KEYWORDS.forEach(({ keyword, category, label }) => {
      const regex = new RegExp(keyword, 'gi');
      const matches = [...text.matchAll(regex)];
      matches.forEach(match => {
        const original = match[0];
        if (!counters[category]) counters[category] = 1;
        const placeholder = `[${category}_${counters[category]++}]`;
        
        redactedText = redactedText.replace(original, placeholder);
        replacements.push({ original, placeholder, label, category });
        mapping[placeholder] = original;
      });
    });

    return NextResponse.json({
      safe: replacements.length === 0,
      redactedText,
      replacements,
      mapping,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}