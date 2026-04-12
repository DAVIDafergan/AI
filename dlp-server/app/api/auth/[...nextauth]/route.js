/**
 * Auth.js (next-auth v4) catch-all route handler.
 * Handles all /api/auth/* paths: sign-in, sign-out, callback, session, csrf, etc.
 */
import NextAuth from "next-auth";
import { authOptions } from "../../../../lib/auth.js";

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
