"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, timingSafeEqual } from "node:crypto";
import { createSuperAdminSessionToken } from "../../lib/superAdminSession.js";

const SUPER_ADMIN_USERNAME = process.env.SUPER_ADMIN_USERNAME;
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD;
const COOKIE_NAME = "super_admin_auth";
const SESSION_DURATION_SECONDS = 60 * 60 * 8; // 8 hours

function safeStringEquals(left, right) {
  const a = createHash("sha256").update(String(left ?? ""), "utf8").digest();
  const b = createHash("sha256").update(String(right ?? ""), "utf8").digest();
  return timingSafeEqual(a, b);
}

export async function loginAction(formData) {
  if (!SUPER_ADMIN_USERNAME || !SUPER_ADMIN_PASSWORD) {
    return { error: "Super admin credentials are not configured" };
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    return { error: "Authentication is not configured (JWT_SECRET missing)" };
  }

  const username = formData.get("username");
  const password = formData.get("password");

  if (
    safeStringEquals(username, SUPER_ADMIN_USERNAME) &&
    safeStringEquals(password, SUPER_ADMIN_PASSWORD)
  ) {
    const token = await createSuperAdminSessionToken({
      username: String(username),
      secret: jwtSecret,
      expiresInSeconds: SESSION_DURATION_SECONDS,
    });

    const cookieStore = await cookies();
    cookieStore.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: SESSION_DURATION_SECONDS,
    });
    redirect("/dashboard");
  }

  return { error: "פרטי התחברות שגויים" };
}

export async function logoutAction() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
  redirect("/");
}
