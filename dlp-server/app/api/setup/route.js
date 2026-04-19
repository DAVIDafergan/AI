import { randomBytes } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENV_PATH = path.join(process.cwd(), ".env.local");
const REQUIRED_KEYS = [
  "MONGODB_URI",
  "SUPER_ADMIN_USERNAME",
  "SUPER_ADMIN_PASSWORD",
  "JWT_SECRET",
  "SUPER_ADMIN_KEY",
  "API_KEY_HMAC_SECRET",
];

const MONGO_PLACEHOLDER =
  "mongodb+srv://<username>:<password>@<cluster>.mongodb.net/ghostlayer?retryWrites=true&w=majority";

function randomSecret(bytes = 32) {
  return randomBytes(bytes).toString("hex");
}

function sanitizeEnvValue(value) {
  return String(value ?? "").replace(/[\r\n]/g, "").trim();
}

function parseEnv(content = "") {
  const map = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    map[key] = value;
  }
  return map;
}

function serializeEnv(env) {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${sanitizeEnvValue(value)}`)
    .join("\n")
    .concat("\n");
}

function isConfiguredMongo(uri) {
  if (!uri) return false;
  return !uri.includes("<") && !uri.includes("your-");
}

async function readEnvConfig() {
  try {
    const content = await fs.readFile(ENV_PATH, "utf8");
    return parseEnv(content);
  } catch {
    return {};
  }
}

function withDefaults(env) {
  return {
    NODE_ENV: env.NODE_ENV || "development",
    MONGODB_URI: env.MONGODB_URI || MONGO_PLACEHOLDER,
    SUPER_ADMIN_USERNAME: env.SUPER_ADMIN_USERNAME || "admin@example.com",
    SUPER_ADMIN_PASSWORD: env.SUPER_ADMIN_PASSWORD || randomSecret(16).slice(0, 20),
    JWT_SECRET: env.JWT_SECRET || randomSecret(),
    SUPER_ADMIN_KEY: env.SUPER_ADMIN_KEY || randomSecret(),
    API_KEY_HMAC_SECRET: env.API_KEY_HMAC_SECRET || randomSecret(),
    NEXTAUTH_URL: env.NEXTAUTH_URL || "http://localhost:3000",
    NEXTAUTH_SECRET: env.NEXTAUTH_SECRET || randomSecret(),
    ...env,
  };
}

export async function GET() {
  const current = withDefaults(await readEnvConfig());
  const status = {
    MONGODB_URI: isConfiguredMongo(current.MONGODB_URI),
    SUPER_ADMIN_USERNAME: Boolean(current.SUPER_ADMIN_USERNAME),
    SUPER_ADMIN_PASSWORD: Boolean(current.SUPER_ADMIN_PASSWORD),
    JWT_SECRET: Boolean(current.JWT_SECRET),
    SUPER_ADMIN_KEY: Boolean(current.SUPER_ADMIN_KEY),
    API_KEY_HMAC_SECRET: Boolean(current.API_KEY_HMAC_SECRET),
  };
  const missing = Object.entries(status)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  return NextResponse.json({
    localMode: !status.MONGODB_URI,
    configured: status,
    missing,
    mongoAtlasSignupUrl: "https://www.mongodb.com/cloud/atlas/register",
    envPath: ".env.local",
  });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const mongoUri = sanitizeEnvValue(body?.mongoUri);
    const adminEmail = sanitizeEnvValue(body?.adminEmail);
    const adminPassword = sanitizeEnvValue(body?.adminPassword);

    if (!mongoUri || !adminEmail || !adminPassword) {
      return NextResponse.json(
        { error: "mongoUri, adminEmail and adminPassword are required" },
        { status: 400 }
      );
    }

    const existing = withDefaults(await readEnvConfig());
    const next = {
      ...existing,
      MONGODB_URI: mongoUri,
      SUPER_ADMIN_USERNAME: adminEmail,
      SUPER_ADMIN_PASSWORD: adminPassword,
    };

    for (const key of REQUIRED_KEYS) {
      if (!next[key]) {
        next[key] = randomSecret();
      }
    }

    await fs.mkdir(path.dirname(ENV_PATH), { recursive: true });
    await fs.writeFile(ENV_PATH, serializeEnv(next), "utf8");

    return NextResponse.json({
      ok: true,
      message: "Setup saved. Restarting server configuration...",
      localMode: !isConfiguredMongo(next.MONGODB_URI),
    });
  } catch (err) {
    console.error("[setup] Failed to persist configuration:", err.message);
    return NextResponse.json(
      { error: "Failed to save setup configuration" },
      { status: 500 }
    );
  }
}
