"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import jwt from "jsonwebtoken";

const SUPER_ADMIN_USERNAME = process.env.SUPER_ADMIN_USERNAME;
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD;
const COOKIE_NAME = "super_admin_auth";
const SESSION_DURATION_SECONDS = 60 * 60 * 8; // 8 hours

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

  if (username === SUPER_ADMIN_USERNAME && password === SUPER_ADMIN_PASSWORD) {
    const token = jwt.sign(
      { sub: username, role: "super_admin" },
      jwtSecret,
      { expiresIn: SESSION_DURATION_SECONDS }
    );

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
