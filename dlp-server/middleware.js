import { NextResponse } from "next/server";
import { jwtVerify } from "jose";

/** Maximum allowed request body size for API routes (bytes). */
const MAX_BODY_BYTES = 500 * 1024; // 500 KB
const PUBLIC_CORS_API_PATHS = new Set(["/api/agent-config"]);
const PUBLIC_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, x-api-key, x-dlp-extension, x-super-admin-key",
};

/**
 * Returns the set of allowed origins from the environment variable.
 * @returns {Set<string>}
 */
function getAllowedOrigins() {
  return new Set(
    (process.env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean)
  );
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  // ── CORS for all API routes ──
  if (pathname.startsWith("/api/")) {
    const origin = request.headers.get("origin") || "";
    const allowedOrigins = getAllowedOrigins();

    // Reject preflight OPTIONS requests from unknown origins immediately
    if (request.method === "OPTIONS") {
      if (PUBLIC_CORS_API_PATHS.has(pathname)) {
        return new NextResponse(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
      }
      if (!allowedOrigins.has(origin)) {
        return new NextResponse(null, { status: 403 });
      }
      return new NextResponse(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers":
            "Content-Type, x-api-key, x-dlp-extension, x-super-admin-key",
          Vary: "Origin",
        },
      });
    }

    // ── Body size limit for mutating requests ──
    if (["POST", "PUT", "PATCH"].includes(request.method)) {
      const contentLength = parseInt(request.headers.get("content-length") || "0", 10);
      if (contentLength > MAX_BODY_BYTES) {
        return NextResponse.json(
          { error: "Request body too large. Maximum allowed size is 500 KB." },
          { status: 413 }
        );
      }
    }

    // For non-preflight requests, add CORS headers when origin is allowed
    const response = NextResponse.next();
    if (origin && allowedOrigins.has(origin)) {
      response.headers.set("Access-Control-Allow-Origin", origin);
      response.headers.set("Vary", "Origin");
    }
    return response;
  }

  // ── JWT auth for dashboard routes ──
  if (pathname.startsWith("/dashboard")) {
    const authCookie = request.cookies.get("super_admin_auth");
    const token = authCookie?.value;

    const secret = process.env.JWT_SECRET;
    if (!token || !secret) {
      if (!secret) {
        console.error("[middleware] JWT_SECRET is not configured");
      }
      const loginUrl = new URL("/", request.url);
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }

    try {
      await jwtVerify(token, new TextEncoder().encode(secret));
    } catch {
      // Token is missing, expired, or invalid → redirect to login
      const loginUrl = new URL("/", request.url);
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*", "/dashboard/:path*"],
};
