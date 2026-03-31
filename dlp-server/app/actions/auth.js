"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const SUPER_ADMIN_USERNAME = process.env.SUPER_ADMIN_USERNAME;
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD;
const COOKIE_NAME = "super_admin_auth";
const SESSION_DURATION_SECONDS = 60 * 60 * 8; // 8 hours

export async function loginAction(formData) {
  if (!SUPER_ADMIN_USERNAME || !SUPER_ADMIN_PASSWORD) {
    return { error: "Super admin credentials are not configured" };
  }

  const username = formData.get("username");
  const password = formData.get("password");

  if (username === SUPER_ADMIN_USERNAME && password === SUPER_ADMIN_PASSWORD) {
    const cookieStore = await cookies();
    cookieStore.set(COOKIE_NAME, "true", {
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
