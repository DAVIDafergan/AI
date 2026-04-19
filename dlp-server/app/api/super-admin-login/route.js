import { NextResponse } from "next/server";
import { createSuperAdminSessionToken } from "../../../lib/superAdminSession.js";

export const dynamic = "force-dynamic";

const SESSION_DURATION_SECONDS = 8 * 60 * 60; // 8 hours

export async function POST(request) {
  try {
    const body = await request.json();
    const username = (body?.username ?? "").trim();
    const password = (body?.password ?? "").trim();

    if (!username || !password) {
      return NextResponse.json(
        { error: "שם משתמש וסיסמה הם שדות חובה" },
        { status: 400 }
      );
    }

    const expectedUsername = process.env.SUPER_ADMIN_USERNAME;
    const expectedPassword = process.env.SUPER_ADMIN_PASSWORD;
    const jwtSecret = process.env.JWT_SECRET;

    if (!expectedUsername || !expectedPassword || !jwtSecret) {
      return NextResponse.json(
        { error: "Super admin credentials are not configured on the server" },
        { status: 503 }
      );
    }

    if (username !== expectedUsername || password !== expectedPassword) {
      return NextResponse.json(
        { error: "שם משתמש או סיסמה שגויים" },
        { status: 401 }
      );
    }

    const token = await createSuperAdminSessionToken({
      username,
      secret: jwtSecret,
      expiresInSeconds: SESSION_DURATION_SECONDS,
    });

    const response = NextResponse.json({ ok: true });
    response.cookies.set("super_admin_auth", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_DURATION_SECONDS,
      path: "/",
    });
    return response;
  } catch {
    return NextResponse.json({ error: "שגיאת שרת פנימית" }, { status: 500 });
  }
}
