"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const envPath = path.join(rootDir, ".env.local");
const mongoPlaceholder =
  "mongodb+srv://<username>:<password>@<cluster>.mongodb.net/ghostlayer?retryWrites=true&w=majority";

function randomSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

function randomPassword() {
  return randomSecret(16).slice(0, 20);
}

function parseEnv(content) {
  const entries = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1).trim();
    entries[key] = value;
  }
  return entries;
}

function serializeEnv(map) {
  return [
    "NODE_ENV=development",
    `MONGODB_URI=${map.MONGODB_URI}`,
    `SUPER_ADMIN_USERNAME=${map.SUPER_ADMIN_USERNAME}`,
    `SUPER_ADMIN_PASSWORD=${map.SUPER_ADMIN_PASSWORD}`,
    `JWT_SECRET=${map.JWT_SECRET}`,
    `SUPER_ADMIN_KEY=${map.SUPER_ADMIN_KEY}`,
    `API_KEY_HMAC_SECRET=${map.API_KEY_HMAC_SECRET}`,
    `NEXTAUTH_URL=${map.NEXTAUTH_URL}`,
    `NEXTAUTH_SECRET=${map.NEXTAUTH_SECRET}`,
    "",
  ].join("\n");
}

function isConfiguredMongo(uri) {
  if (!uri) return false;
  return !uri.includes("<") && !uri.includes("your-");
}

function run() {
  try {
    const defaults = {
      MONGODB_URI: mongoPlaceholder,
      SUPER_ADMIN_USERNAME: "admin@example.com",
      SUPER_ADMIN_PASSWORD: randomPassword(),
      JWT_SECRET: randomSecret(),
      SUPER_ADMIN_KEY: randomSecret(),
      API_KEY_HMAC_SECRET: randomSecret(),
      NEXTAUTH_URL: "http://localhost:3000",
      NEXTAUTH_SECRET: randomSecret(),
    };

    let config = { ...defaults };
    let existed = false;

    if (fs.existsSync(envPath)) {
      existed = true;
      const current = parseEnv(fs.readFileSync(envPath, "utf8"));
      config = { ...defaults, ...current };
    } else {
      fs.mkdirSync(path.dirname(envPath), { recursive: true });
      fs.writeFileSync(envPath, serializeEnv(config), "utf8");
    }

    console.log(
      existed
        ? `[setup] Using existing .env.local at ${envPath}`
        : `[setup] Created .env.local at ${envPath}`
    );
    console.log("[setup] Startup configuration summary:");
    console.log(`- MONGODB_URI configured: ${isConfiguredMongo(config.MONGODB_URI) ? "yes" : "no (placeholder)"}`);
    console.log(`- SUPER_ADMIN_USERNAME: ${config.SUPER_ADMIN_USERNAME || "(missing)"}`);
    console.log(`- SUPER_ADMIN_PASSWORD set: ${config.SUPER_ADMIN_PASSWORD ? "yes" : "no"}`);
    console.log(`- JWT_SECRET set: ${config.JWT_SECRET ? "yes" : "no"}`);
    console.log(`- SUPER_ADMIN_KEY set: ${config.SUPER_ADMIN_KEY ? "yes" : "no"}`);
    console.log(`- API_KEY_HMAC_SECRET set: ${config.API_KEY_HMAC_SECRET ? "yes" : "no"}`);
    console.log(`- NEXTAUTH_URL: ${config.NEXTAUTH_URL || "(missing)"}`);
    console.log(`- NEXTAUTH_SECRET set: ${config.NEXTAUTH_SECRET ? "yes" : "no"}`);
    console.log(`- MongoDB Atlas URI format: ${mongoPlaceholder}`);
    console.log("- Get a free Atlas cluster: https://www.mongodb.com/cloud/atlas/register");
    console.log("Edit MONGODB_URI in .env.local then restart");
  } catch (err) {
    console.error("[setup] Non-blocking setup warning:", err.message);
  }
}

run();
