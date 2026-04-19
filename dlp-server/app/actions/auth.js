"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { timingSafeEqual } from "node:crypto";
import { createSuperAdminSessionToken } from "../../lib/superAdminSession.js";

const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD;
const SUPER_ADMIN_USERNAME = process.env.SUPER_ADMIN_USERNAME || "admin";
const COOKIE_NAME = "super_admin_auth";
const SESSION_DURATION_SECONDS = 60 * 60 * 8; // 8 hours
const MAX_COMPARE_BYTES = 256;

function safeStringEquals(left, right) {
  const aSource = Buffer.from(String(left ?? ""), "utf8");
  const bSource = Buffer.from(String(right ?? ""), "utf8");
  if (aSource.length === 0 || bSource.length === 0) return false;
  const a = Buffer.alloc(MAX_COMPARE_BYTES);
  const b = Buffer.alloc(MAX_COMPARE_BYTES);
  aSource.subarray(0, MAX_COMPARE_BYTES).copy(a);
  bSource.subarray(0, MAX_COMPARE_BYTES).copy(b);
  const equal = timingSafeEqual(a, b);
  return (
    equal &&
    aSource.length === bSource.length &&
    aSource.length <= MAX_COMPARE_BYTES
  );
}

export async function loginAction(formData) {
  if (!SUPER_ADMIN_PASSWORD) {
    return { error: "Super admin credentials are not configured" };
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    return { error: "Authentication is not configured (JWT_SECRET missing)" };
  }

  const password = formData.get("password");

  if (safeStringEquals(password, SUPER_ADMIN_PASSWORD)) {
    const token = await createSuperAdminSessionToken({
      username: SUPER_ADMIN_USERNAME,
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

  return { error: "סיסמה שגויה" };
}

export async function logoutAction() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
  redirect("/");
}
