/**
 * Auth.js (next-auth v4) configuration
 *
 * Supports generic OIDC providers (Okta, Microsoft Entra ID, any compliant IdP).
 * Provider details are loaded from environment variables so no code changes are
 * needed when switching identity providers.
 *
 * Required environment variables:
 *   NEXTAUTH_URL          – canonical URL of this app (e.g. https://app.example.com)
 *   NEXTAUTH_SECRET       – random secret for JWT / session encryption
 *
 * OIDC provider (one set per tenant or a single corporate IdP):
 *   OIDC_CLIENT_ID        – client ID registered with the IdP
 *   OIDC_CLIENT_SECRET    – client secret
 *   OIDC_ISSUER           – issuer URL (e.g. https://login.microsoftonline.com/<tenant>/v2.0)
 *
 * Optional SAML (via an OIDC proxy like Auth0 or Okta):
 *   Use the same OIDC_ variables pointing at the proxy's OIDC endpoint.
 */

import NextAuth from "next-auth";
import { connectMongo, TenantUser } from "./db.js";

/**
 * Build the list of configured providers.
 * Returns an empty array when OIDC_ vars are not set (so the server still boots).
 */
function buildProviders() {
  const { OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_ISSUER } = process.env;

  if (!OIDC_CLIENT_ID || !OIDC_CLIENT_SECRET || !OIDC_ISSUER) {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[auth] OIDC provider is not configured. Set OIDC_CLIENT_ID, " +
          "OIDC_CLIENT_SECRET and OIDC_ISSUER to enable SSO login."
      );
    }
    return [];
  }

  return [
    {
      id: "enterprise-oidc",
      name: process.env.OIDC_PROVIDER_NAME || "Enterprise SSO",
      type: "oauth",
      wellKnown: `${OIDC_ISSUER}/.well-known/openid-configuration`,
      clientId:     OIDC_CLIENT_ID,
      clientSecret: OIDC_CLIENT_SECRET,
      authorization: { params: { scope: "openid email profile" } },
      idToken: true,
      checks: ["pkce", "state"],
      profile(profile) {
        return {
          id:    profile.sub,
          name:  profile.name  ?? profile.email,
          email: profile.email,
          // Carry the raw OIDC subject identifier so we can match it in the DB
          ssoSubjectId: profile.sub,
        };
      },
    },
  ];
}

export const authOptions = {
  providers: buildProviders(),

  session: {
    strategy: "jwt",
  },

  callbacks: {
    /**
     * jwt callback — runs when the JWT is created or refreshed.
     * Looks up the user in the TenantUser collection and embeds their role
     * and tenantId into the token so downstream API routes can read it without
     * hitting the database again.
     */
    async jwt({ token, user, account }) {
      // `user` and `account` are only present on initial sign-in
      if (user && account) {
        token.ssoSubjectId = user.ssoSubjectId ?? account.providerAccountId;

        try {
          await connectMongo();
          // Find the TenantUser record that matches this SSO identity
          const tenantUser = await TenantUser.findOne({
            $or: [
              { email:        token.email },
              { ssoSubjectId: token.ssoSubjectId },
            ],
          })
            .sort({ createdAt: 1 }) // pick the oldest / primary record if duplicates exist
            .lean();

          if (tenantUser) {
            token.tenantId = String(tenantUser.tenantId);
            token.role     = tenantUser.role;
          }
        } catch (err) {
          console.error("[auth] Failed to resolve TenantUser:", err.message);
        }
      }
      return token;
    },

    /**
     * session callback — exposes safe fields to the client-side session object.
     */
    async session({ session, token }) {
      if (token) {
        session.user.tenantId    = token.tenantId  ?? null;
        session.user.role        = token.role      ?? null;
        session.user.ssoSubjectId = token.ssoSubjectId ?? null;
      }
      return session;
    },
  },

  pages: {
    signIn:  "/auth/signin",
    error:   "/auth/error",
  },
};

export default NextAuth(authOptions);
