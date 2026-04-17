import { SignJWT, jwtVerify } from "jose";

const SESSION_ISSUER = "ghostlayer-super-admin";

export async function createSuperAdminSessionToken({ username, secret, expiresInSeconds }) {
  const secretKey = new TextEncoder().encode(secret);
  return new SignJWT({ role: "super_admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(username)
    .setIssuer(SESSION_ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${expiresInSeconds}s`)
    .sign(secretKey);
}

export async function verifySuperAdminSessionToken(token, secret) {
  const secretKey = new TextEncoder().encode(secret);
  const verified = await jwtVerify(token, secretKey, {
    issuer: SESSION_ISSUER,
  });
  if (verified?.payload?.role !== "super_admin") {
    const err = new Error("Invalid super-admin session role");
    err.code = "ERR_JWT_CLAIM_VALIDATION_FAILED";
    throw err;
  }
  return verified;
}
