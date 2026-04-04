import { NextResponse } from "next/server";

export function middleware(request) {
  const { pathname } = request.nextUrl;

  // Protect all /dashboard routes (super-admin portal)
  if (pathname.startsWith("/dashboard")) {
    const authCookie = request.cookies.get("super_admin_auth");
    if (!authCookie || authCookie.value !== "true") {
      // Preserve the intended destination so the login page can redirect back
      const loginUrl = new URL("/", request.url);
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
