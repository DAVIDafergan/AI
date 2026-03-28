import { NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import Mapping from '@/models/Mapping';

export async function POST(req) {
  await dbConnect();
  const { text } = await req.json();
  
  // לוגיקה פשוטה להדגמה: מחליף שמות ב-Tags
  const sensitivePatterns = [
    { pattern: /([0-9]{9})/g, label: 'ID' },
    { pattern: /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, label: 'EMAIL' }
  ];

  let sanitizedText = text;
  
  for (const item of sensitivePatterns) {
    const matches = [...text.matchAll(item.pattern)];
    for (const match of matches) {
      const tag = `[${item.label}_${Math.floor(Math.random() * 1000)}]`;
      sanitizedText = sanitizedText.replace(match[0], tag);
      
      // שמירה ב-MongoDB
      await Mapping.create({ tag, originalText: match[0] });
    }
  }

  return NextResponse.json({ sanitizedText });
}

export async function GET(req) {
  await dbConnect();
  const { searchParams } = new URL(req.url);
  const tag = searchParams.get('tag');
  
  const entry = await Mapping.findOne({ tag });
  return NextResponse.json({ original: entry ? entry.originalText : tag });
}
